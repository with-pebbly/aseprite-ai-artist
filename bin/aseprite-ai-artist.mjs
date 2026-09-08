#!/usr/bin/env node
/**
 * Launcher for the Claude Code plugin and for anyone running from a checkout.
 *
 * This is Node rather than a shell script on purpose: the plugin manifest names
 * it as the MCP `command`, and Windows does not interpret a `#!` line — a bash
 * shim there simply fails to start, silently, on the one client this project
 * treats as first-class. Node is guaranteed present, because the thing being
 * launched is a Node package.
 *
 * A plugin installed from git arrives as source with no build step, so this
 * builds once on first use and then runs the compiled CLI. Published npm users
 * never touch this file — they run `npx @pebbly/aseprite-ai-artist`.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "dist", "cli.js");

// stderr only: stdout is the MCP stdio channel and any stray byte corrupts it.
const log = (msg) => process.stderr.write(`[aseprite-ai-artist] ${msg}\n`);

if (!existsSync(cli)) {
  log("first run — building…");
  // `shell: true` so npm resolves as npm.cmd on Windows.
  const steps = [
    ["install", "--silent", "--no-audit", "--no-fund"],
    ["run", "--silent", "build"],
  ];
  for (const args of steps) {
    const result = spawnSync("npm", args, { cwd: root, stdio: ["ignore", 2, 2], shell: true });
    if (result.status !== 0) {
      log(`build step \`npm ${args.join(" ")}\` failed with status ${result.status}.`);
      process.exit(result.status ?? 1);
    }
  }
}

const child = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(child.status ?? 1);
