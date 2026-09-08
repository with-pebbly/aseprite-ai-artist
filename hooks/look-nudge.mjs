#!/usr/bin/env node
/**
 * After a mutating pixel operation, remind the model to look at the result.
 *
 * Not looking is the single most common failure mode: the tool result says
 * "412 pixels changed" and the model reports a finished sprite it has never
 * seen. The nudge fires once per session so it stays a reminder rather than
 * noise the model learns to skip.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const sessionId = payload.session_id || "unknown";
const stateDir = path.join(
  process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), "aseprite-ai-artist"),
  "look-nudge",
);
const marker = path.join(stateDir, `${sessionId}.seen`);

if (existsSync(marker)) process.exit(0);

try {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(marker, String(Date.now()));
} catch {
  // A hook that cannot write its marker should still nudge once, not crash.
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        "You just changed pixels. Call `look` before deciding whether it worked — op 'preview' for the overall read, op 'ascii' for exact pixel positions. A tool result saying pixels changed is not evidence that the sprite is right.",
    },
  }),
);
