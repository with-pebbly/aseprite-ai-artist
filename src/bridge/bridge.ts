/**
 * Standalone WebSocket bridge.
 *
 * Owns two ports and nothing else — it is a dumb relay with no knowledge of
 * Aseprite semantics:
 *   plugin port  : the Aseprite Lua extension dials in (at most one, last wins)
 *   control port : MCP server processes dial in (N of them)
 *
 * It runs as its own process, detached from any MCP server, because agent hosts
 * own the MCP server lifecycle and restart it freely. A bridge living inside the
 * MCP process drops the Aseprite connection on every restart and duplicate
 * processes fight over the listen port. See docs/adr/0002-standalone-bridge.md.
 *
 * Singleton by port ownership: whoever binds the control port first is the
 * bridge; a loser of the bind race exits 0 without complaint.
 */

import { WebSocketServer, WebSocket } from "ws";
import {
  BridgeStateFrame,
  DEFAULT_CONTROL_PORT,
  DEFAULT_PLUGIN_PORT,
  HelloFrame,
  isHello,
  makeNamespacedId,
  splitNamespacedId,
} from "../lib/protocol.js";

export interface BridgeOptions {
  pluginPort?: number;
  controlPort?: number;
  version: string;
  /** Exit when the last control client disconnects and no plugin is attached. */
  idleExitMs?: number;
  log?: (msg: string) => void;
}

interface ControlClient {
  id: number;
  socket: WebSocket;
}

export class Bridge {
  private readonly pluginPort: number;
  private readonly controlPort: number;
  private readonly version: string;
  private readonly log: (msg: string) => void;

  private pluginServer: WebSocketServer | null = null;
  private controlServer: WebSocketServer | null = null;

  private plugin: WebSocket | null = null;
  private hello: HelloFrame | null = null;
  private since = Date.now();

  private clients = new Map<number, ControlClient>();
  private nextClientId = 1;

  constructor(opts: BridgeOptions) {
    this.pluginPort = opts.pluginPort ?? DEFAULT_PLUGIN_PORT;
    this.controlPort = opts.controlPort ?? DEFAULT_CONTROL_PORT;
    this.version = opts.version;
    this.log = opts.log ?? (() => {});
  }

  /**
   * Bind both ports. Resolves false when the control port is already taken,
   * which means another bridge already owns this machine's Aseprite link.
   */
  async start(): Promise<boolean> {
    const control = await listen(this.controlPort);
    if (!control) return false;
    this.controlServer = control;

    const plugin = await listen(this.pluginPort);
    if (!plugin) {
      // Ports must move together; a split ownership would strand the extension.
      control.close();
      return false;
    }
    this.pluginServer = plugin;

    this.controlServer.on("connection", (socket) => this.onControlConnect(socket));
    this.pluginServer.on("connection", (socket) => this.onPluginConnect(socket));

    this.log(
      `bridge up — plugin :${this.pluginPort}, control :${this.controlPort}, v${this.version}`,
    );
    return true;
  }

  async stop(): Promise<void> {
    for (const c of this.clients.values()) c.socket.close();
    this.plugin?.close();
    this.pluginServer?.close();
    this.controlServer?.close();
  }

  // ── plugin side ────────────────────────────────────────────────────────────

  private onPluginConnect(socket: WebSocket): void {
    // Last connection wins: an Aseprite restart must not be locked out by the
    // corpse of a half-open previous socket.
    if (this.plugin && this.plugin.readyState === WebSocket.OPEN) {
      this.log("plugin reconnected — dropping previous socket");
      this.plugin.close();
    }
    this.plugin = socket;
    this.since = Date.now();

    socket.on("message", (raw) => this.onPluginMessage(raw.toString()));
    socket.on("close", () => {
      if (this.plugin === socket) {
        this.plugin = null;
        this.hello = null;
        this.since = Date.now();
        this.broadcastState();
      }
    });
    socket.on("error", () => socket.close());

    this.broadcastState();
  }

  private onPluginMessage(raw: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      this.log(`dropped unparseable plugin frame (${raw.length} bytes)`);
      return;
    }

    if (isHello(frame)) {
      this.hello = frame;
      this.since = Date.now();
      this.broadcastState();
      return;
    }

    const id = (frame as { id?: unknown }).id;
    if (typeof id !== "string") return;

    const split = splitNamespacedId(id);
    if (!split) return;

    const client = this.clients.get(split.clientId);
    if (!client || client.socket.readyState !== WebSocket.OPEN) return;

    send(client.socket, { ...(frame as object), id: split.originalId });
  }

  // ── control side ───────────────────────────────────────────────────────────

  private onControlConnect(socket: WebSocket): void {
    const id = this.nextClientId++;
    this.clients.set(id, { id, socket });

    socket.on("message", (raw) => this.onControlMessage(id, raw.toString()));
    socket.on("close", () => this.clients.delete(id));
    socket.on("error", () => socket.close());

    // A client must know liveness before it sends anything.
    send(socket, this.stateFrame());
  }

  private onControlMessage(clientId: number, raw: string): void {
    let frame: { id?: unknown; cmd?: unknown };
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof frame.id !== "string") return;

    const client = this.clients.get(clientId);
    if (!client) return;

    if (!this.plugin || this.plugin.readyState !== WebSocket.OPEN) {
      // Answer on the plugin's behalf rather than letting the call hang. A
      // timeout reads as "slow" to an agent; this reads as "stop and tell the user".
      send(client.socket, {
        id: frame.id,
        ok: false,
        error: {
          code: "not_connected",
          message:
            "Aseprite is not connected to the bridge. The extension is not running or Aseprite is closed.",
          details: { doNotFallBackToDisk: true },
        },
      });
      return;
    }

    send(this.plugin, { ...frame, id: makeNamespacedId(clientId, frame.id) });
  }

  private stateFrame(): BridgeStateFrame {
    return {
      type: "bridge_state",
      pluginConnected: this.plugin?.readyState === WebSocket.OPEN,
      hello: this.hello,
      bridgeVersion: this.version,
      since: this.since,
    };
  }

  private broadcastState(): void {
    const frame = this.stateFrame();
    for (const c of this.clients.values()) {
      if (c.socket.readyState === WebSocket.OPEN) send(c.socket, frame);
    }
  }
}

function send(socket: WebSocket, payload: unknown): void {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    /* a dead socket is handled by its own close handler */
  }
}

function listen(port: number): Promise<WebSocketServer | null> {
  return new Promise((resolve) => {
    const server = new WebSocketServer({ host: "127.0.0.1", port });
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener("listening", onListening);
      if (err.code === "EADDRINUSE") resolve(null);
      else resolve(null);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      server.on("error", () => {});
      resolve(server);
    };
    server.once("error", onError);
    server.once("listening", onListening);
  });
}
