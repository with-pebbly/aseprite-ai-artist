/**
 * Client configuration writer.
 *
 * The four target agents disagree on file format (JSON vs TOML), file location,
 * and key names — and getting any of them wrong produces a silent no-op rather
 * than an error. Encoding that here means a user types one command instead of
 * reading four sets of docs.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { packageRoot } from "./lib/version.js";

export type ClientId = "claude" | "codex" | "gemini" | "cursor" | "vscode" | "windsurf";

export const CLIENTS: ClientId[] = ["claude", "codex", "gemini", "cursor", "vscode", "windsurf"];

export interface InstallOptions {
  scope: "user" | "project";
  projectDir: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  dryRun: boolean;
}

export interface InstallResult {
  client: ClientId;
  file: string;
  written: boolean;
  note?: string;
}

export function configPath(client: ClientId, opts: InstallOptions): string {
  const home = homedir();
  const project = opts.projectDir;

  switch (client) {
    case "claude":
      return opts.scope === "user"
        ? path.join(home, ".claude.json")
        : path.join(project, ".mcp.json");
    case "codex":
      return opts.scope === "user"
        ? path.join(home, ".codex", "config.toml")
        : path.join(project, ".codex", "config.toml");
    case "gemini":
      return opts.scope === "user"
        ? path.join(home, ".gemini", "settings.json")
        : path.join(project, ".gemini", "settings.json");
    case "cursor":
      return opts.scope === "user"
        ? path.join(home, ".cursor", "mcp.json")
        : path.join(project, ".cursor", "mcp.json");
    case "vscode":
      return path.join(project, ".vscode", "mcp.json");
    case "windsurf":
      return path.join(home, ".codeium", "windsurf", "mcp_config.json");
  }
}

const SERVER_KEY = "aseprite-ai-artist";

export function install(client: ClientId, opts: InstallOptions): InstallResult {
  const file = configPath(client, opts);
  if (client === "codex") return installToml(file, opts);
  return installJson(client, file, opts);
}

function installJson(client: ClientId, file: string, opts: InstallOptions): InstallResult {
  const existing = readJson(file);

  // VS Code's mcp.json uses `servers`; everyone else uses `mcpServers`.
  const key = client === "vscode" ? "servers" : "mcpServers";
  const servers = (existing[key] as Record<string, unknown> | undefined) ?? {};

  const entry: Record<string, unknown> = {
    command: opts.command,
    args: opts.args,
  };
  if (Object.keys(opts.env).length > 0) entry.env = opts.env;
  // VS Code wants an explicit transport marker.
  if (client === "vscode") entry.type = "stdio";

  const next = { ...existing, [key]: { ...servers, [SERVER_KEY]: entry } };

  if (opts.dryRun) {
    return { client, file, written: false, note: JSON.stringify(next[key], null, 2) };
  }

  backup(file);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n", "utf8");
  return { client, file, written: true };
}

/**
 * Codex uses TOML. Rewriting a whole TOML document without a parser risks
 * mangling comments and unrelated tables, so this only ever appends or replaces
 * the one `[mcp_servers.aseprite-ai-artist]` block and leaves the rest byte
 * for byte as it was.
 */
function installToml(file: string, opts: InstallOptions): InstallResult {
  const header = `[mcp_servers.${SERVER_KEY}]`;
  const lines = [
    header,
    `command = ${tomlString(opts.command)}`,
    `args = [${opts.args.map(tomlString).join(", ")}]`,
  ];
  if (Object.keys(opts.env).length > 0) {
    lines.push("");
    lines.push(`[mcp_servers.${SERVER_KEY}.env]`);
    for (const [k, v] of Object.entries(opts.env)) lines.push(`${k} = ${tomlString(v)}`);
  }
  const block = lines.join("\n") + "\n";

  if (opts.dryRun) return { client: "codex", file, written: false, note: block };

  let existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const start = existing.indexOf(header);
  if (start !== -1) {
    // Replace from our header up to the next top-level table that is not ours.
    const rest = existing.slice(start + header.length);
    const nextTable = rest.search(/\n\[(?!mcp_servers\.aseprite-ai-artist)/);
    const end = nextTable === -1 ? existing.length : start + header.length + nextTable + 1;
    existing = existing.slice(0, start) + existing.slice(end);
  }

  backup(file);
  mkdirSync(path.dirname(file), { recursive: true });
  const separator = existing.length > 0 && !existing.endsWith("\n\n") ? "\n" : "";
  writeFileSync(file, existing.trimEnd() + "\n" + separator + block, "utf8");
  return { client: "codex", file, written: true };
}

/**
 * Write AGENTS.md guidance for clients with no plugin or skill system.
 * Returns the block so callers can show it rather than write it.
 */
export function agentsMarkdown(): string {
  const file = path.join(packageRoot(), "templates", "AGENTS.section.md");
  if (existsSync(file)) return readFileSync(file, "utf8");
  return "";
}

export function mergeAgentsFile(target: string, dryRun: boolean): { written: boolean; file: string } {
  const block = agentsMarkdown();
  const marker = "<!-- aseprite-ai-artist:start -->";
  const endMarker = "<!-- aseprite-ai-artist:end -->";
  const wrapped = `${marker}\n${block.trim()}\n${endMarker}\n`;

  let content = existsSync(target) ? readFileSync(target, "utf8") : "";
  const start = content.indexOf(marker);
  if (start !== -1) {
    const end = content.indexOf(endMarker);
    if (end !== -1) content = content.slice(0, start) + content.slice(end + endMarker.length + 1);
  }
  const next = content.trimEnd() + (content.trim() ? "\n\n" : "") + wrapped;

  if (dryRun) return { written: false, file: target };
  backup(target);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, next, "utf8");
  return { written: true, file: target };
}

function readJson(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch (err) {
    throw new Error(
      `${file} is not valid JSON, so it cannot be edited safely. Fix or move it, then retry. (${(err as Error).message})`,
    );
  }
}

/** Never overwrite someone's config without leaving them a way back. */
function backup(file: string): void {
  if (!existsSync(file)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  copyFileSync(file, `${file}.bak-${stamp}`);
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
