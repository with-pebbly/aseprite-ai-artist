/**
 * Installing the Aseprite side.
 *
 * Aseprite loads extensions from a per-user config directory whose location
 * differs on every platform and moves between the store and standalone builds.
 * Getting this wrong is the single most common reason a setup "does nothing",
 * so the search order is explicit and `doctor` reports what it found.
 */

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";
import { packageRoot } from "./lib/version.js";

const EXTENSION_DIR_NAME = "aseprite-ai-artist";

/** Candidate Aseprite user-config directories, most likely first. */
export function asepriteConfigCandidates(): string[] {
  const home = homedir();
  const env = process.env.ASEPRITE_USER_FOLDER;
  const candidates: string[] = [];

  if (env) candidates.push(env);

  switch (platform()) {
    case "darwin":
      candidates.push(path.join(home, "Library", "Application Support", "Aseprite"));
      break;
    case "win32": {
      const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
      candidates.push(path.join(appData, "Aseprite"));
      break;
    }
    default: {
      const xdg = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
      candidates.push(path.join(xdg, "aseprite"));
      // Steam and some distro builds keep a dotfile directory instead.
      candidates.push(path.join(home, ".aseprite"));
      break;
    }
  }

  return candidates;
}

export function findAsepriteConfigDir(): string | null {
  for (const dir of asepriteConfigCandidates()) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

export interface InstallExtensionOptions {
  dryRun?: boolean;
  /** Override the Aseprite config directory. */
  configDir?: string | undefined;
}

export interface InstallExtensionResult {
  target: string;
  files: string[];
}

export function installExtension(opts: InstallExtensionOptions = {}): InstallExtensionResult {
  const configDir = opts.configDir ?? findAsepriteConfigDir();
  if (!configDir) {
    throw new Error(
      `Could not find Aseprite's config directory. Looked in:\n  ${asepriteConfigCandidates().join("\n  ")}\n` +
        `Run Aseprite once so it creates the directory, or pass --dir <path>.`,
    );
  }

  const source = path.join(packageRoot(), "extension");
  if (!existsSync(source)) {
    throw new Error(`Bundled extension is missing from the package at ${source}.`);
  }

  const target = path.join(configDir, "extensions", EXTENSION_DIR_NAME);
  const files = readdirSync(source);

  if (opts.dryRun) return { target, files };

  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  return { target, files };
}
