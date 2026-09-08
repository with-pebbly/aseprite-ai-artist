import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LiveClient } from "../bridge/client.js";
import { buildRamp, contrastRatio, parseHex, snapToPalette, toHex } from "../lib/color.js";
import { fail, hexColor, ok, targetShape } from "./kit.js";

interface Preset {
  name: string;
  author: string;
  size: number;
  notes: string;
  colors: string[];
}

let presetCache: Record<string, Preset> | null = null;

function presets(): Record<string, Preset> {
  if (presetCache) return presetCache;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/tools/palette.js → package root
  const file = path.resolve(here, "..", "..", "knowledge", "palettes.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { presets: Record<string, Preset> };
  presetCache = parsed.presets;
  return presetCache;
}

export function registerPaletteTools(server: McpServer, live: LiveClient): void {
  server.registerTool(
    "palette",
    {
      title: "Palette",
      description:
        "Read and shape the sprite's palette. Ops:\n" +
        "• 'get' — current palette with per-colour usage counts.\n" +
        "• 'set' — write specific indices, or replace the palette wholesale.\n" +
        "• 'preset' — load a bundled palette (pico8, gameboy, gameboy-pocket, cga, 1bit, grayscale-8).\n" +
        "• 'load' — read a .gpl/.hex/.pal/.png palette file from disk.\n" +
        "• 'ramp' — generate a hue-shifted ramp from a base colour and append it. Shadows rotate toward blue, highlights toward orange; a ramp that only changes brightness is the clearest tell of machine-made pixel art.\n" +
        "• 'analyze' — report ramp structure, contrast, near-duplicate entries and colours used in the art that are not in the palette.\n" +
        "Decide the palette before drawing. Retro-fitting one onto finished art means repainting.",
      inputSchema: {
        op: z.enum(["get", "set", "preset", "load", "ramp", "analyze"]),
        sprite: targetShape.sprite,
        preset: z.string().optional().describe("Preset key for op 'preset'."),
        path: z.string().optional().describe("Palette file for op 'load'."),
        colors: z
          .array(hexColor)
          .optional()
          .describe("For op 'set': the colours to write."),
        startIndex: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("For op 'set': where `colors` starts. Ignored when `replace` is true."),
        replace: z
          .boolean()
          .default(false)
          .describe("For op 'set'/'preset': replace the whole palette instead of merging."),
        base: hexColor.optional().describe("Base colour for op 'ramp'."),
        steps: z.number().int().min(2).max(16).default(5).describe("Ramp length."),
        spread: z
          .number()
          .min(0.1)
          .max(1)
          .default(0.55)
          .describe("How far the ramp reaches into shadow and light."),
        remapArt: z
          .boolean()
          .default(false)
          .describe(
            "When replacing a palette, repaint existing pixels to the nearest new colour instead of leaving them off-palette.",
          ),
      },
      outputSchema: {
        op: z.string(),
        sprite: z.string().optional(),
        colors: z.array(z.string()).optional(),
        size: z.number().int().optional(),
        usage: z
          .array(z.object({ index: z.number().int(), hex: z.string(), pixels: z.number().int() }))
          .optional(),
        ramp: z.array(z.string()).optional(),
        analysis: z
          .object({
            size: z.number().int(),
            unusedIndices: z.array(z.number().int()),
            nearDuplicates: z.array(
              z.object({ a: z.string(), b: z.string(), deltaE: z.number() }),
            ),
            offPaletteColors: z.array(z.object({ hex: z.string(), pixels: z.number().int() })),
            lowestContrastPair: z
              .object({ a: z.string(), b: z.string(), ratio: z.number() })
              .nullish(),
            verdict: z.string(),
          })
          .optional(),
        availablePresets: z
          .array(z.object({ key: z.string(), name: z.string(), size: z.number().int(), notes: z.string() }))
          .optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        switch (args.op) {
          case "ramp": {
            if (!args.base) return fail(new Error("op 'ramp' needs a `base` colour."));
            const ramp = buildRamp(parseHex(args.base), args.steps, args.spread);
            const data = await live.call<Record<string, unknown>>("palette.set", {
              sprite: args.sprite,
              colors: ramp,
              append: true,
            });
            return ok(
              { op: "ramp", ramp, ...data },
              `Appended a ${args.steps}-step hue-shifted ramp from ${args.base}: ${ramp.join(" ")}`,
            );
          }

          case "preset": {
            const key = (args.preset ?? "").toLowerCase();
            const table = presets();
            const chosen = table[key];
            if (!chosen) {
              return ok(
                {
                  op: "preset",
                  availablePresets: Object.entries(table).map(([k, p]) => ({
                    key: k,
                    name: p.name,
                    size: p.size,
                    notes: p.notes,
                  })),
                },
                `Unknown preset '${args.preset ?? ""}'. Available: ${Object.keys(table).join(", ")}. Any other palette can be loaded from a file with op 'load'.`,
              );
            }
            const data = await live.call<Record<string, unknown>>("palette.set", {
              sprite: args.sprite,
              colors: chosen.colors,
              replace: args.replace !== false,
              remapArt: args.remapArt,
            });
            return ok(
              { op: "preset", colors: chosen.colors, size: chosen.colors.length, ...data },
              `Loaded ${chosen.name} (${chosen.colors.length} colours). ${chosen.notes}`,
            );
          }

          case "load": {
            if (!args.path) return fail(new Error("op 'load' needs a `path`."));
            const data = await live.call<Record<string, unknown>>("palette.load", {
              sprite: args.sprite,
              path: args.path,
              replace: args.replace,
              remapArt: args.remapArt,
            });
            return ok({ op: "load", ...data });
          }

          case "set": {
            if (!args.colors || args.colors.length === 0) {
              return fail(new Error("op 'set' needs at least one colour."));
            }
            const data = await live.call<Record<string, unknown>>("palette.set", {
              sprite: args.sprite,
              colors: args.colors,
              startIndex: args.startIndex,
              replace: args.replace,
              remapArt: args.remapArt,
            });
            return ok({ op: "set", ...data });
          }

          case "analyze": {
            const state = await live.call<{
              sprite: string;
              colors: string[];
              usage: { index: number; hex: string; pixels: number }[];
              offPalette: { hex: string; pixels: number }[];
            }>("palette.stats", { sprite: args.sprite });
            return ok(
              { op: "analyze", sprite: state.sprite, colors: state.colors, analysis: analyze(state) },
              describeAnalysis(analyze(state)),
            );
          }

          default: {
            const data = await live.call<Record<string, unknown>>("palette.get", {
              sprite: args.sprite,
            });
            const colors = (data.colors as string[]) ?? [];
            return ok(
              { op: "get", ...data },
              `${colors.length} colours: ${colors.join(" ")}`,
            );
          }
        }
      } catch (err) {
        return fail(err);
      }
    },
  );
}

interface PaletteStats {
  sprite: string;
  colors: string[];
  usage: { index: number; hex: string; pixels: number }[];
  offPalette: { hex: string; pixels: number }[];
}

function analyze(state: PaletteStats) {
  const unusedIndices = state.usage.filter((u) => u.pixels === 0).map((u) => u.index);

  const nearDuplicates: { a: string; b: string; deltaE: number }[] = [];
  for (let i = 0; i < state.colors.length; i++) {
    const a = state.colors[i];
    if (!a) continue;
    // Only compare forward, and only against the rest of the palette.
    const rest = state.colors.slice(i + 1);
    if (rest.length === 0) continue;
    const snap = snapToPalette(parseHex(a), rest);
    if (snap.distance < 3) {
      nearDuplicates.push({ a, b: snap.hex, deltaE: round(snap.distance) });
    }
  }

  let lowestContrastPair: { a: string; b: string; ratio: number } | null = null;
  const used = state.usage.filter((u) => u.pixels > 0).slice(0, 32);
  for (let i = 0; i < used.length; i++) {
    for (let j = i + 1; j < used.length; j++) {
      const a = used[i]!;
      const b = used[j]!;
      const ratio = contrastRatio(parseHex(a.hex), parseHex(b.hex));
      if (!lowestContrastPair || ratio < lowestContrastPair.ratio) {
        lowestContrastPair = { a: a.hex, b: b.hex, ratio: round(ratio) };
      }
    }
  }

  const problems: string[] = [];
  if (state.offPalette.length > 0) {
    problems.push(`${state.offPalette.length} colour(s) in the art are not in the palette`);
  }
  if (nearDuplicates.length > 0) {
    problems.push(`${nearDuplicates.length} near-duplicate palette entr(ies) (ΔE < 3)`);
  }
  if (state.colors.length > 64) {
    problems.push(`${state.colors.length} colours is large for pixel art; most sprites read better under 32`);
  }

  return {
    size: state.colors.length,
    unusedIndices,
    nearDuplicates,
    offPaletteColors: state.offPalette,
    lowestContrastPair,
    verdict: problems.length === 0 ? "clean" : problems.join("; "),
  };
}

function describeAnalysis(a: ReturnType<typeof analyze>): string {
  const lines = [`Palette: ${a.size} colours — ${a.verdict}.`];
  if (a.offPaletteColors.length > 0) {
    lines.push(
      `Off-palette: ${a.offPaletteColors
        .slice(0, 8)
        .map((c) => `${c.hex} (${c.pixels}px)`)
        .join(", ")}. Use recolor op 'snap' to bring them in line.`,
    );
  }
  if (a.nearDuplicates.length > 0) {
    lines.push(
      `Near-duplicates: ${a.nearDuplicates.slice(0, 5).map((d) => `${d.a}≈${d.b}`).join(", ")}. Merging them makes ramps read more clearly.`,
    );
  }
  if (a.unusedIndices.length > 0) lines.push(`${a.unusedIndices.length} palette slot(s) unused.`);
  return lines.join(" ");
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
