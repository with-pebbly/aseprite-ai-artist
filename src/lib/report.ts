/**
 * The two lines `doctor` exists for.
 *
 * They live here, apart from the CLI, because their exact wording is the whole
 * product of the command — a user reads them and decides what to go and fix —
 * and cli.ts runs `main()` on import, so it cannot be loaded from a test.
 */

export interface LinkState {
  /** The control link came up (whoever started it). */
  bridgeUp: boolean;
  /** It was already up before this check ran, rather than started by it. */
  wasAlreadyRunning: boolean;
  /** Aseprite's extension is attached to that bridge. */
  pluginUp: boolean;
  controlPort: number;
  extensionVersion?: string;
  asepriteVersion?: string;
}

export function linkLines(state: LinkState): [bridge: string, extension: string] {
  const bridge = !state.bridgeUp
    ? `✗ Bridge                 could not reach or start it on :${state.controlPort}`
    : state.wasAlreadyRunning
      ? `✓ Bridge                 ws://127.0.0.1:${state.controlPort}`
      // Not a tick: the bridge is up because this command started it, which says
      // nothing about whether the user's setup works.
      : `· Bridge                 not running — started one to test, stopping it again below`;

  const extension = state.pluginUp
    ? `✓ Aseprite extension     ${state.extensionVersion ?? "?"} on Aseprite ${state.asepriteVersion ?? "?"}`
    : state.bridgeUp
      ? "✗ Aseprite extension     not connected — open Aseprite, or run `install-extension` and restart it"
      // Without a bridge the extension has nothing to attach to, so its state is
      // unknown. Saying "not connected" here sends the user to reinstall an
      // extension that was never the problem.
      : "· Aseprite extension     unknown — cannot be checked without a bridge";

  return [bridge, extension];
}
