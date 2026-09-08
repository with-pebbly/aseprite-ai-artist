/**
 * Control client: the MCP server's half of the link to Aseprite.
 *
 * Responsibilities beyond "send JSON":
 *  - spawn the bridge if nothing owns the control port yet (zero-setup goal);
 *  - reconnect with backoff, because the bridge may be restarted under us;
 *  - track `pluginConnected` from bridge_state so `preflight` can answer
 *    truthfully without a round-trip to Aseprite.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocket } from "ws";
import {
  BridgeStateFrame,
  CommandFrame,
  DEFAULT_CONTROL_PORT,
  HelloFrame,
  LiveError,
  ResultFrame,
  isBridgeState,
  isResult,
  notConnected,
} from "../lib/protocol.js";

const DEFAULT_TIMEOUT_MS = 20_000;
const RECONNECT_BASE_MS = 250;
const RECONNECT_MAX_MS = 5_000;
/** Floor between bridge spawn attempts, so a failing spawn cannot become a fork bomb. */
const SPAWN_COOLDOWN_MS = 10_000;

export interface LiveClientOptions {
  controlPort?: number;
  pluginPort?: number;
  /** Disable auto-spawning the bridge (useful in tests and CI). */
  autoSpawnBridge?: boolean;
  timeoutMs?: number;
  log?: (msg: string) => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class LiveClient {
  private readonly controlPort: number;
  private readonly pluginPort: number;
  private readonly autoSpawn: boolean;
  private readonly timeoutMs: number;
  private readonly log: (msg: string) => void;

  private socket: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private seq = 0;
  private reconnectDelay = RECONNECT_BASE_MS;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private lastSpawnAt = 0;
  private spawnedPid: number | null = null;

  private state: BridgeStateFrame | null = null;

  constructor(opts: LiveClientOptions = {}) {
    this.controlPort = opts.controlPort ?? DEFAULT_CONTROL_PORT;
    this.pluginPort = opts.pluginPort ?? this.controlPort - 1;
    this.autoSpawn = opts.autoSpawnBridge ?? true;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.log = opts.log ?? (() => {});
    this.connect();
  }

  get bridgeConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  get pluginConnected(): boolean {
    return this.bridgeConnected && this.state?.pluginConnected === true;
  }

  get hello(): HelloFrame | null {
    return this.state?.hello ?? null;
  }

  /**
   * PID of a bridge this client started itself, or null if it attached to one
   * that was already running. `doctor` needs the difference: a diagnostic must
   * not leave a daemon behind, and must not report a bridge as healthy when the
   * only reason it is up is that the diagnostic started it.
   */
  get spawnedBridgePid(): number | null {
    return this.spawnedPid;
  }

  get features(): string[] {
    return this.state?.hello?.features ?? [];
  }

  hasFeature(name: string): boolean {
    return this.features.includes(name);
  }

  /** Wait until the bridge link is up (not necessarily Aseprite). */
  async waitForBridge(ms = 3_000): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (this.bridgeConnected && this.state) return true;
      await sleep(50);
    }
    return this.bridgeConnected;
  }

  /** Wait until Aseprite itself is attached. */
  async waitForPlugin(ms = 3_000): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (this.pluginConnected) return true;
      await sleep(50);
    }
    return this.pluginConnected;
  }

  /**
   * @param opts.expect Field names the caller goes on to read. Nothing else checks
   *   them: `call<T>` is a compile-time claim about data that crossed a socket
   *   from a separately installed extension, and an extension older than this
   *   server answers a command it knows with fields it does not have. Without
   *   this the missing value becomes `undefined`, flows into the summary the
   *   agent reads, and the run looks like it worked.
   *
   *   Presence only — this is not schema validation, and it cannot catch an
   *   argument name the two sides spell differently, because Lua defaults the
   *   value and reports success. Only tests/extension.test.lua catches that.
   *
   *   NEVER list a field the extension may leave unset. A Lua table cannot hold
   *   nil, so `{sprite = nil}` does not reach the wire as `null` — the key is
   *   simply absent, and is indistinguishable from an old extension omitting
   *   it. Listing `sprite` here turned "no document is open", which is the
   *   normal state of a freshly started editor, into a hard error telling the
   *   user to reinstall a perfectly current extension.
   */
  // TODO(boundary): only the call sites whose fields feed a summary or a
  // decision declare `expect` — draw.batch, recolor.apply, export.run,
  // session.site, sprite.info. The rest (select, transform, reference, tileset,
  // look, palette) still rest on `call<T>` alone. Extend as each is checked
  // against a real reply; guessing a field name here turns a working path into
  // a hard error.
  async call<T = unknown>(
    cmd: string,
    args: Record<string, unknown> = {},
    opts: { expect?: readonly string[]; timeoutMs?: number } = {},
  ): Promise<T> {
    const expect = opts.expect ?? [];
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    if (!this.bridgeConnected) {
      await this.waitForBridge(2_000);
      if (!this.bridgeConnected) throw notConnected("Bridge process is not reachable.");
    }
    if (!this.pluginConnected) throw notConnected();

    const id = `r${++this.seq}`;
    const frame: CommandFrame = { id, cmd, args };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new LiveError("timeout", `Aseprite did not answer '${cmd}' within ${timeoutMs}ms.`, {
            cmd,
            doNotFallBackToDisk: true,
          }),
        );
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value: unknown) => {
          const missing = missingFields(value, expect);
          if (missing.length > 0) {
            reject(
              new LiveError(
                "aseprite_error",
                `The Aseprite extension answered '${cmd}' without ${missing.map((f) => `'${f}'`).join(", ")}. ` +
                  "It is probably older than this server: run `install-extension` and restart Aseprite.",
                { cmd, missing, doNotFallBackToDisk: true },
              ),
            );
            return;
          }
          resolve(value as T);
        },
        reject,
        timer,
      });
      this.socket!.send(JSON.stringify(frame));
    });
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.rejectPending(new LiveError("not_connected", "Client closed."));
    this.socket?.close();
  }

  private rejectPending(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private connect(): void {
    if (this.closed) return;

    const socket = new WebSocket(`ws://127.0.0.1:${this.controlPort}`);
    this.socket = socket;

    socket.on("open", () => {
      this.reconnectDelay = RECONNECT_BASE_MS;
      this.log(`control link up on :${this.controlPort}`);
    });

    socket.on("message", (raw) => this.onMessage(raw.toString()));

    socket.on("error", () => {
      // Suppressed: 'close' always follows and owns the retry path.
    });

    socket.on("close", () => {
      this.state = null;
      // Fail in-flight calls now. Letting each wait out its own 20s timeout
      // turns a known disconnect into what an agent reads as "Aseprite is slow"
      // — and slow is the reading that makes it try something else.
      this.rejectPending(
        notConnected("The bridge connection dropped while this call was in flight."),
      );
      if (this.closed) return;
      if (this.autoSpawn) {
        // Retry the spawn on a later reconnect too: a bridge that died after we
        // started it would otherwise leave this client looping forever with no
        // recovery short of the user restarting things by hand.
        const now = Date.now();
        if (now - this.lastSpawnAt > SPAWN_COOLDOWN_MS) {
          this.lastSpawnAt = now;
          this.spawnBridge();
        }
      }
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    // A pending retry must never be the reason a process stays alive: the
    // stdio transport owns the server's lifetime, and in tests an un-unref'd
    // timer turns a failed assertion into a hang.
    this.reconnectTimer.unref?.();
  }

  private onMessage(raw: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }

    if (isBridgeState(frame)) {
      this.state = frame;
      return;
    }

    if (!isResult(frame)) return;
    const result = frame as ResultFrame;
    const pending = this.pending.get(result.id);
    if (!pending) return;

    this.pending.delete(result.id);
    clearTimeout(pending.timer);

    if (result.ok) {
      pending.resolve(result.data ?? {});
    } else {
      const err = result.error;
      pending.reject(
        new LiveError(
          err?.code ?? "aseprite_error",
          err?.message ?? "Aseprite reported an unspecified failure.",
          err?.details ?? {},
        ),
      );
    }
  }

  /**
   * Start the bridge as a detached child so it survives this MCP process.
   * Losing the bind race is normal and silent — it means a bridge already runs.
   */
  private spawnBridge(): void {
    try {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const cli = path.resolve(here, "..", "cli.js");
      const child = spawn(
        process.execPath,
        [cli, "bridge", "--plugin-port", String(this.pluginPort), "--control-port", String(this.controlPort)],
        { detached: true, stdio: "ignore" },
      );
      child.unref();
      this.spawnedPid = child.pid ?? null;
      this.log("spawned bridge process");
    } catch (err) {
      this.log(`bridge spawn failed: ${(err as Error).message}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * `null` counts as present: several commands legitimately answer `{sprite: null}`
 * for "nothing is open". Absent is the failure — the field the caller was told
 * to expect never arrived.
 */
function missingFields(value: unknown, expect: readonly string[]): string[] {
  if (expect.length === 0) return [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [...expect];
  }
  const record = value as Record<string, unknown>;
  return expect.filter((field) => !(field in record));
}
