/**
 * Skills, served over MCP.
 *
 * Claude Code reads `skills/` out of the plugin directory directly. Codex,
 * Gemini CLI and Cursor have no such concept — so without this, everyone except
 * Claude Code gets raw tools and none of the craft that makes the tools produce
 * decent sprites. Serving the same markdown as MCP resources *and* MCP prompts
 * closes that gap with one source of truth on disk.
 *
 * Resources are the discovery surface (an agent can list and read them at will);
 * prompts are the invocation surface (they show up as slash commands in clients
 * that render them). Both point at the same file.
 *
 * Tracks the Skills Extension direction of the MCP Skills-over-MCP WG
 * (SEP-2640, resources-based). When that lands in the SDK the transport here
 * becomes the standard one; the on-disk format does not change.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";

export interface SkillDoc {
  /** Directory name, and the name the agent invokes. */
  name: string;
  title: string;
  description: string;
  /** Full markdown body, frontmatter stripped. */
  body: string;
  file: string;
  /** Extra files shipped next to SKILL.md, exposed as sub-resources. */
  assets: string[];
}

export interface RuleDoc {
  name: string;
  title: string;
  body: string;
  file: string;
}

export function loadSkills(root: string): SkillDoc[] {
  const dir = path.join(root, "skills");
  if (!existsSync(dir)) return [];

  const out: SkillDoc[] = [];
  for (const entry of readdirSync(dir)) {
    const skillDir = path.join(dir, entry);
    if (!statSync(skillDir).isDirectory()) continue;
    const file = path.join(skillDir, "SKILL.md");
    if (!existsSync(file)) continue;

    const raw = readFileSync(file, "utf8");
    const { frontmatter, body } = splitFrontmatter(raw);

    out.push({
      name: frontmatter.name ?? entry,
      title: frontmatter.title ?? frontmatter.name ?? entry,
      description: frontmatter.description ?? "",
      body,
      file,
      assets: readdirSync(skillDir)
        .filter((f) => f !== "SKILL.md" && statSync(path.join(skillDir, f)).isFile())
        .map((f) => path.join(skillDir, f)),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function loadRules(root: string): RuleDoc[] {
  const dir = path.join(root, "rules");
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort()
    .map((f) => {
      const file = path.join(dir, f);
      const body = readFileSync(file, "utf8");
      const name = f.replace(/\.md$/, "");
      const heading = /^#\s+(.+)$/m.exec(body);
      return { name, title: heading?.[1] ?? name, body, file };
    });
}

interface Frontmatter {
  name?: string;
  title?: string;
  description?: string;
  [k: string]: string | undefined;
}

/**
 * Deliberately minimal YAML handling: skill frontmatter is flat `key: value`
 * with optional quotes. Pulling in a YAML parser to read six keys would add a
 * dependency to a package whose whole distribution pitch is `npx`, no install.
 */
function splitFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  if (!raw.startsWith("---")) return { frontmatter: {}, body: raw };

  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: {}, body: raw };

  const header = raw.slice(3, end);
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  const frontmatter: Frontmatter = {};

  for (const line of header.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (!m || !m[1]) continue;
    let value = (m[2] ?? "").trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[m[1]] = value;
  }

  return { frontmatter, body };
}

/**
 * The server's `instructions` string — the one piece of guidance every MCP
 * client sees, whether or not it understands skills or plugins. Keep it short:
 * it is paid for on every session, so it carries only the rules an agent gets
 * wrong catastrophically, and points at the skills for everything else.
 */
export function serverInstructions(skills: SkillDoc[]): string {
  const catalogue = skills.map((s) => `  - ${s.name}: ${s.description}`).join("\n");

  return `Aseprite AI Artist — draw pixel art in the user's OPEN Aseprite window.

Non-negotiables:
1. Call \`preflight\` before anything else. If ready is false, stop and tell the user. Never fall back to editing .aseprite/.png files on disk — the user would not see those changes and a later save would overwrite them.
2. Call \`sprite_info\` before your first edit. Layer names, frame count and palette must come from the document, never from assumption.
3. Batch. One \`draw\` call carrying every op is right; forty calls carrying one op each is wrong. Each call is one undo step for the user.
4. Look at your work. After drawing, call \`look\` (op 'preview' to judge the read, op 'ascii' to verify exact pixels). Do not report a sprite finished without looking at it.
5. Keep the palette. \`draw\` and \`recolor\` snap to the sprite's palette by default. If a colour you want is far from every palette entry, say so and ask before widening the palette.
6. Run \`validate\` before declaring done.

Craft rules live in the \`rules://\` resources (read \`rules://index\` first). Workflows live in the \`skill://\` resources and as prompts:
${catalogue}

Read the skill that matches the task before starting it.`;
}
