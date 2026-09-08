#!/usr/bin/env node
/**
 * One binary, several jobs:
 *   serve              (default) speak MCP over stdio
 *   bridge             run the singleton WebSocket relay
 *   install <client…>  wire this server into an agent's config
 *   install-extension  copy the Lua extension into Aseprite
 *   doctor             tell the user exactly what is broken
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Bridge } from "./bridge/bridge.js";
import { LiveClient } from "./bridge/client.js";
import { createServer } from "./server.js";
import {
  CLIENTS,
  ClientId,
  configPath,
  install,
  mergeAgentsFile,
} from "./install.js";
import { installExtension, findAsepriteConfigDir } from "./extension.js";
import { DEFAULT_CONTROL_PORT, DEFAULT_PLUGIN_PORT } from "./lib/protocol.js";
import { packageVersion } from "./lib/version.js";

interface Flags {
  [key: string]: string | boolean;
}

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Flags } {
  const flags: Flags = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }

  const command = positional.shift() ?? "serve";
  return { command, positional, flags };
}

function num(flags: Flags, key: string, fallback: number): number {
  const raw = flags[key];
  if (typeof raw !== "string") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : fallback;
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));

  if (flags.version || command === "version") {
    process.stdout.write(`${packageVersion()}\n`);
    return;
  }
  if (flags.help || command === "help") {
    printHelp();
    return;
  }

  const pluginPort = num(flags, "plugin-port", envPort("ASEPRITE_AI_PLUGIN_PORT", DEFAULT_PLUGIN_PORT));
  const controlPort = num(flags, "control-port", envPort("ASEPRITE_AI_CONTROL_PORT", pluginPort + 1));

  switch (command) {
    case "serve":
      return serve({ pluginPort, controlPort, allowLua: truthy(flags.allowLua ?? process.env.ASEPRITE_AI_ALLOW_LUA) });
    case "bridge":
      return runBridge({ pluginPort, controlPort });
    case "install":
      return runInstall(positional, flags);
    case "install-extension":
      return runInstallExtension(flags);
    case "doctor":
      return doctor({ pluginPort, controlPort });
    default:
      process.stderr.write(`Unknown command '${command}'.\n\n`);
      printHelp();
      process.exitCode = 2;
  }
}

async function serve(opts: { pluginPort: number; controlPort: number; allowLua: boolean }): Promise<void> {
  const { server, live } = createServer({
    pluginPort: opts.pluginPort,
    controlPort: opts.controlPort,
    allowLua: opts.allowLua,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    live.close();
    // .finally() forwards a rejection, and nothing would catch it. Exit on both
    // paths explicitly rather than relying on process.exit winning the race.
    server.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function runBridge(opts: { pluginPort: number; controlPort: number }): Promise<void> {
  const bridge = new Bridge({
    pluginPort: opts.pluginPort,
    controlPort: opts.controlPort,
    version: packageVersion(),
    log: (msg) => process.stderr.write(`[bridge] ${msg}\n`),
  });

  const started = await bridge.start();
  if (!started) {
    // Losing the race is the normal outcome when a bridge already runs.
    process.stderr.write("[bridge] another bridge already owns these ports; exiting\n");
    return;
  }

  const stop = () =>
    bridge.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // Hold the process open; the WebSocket servers keep the loop alive anyway.
  await new Promise(() => {});
}

async function runInstall(positional: string[], flags: Flags): Promise<void> {
  const requested = positional.length > 0 ? positional : (flags.all ? CLIENTS : []);
  if (requested.length === 0) {
    process.stderr.write(
      `Name at least one client, or pass --all.\nAvailable: ${CLIENTS.join(", ")}\n`,
    );
    process.exitCode = 2;
    return;
  }

  const scope = flags.project ? "project" : "user";
  const projectDir = typeof flags.dir === "string" ? flags.dir : process.cwd();
  const dryRun = truthy(flags["dry-run"]);

  const env: Record<string, string> = {};
  if (typeof flags.aseprite === "string") env.ASEPRITE_PATH = flags.aseprite;
  if (truthy(flags.allowLua)) env.ASEPRITE_AI_ALLOW_LUA = "1";

  const opts = {
    scope: scope as "user" | "project",
    projectDir,
    command: "npx",
    args: ["-y", "@pebbly/aseprite-ai-artist@latest", "serve"],
    env,
    dryRun,
  };

  for (const name of requested) {
    if (!CLIENTS.includes(name as ClientId)) {
      process.stderr.write(`Unknown client '${name}'. Available: ${CLIENTS.join(", ")}\n`);
      process.exitCode = 2;
      return;
    }
  }

  for (const name of requested as ClientId[]) {
    try {
      const result = install(name, opts);
      if (dryRun) {
        process.stdout.write(`\n# ${name} → ${result.file}\n${result.note ?? ""}\n`);
      } else {
        process.stdout.write(`✓ ${name.padEnd(9)} ${result.file}\n`);
      }
    } catch (err) {
      process.stdout.write(`✗ ${name.padEnd(9)} ${(err as Error).message}\n`);
      process.exitCode = 1;
    }
  }

  if (truthy(flags.agents)) {
    const target = typeof flags.agents === "string" ? flags.agents : `${projectDir}/AGENTS.md`;
    const res = mergeAgentsFile(target, dryRun);
    process.stdout.write(`${res.written ? "✓" : "·"} AGENTS.md ${res.file}\n`);
  }

  if (!dryRun) {
    process.stdout.write(
      "\nRestart the agent so it picks up the new server, then run `install-extension` if you have not already.\n",
    );
  }
}

async function runInstallExtension(flags: Flags): Promise<void> {
  try {
    const result = installExtension({
      dryRun: truthy(flags["dry-run"]),
      configDir: typeof flags.dir === "string" ? flags.dir : undefined,
    });
    process.stdout.write(`✓ extension → ${result.target}\n`);
    process.stdout.write(
      "Restart Aseprite. The extension connects on startup; check Edit ▸ Preferences ▸ Extensions if it does not appear.\n",
    );
  } catch (err) {
    process.stdout.write(`✗ ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}

async function doctor(opts: { pluginPort: number; controlPort: number }): Promise<void> {
  const lines: string[] = [`aseprite-ai-artist ${packageVersion()}`, ""];

  const configDir = findAsepriteConfigDir();
  lines.push(
    configDir
      ? `✓ Aseprite config dir   ${configDir}`
      : "✗ Aseprite config dir   not found — is Aseprite installed and has it been run once?",
  );

  // Probe before spawning anything. "The bridge is up" and "the bridge is up
  // because I just started it" are different answers, and only the first is a
  // diagnosis — reporting the second as a tick tells the user their setup works
  // when all that works is this command.
  const probe = new LiveClient({
    controlPort: opts.controlPort,
    pluginPort: opts.pluginPort,
    autoSpawnBridge: false,
    log: () => {},
  });
  const wasAlreadyRunning = await probe.waitForBridge(1_500);
  probe.close();

  // Reaching Aseprite at all requires a bridge — the extension connects to it,
  // not to us — so start one when there is none, and stop it again below.
  const live = new LiveClient({
    controlPort: opts.controlPort,
    pluginPort: opts.pluginPort,
    autoSpawnBridge: !wasAlreadyRunning,
    log: () => {},
  });

  const bridgeUp = await live.waitForBridge(4_000);
  lines.push(
    !bridgeUp
      ? `✗ Bridge                 could not reach or start it on :${opts.controlPort}`
      : wasAlreadyRunning
        ? `✓ Bridge                 ws://127.0.0.1:${opts.controlPort}`
        : `· Bridge                 not running — started one to test, stopping it again below`,
  );

  const pluginUp = bridgeUp ? await live.waitForPlugin(4_000) : false;
  lines.push(
    pluginUp
      ? `✓ Aseprite extension     ${live.hello?.extensionVersion ?? "?"} on Aseprite ${live.hello?.asepriteVersion ?? "?"}`
      : bridgeUp
        ? "✗ Aseprite extension     not connected — open Aseprite, or run `install-extension` and restart it"
        : "· Aseprite extension     unknown — cannot be checked without a bridge",
  );

  if (pluginUp) {
    lines.push(`  features               ${live.features.join(", ") || "(none)"}`);
    try {
      const site = await live.call<{ sprite: { name?: string } | null }>("session.site");
      lines.push(
        site.sprite
          ? `✓ Active sprite          ${site.sprite.name ?? "untitled"}`
          : "· Active sprite          none open (that is fine)",
      );
    } catch (err) {
      lines.push(`✗ Round trip             ${(err as Error).message}`);
    }
  }

  lines.push("");
  lines.push("Client config locations:");
  for (const client of CLIENTS) {
    lines.push(
      `  ${client.padEnd(9)} ${configPath(client, {
        scope: "user",
        projectDir: process.cwd(),
        command: "",
        args: [],
        env: {},
        dryRun: true,
      })}`,
    );
  }

  live.close();

  // A diagnostic must not leave a daemon behind. Only ever the one this run
  // started: a bridge that was already there belongs to a live session.
  const startedPid = live.spawnedBridgePid;
  if (startedPid !== null) {
    try {
      process.kill(startedPid);
      lines.push("", `· Stopped the bridge this check started (pid ${startedPid}).`);
    } catch {
      // Already gone — it lost the port race, or exited on its own.
    }
  }

  process.stdout.write(lines.join("\n") + "\n");
  process.exitCode = pluginUp ? 0 : 1;
}

function printHelp(): void {
  process.stdout.write(
    `aseprite-ai-artist ${packageVersion()} — agent control layer for Aseprite

Usage:
  aseprite-ai-artist [serve]                 Speak MCP over stdio (what agents run)
  aseprite-ai-artist bridge                  Run the WebSocket relay (usually auto-started)
  aseprite-ai-artist install <client…>       Write MCP config for an agent
  aseprite-ai-artist install-extension       Install the Aseprite Lua extension
  aseprite-ai-artist doctor                  Diagnose a broken setup

Clients: ${CLIENTS.join(", ")}

Options:
  --all                Install for every supported client
  --project            Write project-scoped config instead of user-scoped
  --dir <path>         Project directory (default: cwd)
  --agents [path]      Also write an AGENTS.md section (default: ./AGENTS.md)
  --aseprite <path>    Path to the Aseprite executable
  --allowLua           Enable the run_lua escape hatch (arbitrary code in Aseprite)
  --plugin-port <n>    Port the Aseprite extension dials (default ${DEFAULT_PLUGIN_PORT})
  --control-port <n>   Port MCP servers dial (default ${DEFAULT_CONTROL_PORT})
  --dry-run            Print what would change, write nothing
  --version, --help

Examples:
  npx @pebbly/aseprite-ai-artist install --all --agents
  npx @pebbly/aseprite-ai-artist install codex cursor --project
  npx @pebbly/aseprite-ai-artist doctor
`,
  );
}

function truthy(value: unknown): boolean {
  return value === true || value === "1" || value === "true" || value === "yes";
}

function envPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : fallback;
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
