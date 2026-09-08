import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

let cached: string | null = null;

/** Package version, read once from package.json so it cannot drift from npm. */
export function packageVersion(): string {
  if (cached) return cached;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const file = path.resolve(here, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(file, "utf8")) as { version?: string };
    cached = pkg.version ?? "0.0.0";
  } catch {
    cached = "0.0.0";
  }
  return cached;
}

/** Root of the installed package, used to find bundled skills, rules and the extension. */
export function packageRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..");
}
