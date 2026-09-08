/**
 * Wire protocol shared by the MCP server, the standalone bridge and the
 * Aseprite Lua extension.
 *
 * Design constraints that shape this file:
 *  - Aseprite's Lua `WebSocket` is a *client only*; something else must listen.
 *    That listener is the bridge (see docs/ARCHITECTURE.md).
 *  - The MCP server process is owned by the agent host and may restart or be
 *    duplicated, so the bridge must outlive it and accept N control clients.
 *  - Everything on the wire is newline-free JSON, one frame per message.
 */

export const PROTOCOL_VERSION = 1;

/** Default port the Aseprite extension dials. */
export const DEFAULT_PLUGIN_PORT = 9931;
/** Default port MCP servers dial as control clients. Always plugin port + 1. */
export const DEFAULT_CONTROL_PORT = DEFAULT_PLUGIN_PORT + 1;

/** Separator used to namespace a request id per control client. */
export const ID_SEPARATOR = "::";

export interface CommandFrame {
  id: string;
  cmd: string;
  args?: Record<string, unknown>;
}

export interface ResultFrame {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: WireError;
}

export interface WireError {
  code: ErrorCode;
  message: string;
  /** Machine-readable remediation hint; never free-form prose the agent must parse. */
  details?: Record<string, unknown>;
}

export type ErrorCode =
  | "not_connected"
  | "no_active_sprite"
  | "unsupported_command"
  | "invalid_args"
  | "aseprite_error"
  | "timeout"
  | "refused"
  | "too_large";

/** Sent by the extension right after it connects, and on demand. */
export interface HelloFrame {
  type: "hello";
  protocol: number;
  extensionVersion: string;
  asepriteVersion: string;
  features: string[];
}

/** Broadcast by the bridge to every control client whenever liveness changes. */
export interface BridgeStateFrame {
  type: "bridge_state";
  pluginConnected: boolean;
  hello: HelloFrame | null;
  bridgeVersion: string;
  since: number;
}

export type PluginFrame = ResultFrame | HelloFrame | { type: string; [k: string]: unknown };

export function makeNamespacedId(clientId: number, originalId: string): string {
  return `c${clientId}${ID_SEPARATOR}${originalId}`;
}

export function splitNamespacedId(
  id: string,
): { clientId: number; originalId: string } | null {
  const idx = id.indexOf(ID_SEPARATOR);
  if (idx <= 1 || id[0] !== "c") return null;
  const clientId = Number(id.slice(1, idx));
  if (!Number.isInteger(clientId)) return null;
  return { clientId, originalId: id.slice(idx + ID_SEPARATOR.length) };
}

export function isHello(frame: unknown): frame is HelloFrame {
  return typeof frame === "object" && frame !== null && (frame as { type?: string }).type === "hello";
}

export function isBridgeState(frame: unknown): frame is BridgeStateFrame {
  return (
    typeof frame === "object" &&
    frame !== null &&
    (frame as { type?: string }).type === "bridge_state"
  );
}

export function isResult(frame: unknown): frame is ResultFrame {
  return (
    typeof frame === "object" &&
    frame !== null &&
    typeof (frame as { id?: unknown }).id === "string" &&
    typeof (frame as { ok?: unknown }).ok === "boolean"
  );
}

export class LiveError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "LiveError";
    this.code = code;
    this.details = details;
  }

  toWire(): WireError {
    return { code: this.code, message: this.message, details: this.details };
  }
}

/**
 * The one error every mutating tool raises when Aseprite is not reachable.
 *
 * `doNotFallBackToDisk` is load-bearing: an agent that silently retargets a
 * failed live edit at the .aseprite file on disk produces changes the user
 * never sees in their open window, and that later get overwritten by a save.
 */
export function notConnected(detail?: string): LiveError {
  return new LiveError(
    "not_connected",
    detail ??
      "Aseprite is not connected. Open Aseprite with the aseprite-ai-artist extension installed, then retry.",
    {
      doNotFallBackToDisk: true,
      remediation: "Run `npx @pebbly/aseprite-ai-artist doctor` for a step-by-step check.",
    },
  );
}
