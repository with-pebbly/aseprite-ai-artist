#!/usr/bin/env node
/**
 * Tells the session whether Aseprite is actually reachable, before the model
 * tries to draw and gets a confusing failure five tool calls in.
 *
 * Deliberately cheap: a raw TCP connect to the bridge's control port, no
 * dependencies, hard 400ms budget. A hook that slows session start is a hook
 * people disable.
 */

import net from "node:net";

const CONTROL_PORT = Number(process.env.ASEPRITE_AI_CONTROL_PORT || 9932);
const PLUGIN_PORT = Number(process.env.ASEPRITE_AI_PLUGIN_PORT || 9931);
const BUDGET_MS = 400;

function probe(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(BUDGET_MS);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

const [bridge, plugin] = await Promise.all([probe(CONTROL_PORT), probe(PLUGIN_PORT)]);

// The plugin port being open means the bridge is listening for Aseprite, not
// that Aseprite has connected — only `preflight` can answer that, so say so
// rather than implying a readiness this probe cannot see.
const message = bridge
  ? `aseprite-ai-artist: bridge is up on :${CONTROL_PORT}. Call preflight before any drawing to confirm Aseprite itself is attached.`
  : `aseprite-ai-artist: no bridge on :${CONTROL_PORT} yet — it starts on the first tool call. If drawing fails, run \`npx @with-pebbly/aseprite-ai-artist doctor\`.`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: message,
    },
  }),
);
