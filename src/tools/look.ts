import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AsepriteLink } from "../bridge/link.js";
import {
  PixelRegion,
  filmstripLayout,
  renderAscii,
  renderDiff,
} from "../lib/render.js";
import { fail, ok, okWithImage, targetShape } from "./kit.js";

/**
 * The "see your own work" tool. Drawing without looking is how an agent ends up
 * confidently reporting a finished sprite that is a smear of misplaced pixels.
 */
export function registerLookTools(server: McpServer, live: AsepriteLink): void {
  server.registerTool(
    "look",
    {
      title: "Look at the sprite",
      description:
        "See what is actually on the canvas. Ops:\n" +
        "• 'preview' — a nearest-neighbour upscaled PNG of the active frame (~1024px long edge). Use for overall read: silhouette, colour, whether it looks like the thing.\n" +
        "• 'ascii' — an exact text grid, one glyph per pixel with a colour legend and coordinate rulers. Use to verify precise pixel positions and values, to count cells, or on any client without vision. Reads up to the whole canvas; pass a region to crop. Glyphs are bound to palette indices, so every region and frame of a sprite agrees on what a glyph means; each read's legend lists only the colours it contains, so merge legends when rows from one piece go into another. Only colours outside the palette (listed in `offPalette`) get per-read glyphs. `rulers=false` prints the bare rows, which `draw` kind 'grid' takes back as-is: read a layer, edit the rows, send them at the same x/y.\n" +
        "• 'filmstrip' — every frame composited into one image. The only reliable way to review an animation, since a vision model reads just the first frame of a GIF.\n" +
        "• 'onion' — the target frame at full opacity over ghosted neighbouring frames, oldest-first. Use to check in-betweens and spacing while animating, without stepping through frames one at a time. Over an opaque background the target hides every ghost — pass `layer` to onion-skin just the part that moves.\n" +
        "• 'diff' — a pixel-level text diff between two frames: '.' unchanged, '-' erased, glyph = the new colour. Use it to confirm exactly what an edit touched.\n" +
        "• 'compare' — the reference layer (left, full opacity) beside the art without any reference layer (right), same frame, same scale. Use it when drawing from a concept or storyboard: name the few largest mismatches and fix only those.\n" +
        "Draw, then look, then fix. Do not report a sprite finished without looking at it.",
      inputSchema: {
        op: z.enum(["preview", "ascii", "filmstrip", "diff", "onion", "compare"]).default("preview"),
        sprite: targetShape.sprite,
        frame: targetShape.frame,
        reference: z.string().optional().describe("Compare: the reference layer. Default 'reference'."),
        fromFrame: z.number().int().positive().optional().describe("Diff: the earlier frame."),
        toFrame: z.number().int().positive().optional().describe("Diff: the later frame."),
        framesBefore: z
          .number()
          .int()
          .min(0)
          .max(8)
          .default(1)
          .describe("Onion: ghost frames before the target."),
        framesAfter: z
          .number()
          .int()
          .min(0)
          .max(8)
          .default(1)
          .describe("Onion: ghost frames after the target."),
        ghostOpacity: z
          .number()
          .int()
          .min(0)
          .max(255)
          .default(90)
          .describe("Onion: opacity of the ghosted (non-target) frames."),
        region: z
          .object({
            x: z.number().int(),
            y: z.number().int(),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          })
          .optional()
          .describe("Crop. Omit to read the whole canvas."),
        layer: z
          .string()
          .optional()
          .describe("Read a single layer instead of the composited image. Honoured by preview, ascii, diff, filmstrip and onion; compare has its own `reference`."),
        rulers: z
          .boolean()
          .default(true)
          .describe(
            "ascii: false drops the coordinate rulers and row labels and returns `gridRows` instead of `text`: rows you can edit and pass straight to `draw` kind 'grid' with the reported origin.",
          ),
        scale: z
          .number()
          .int()
          .positive()
          .max(128)
          .optional()
          .describe(
            "Integer upscale for image ops, 1-128 (clamped so the output stays under ~2048px). Omit it — the automatic choice targets a ~1024px long edge, which is what a vision model can actually read.",
          ),
      },
      outputSchema: {
        op: z.string(),
        sprite: z.string(),
        width: z.number().int(),
        height: z.number().int(),
        scale: z.number().int().optional(),
        text: z.string().optional().describe("The grid: 'ascii' with rulers (the default), and 'diff'."),
        legend: z.record(z.string()).optional().describe("glyph → #rrggbb. Palette colours keep the same glyph across every read of the sprite."),
        offPalette: z
          .array(z.string())
          .optional()
          .describe("ascii/diff: glyphs whose colour is not in the palette. Their assignment can change between reads — do not reuse them across regions."),
        gridRows: z
          .array(z.string())
          .optional()
          .describe("ascii with rulers=false: the bare rows, '.' transparent — `draw` kind 'grid' `rows`, with `legend` and `origin`."),
        origin: z
          .object({ x: z.number().int(), y: z.number().int() })
          .optional()
          .describe("ascii: sprite position of the grid's top-left cell — the `x`/`y` for `draw` kind 'grid'."),
        changedPixels: z.number().int().optional(),
        totalPixels: z.number().int().optional(),
        changedBounds: z
          .object({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() })
          .nullish()
          .describe("Diff: tight bounding box of every changed pixel. Null when nothing changed."),
        percentChanged: z.number().optional().describe("Diff: changed / total * 100."),
        frames: z.number().int().optional().describe("Filmstrip: frame count."),
        framesUsed: z.array(z.number().int()).optional().describe("Onion: 1-based frame numbers composited."),
        columns: z.number().int().optional(),
        rows: z.number().int().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        switch (args.op) {
          case "ascii": {
            const [region, palette] = await Promise.all([readRegion(live, args), readPalette(live, args.sprite)]);
            const view = renderAscii(region, { showRulers: args.rulers, palette });
            return ok(
              {
                op: "ascii",
                sprite: region.spriteName,
                width: view.width,
                height: view.height,
                // One copy of the grid, not two: with rulers the ruled text is what
                // a reader counts against; without them the bare rows are what
                // `draw` kind 'grid' takes back. Sending both doubled every read
                // for clients that hand the model structuredContent.
                ...(args.rulers === false ? { gridRows: view.rows } : { text: view.text }),
                legend: view.legend,
                offPalette: view.offPalette,
                origin: { x: view.originX, y: view.originY },
              },
              `${view.width}×${view.height} at (${view.originX},${view.originY})\n\n${view.text}\n\nLegend: ${formatLegend(view.legend)}\n'.' = transparent${offPaletteNote(view.offPalette)}`,
            );
          }

          case "diff": {
            const from = args.fromFrame ?? 1;
            const to = args.toFrame ?? from + 1;
            const [before, after, palette] = await Promise.all([
              readRegion(live, { ...args, frame: from }),
              readRegion(live, { ...args, frame: to }),
              readPalette(live, args.sprite),
            ]);
            const view = renderDiff(before, after, palette);
            return ok(
              {
                op: "diff",
                sprite: before.spriteName,
                width: before.width,
                height: before.height,
                text: view.text,
                legend: view.legend,
                offPalette: view.offPalette,
                changedPixels: view.changed,
                totalPixels: view.total,
                changedBounds: view.changedBounds,
                percentChanged: view.percentChanged,
              },
              `Frame ${from} → ${to}: ${view.changed} of ${view.total} pixels changed (${view.percentChanged}%).\n\n${view.text}\n\nLegend: ${formatLegend(view.legend)}\n'.' unchanged  '-' erased${offPaletteNote(view.offPalette)}`,
            );
          }

          case "onion": {
            const out = tempPng("onion");
            const meta = await live.call<{
              sprite: string;
              frame: number;
              frames: number[];
              sourceWidth: number;
              sourceHeight: number;
              width: number;
              height: number;
              scale: number;
            }>(
              "look.onion",
              {
                sprite: args.sprite,
                frame: args.frame,
                framesBefore: args.framesBefore,
                framesAfter: args.framesAfter,
                ghostOpacity: args.ghostOpacity,
                layer: args.layer,
                region: args.region,
                path: out,
                scale: args.scale,
              },
              { expect: ["frame", "frames", "sourceWidth", "sourceHeight", "scale"] },
            );
            const image = await readAndClean(out);
            return okWithImage(
              {
                op: "onion",
                sprite: meta.sprite,
                width: meta.sourceWidth,
                height: meta.sourceHeight,
                scale: meta.scale,
                framesUsed: meta.frames,
              },
              image,
              `Onion skin of frame ${meta.frame}: ghosts ${meta.frames.filter((f) => f !== meta.frame).join(", ") || "none"}, target at full opacity, ${meta.scale}× upscale.`,
            );
          }

          case "filmstrip": {
            const out = tempPng("filmstrip");
            const meta = await live.call<{
              sprite: string;
              frames: number;
              width: number;
              height: number;
              scale: number;
            }>(
              "look.filmstrip",
              { sprite: args.sprite, layer: args.layer, path: out, scale: args.scale },
              { expect: ["frames", "width", "height", "scale"] },
            );
            const layout = filmstripLayout(meta.frames);
            const image = await readAndClean(out);
            return okWithImage(
              {
                op: "filmstrip",
                sprite: meta.sprite,
                width: meta.width,
                height: meta.height,
                scale: meta.scale,
                frames: meta.frames,
                columns: layout.cols,
                rows: layout.rows,
              },
              image,
              `Filmstrip of ${meta.frames} frame(s), ${layout.cols}×${layout.rows} grid, ${meta.scale}× upscale. Read left to right, top to bottom; check timing and cross-frame volume drift.`,
            );
          }

          case "compare": {
            const out = tempPng("compare");
            const meta = await live.call<{
              sprite: string;
              frame: number;
              reference: string;
              sourceWidth: number;
              sourceHeight: number;
              scale: number;
            }>(
              "look.compare",
              {
                sprite: args.sprite,
                frame: args.frame,
                reference: args.reference,
                region: args.region,
                path: out,
                scale: args.scale,
              },
              { expect: ["frame", "reference", "sourceWidth", "sourceHeight", "scale"] },
            );
            const image = await readAndClean(out);
            return okWithImage(
              {
                op: "compare",
                sprite: meta.sprite,
                width: meta.sourceWidth,
                height: meta.sourceHeight,
                scale: meta.scale,
              },
              image,
              `Frame ${meta.frame}: '${meta.reference}' on the left, the art on the right, ${meta.scale}× upscale. ` +
                "Name the largest mismatches — silhouette, proportion, pose, colour masses — and fix only those; pixel-level detail is the art's job, not the reference's.",
            );
          }

          default: {
            const out = tempPng("preview");
            const meta = await live.call<{
              sprite: string;
              sourceWidth: number;
              sourceHeight: number;
              width: number;
              height: number;
              scale: number;
            }>(
              "look.preview",
              {
                sprite: args.sprite,
                frame: args.frame,
                layer: args.layer,
                region: args.region,
                path: out,
                // Omitted scale means the extension picks one from the sprite size.
                scale: args.scale,
              },
              { expect: ["sourceWidth", "sourceHeight", "scale"] },
            );
            const image = await readAndClean(out);
            return okWithImage(
              {
                op: "preview",
                sprite: meta.sprite,
                width: meta.sourceWidth,
                height: meta.sourceHeight,
                scale: meta.scale,
              },
              image,
              `${meta.sprite} — ${meta.sourceWidth}×${meta.sourceHeight} shown at ${meta.scale}×. For exact pixel values use op 'ascii'.`,
            );
          }
        }
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "read_pixels",
    {
      title: "Read pixels",
      description:
        "Read a rectangular region as structured data: a list of distinct colours plus a row-major index grid. Use this when you need to compute over pixels (sample a palette from art, find a silhouette edge, copy a region) rather than just look at them. For eyeballing, 'look' is cheaper.",
      inputSchema: {
        ...targetShape,
        region: z
          .object({
            x: z.number().int(),
            y: z.number().int(),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          })
          .optional()
          .describe("Omit to read the whole canvas."),
        composite: z
          .boolean()
          .default(true)
          .describe("Read the flattened image. False reads only the target layer's cel."),
      },
      outputSchema: {
        sprite: z.string(),
        x: z.number().int(),
        y: z.number().int(),
        width: z.number().int(),
        height: z.number().int(),
        colors: z.array(z.string()).describe("Distinct colours; index 0 is fully transparent."),
        grid: z.array(z.number().int()).describe("Row-major indices into `colors`."),
        uniqueColors: z.number().int(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const region = await readRegion(live, args);
        return ok(
          {
            sprite: region.spriteName,
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
            colors: region.colors,
            grid: region.grid,
            uniqueColors: Math.max(0, region.colors.length - 1),
          },
          `${region.width}×${region.height} region, ${Math.max(0, region.colors.length - 1)} distinct colour(s).`,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );
}

interface NamedRegion extends PixelRegion {
  spriteName: string;
}

async function readRegion(
  live: AsepriteLink,
  args: {
    sprite?: string | undefined;
    layer?: string | undefined;
    frame?: number | undefined;
    region?: { x: number; y: number; width: number; height: number } | undefined;
    composite?: boolean | undefined;
  },
): Promise<NamedRegion> {
  const data = await live.call<{
    sprite: string;
    x: number;
    y: number;
    width: number;
    height: number;
    colors: string[];
    grid: number[];
  }>(
    "pixels.read",
    {
      sprite: args.sprite,
      layer: args.layer,
      frame: args.frame,
      region: args.region,
      // `look` has no `composite` field: its `layer` promises a single layer, so
      // naming one must read that layer's cel. Defaulting to the composite here
      // made op 'diff' with layer=… silently diff the whole image.
      composite: args.composite ?? args.layer === undefined,
    },
    { expect: ["x", "y", "width", "height", "colors", "grid"] },
  );
  return { ...data, spriteName: data.sprite };
}

async function readPalette(live: AsepriteLink, sprite: string | undefined): Promise<string[]> {
  const data = await live.call<{ colors: string[] }>("palette.get", { sprite }, { expect: ["colors"] });
  return data.colors;
}

function offPaletteNote(glyphs: string[]): string {
  return glyphs.length === 0
    ? ""
    : `\nOff-palette (glyphs not stable between reads): ${glyphs.join(" ")}`;
}

function tempPng(prefix: string): string {
  return path.join(tmpdir(), `aseprite-ai-artist-${prefix}-${Date.now()}-${process.pid}.png`);
}

async function readAndClean(file: string): Promise<{ data: string; mimeType: string }> {
  const buf = await readFile(file);
  await unlink(file).catch(() => {});
  return { data: buf.toString("base64"), mimeType: "image/png" };
}

function formatLegend(legend: Record<string, string>): string {
  const entries = Object.entries(legend);
  if (entries.length === 0) return "(empty)";
  return entries.map(([g, hex]) => `${g}=${hex}`).join("  ");
}
