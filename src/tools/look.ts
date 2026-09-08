import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LiveClient } from "../bridge/client.js";
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
export function registerLookTools(server: McpServer, live: LiveClient): void {
  server.registerTool(
    "look",
    {
      title: "Look at the sprite",
      description:
        "See what is actually on the canvas. Ops:\n" +
        "• 'preview' — a nearest-neighbour upscaled PNG of the active frame (~1024px long edge). Use for overall read: silhouette, colour, whether it looks like the thing.\n" +
        "• 'ascii' — an exact text grid, one glyph per pixel with a colour legend and coordinate rulers. Use to verify precise pixel positions and values, to count cells, or on any client without vision. Capped at 64×64; pass a region to crop.\n" +
        "• 'filmstrip' — every frame composited into one image. The only reliable way to review an animation, since a vision model reads just the first frame of a GIF.\n" +
        "• 'diff' — a pixel-level text diff between two frames: '.' unchanged, '-' erased, glyph = the new colour. Use it to confirm exactly what an edit touched.\n" +
        "Draw, then look, then fix. Do not report a sprite finished without looking at it.",
      inputSchema: {
        op: z.enum(["preview", "ascii", "filmstrip", "diff"]).default("preview"),
        sprite: targetShape.sprite,
        frame: targetShape.frame,
        fromFrame: z.number().int().positive().optional().describe("Diff: the earlier frame."),
        toFrame: z.number().int().positive().optional().describe("Diff: the later frame."),
        region: z
          .object({
            x: z.number().int(),
            y: z.number().int(),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          })
          .optional()
          .describe("Crop. Required for 'ascii' on sprites larger than 64×64."),
        layer: z
          .string()
          .optional()
          .describe("Read a single layer instead of the composited image."),
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
        text: z.string().optional().describe("The grid, for 'ascii' and 'diff'."),
        legend: z.record(z.string()).optional().describe("glyph → #rrggbb."),
        changedPixels: z.number().int().optional(),
        totalPixels: z.number().int().optional(),
        frames: z.number().int().optional(),
        columns: z.number().int().optional(),
        rows: z.number().int().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        switch (args.op) {
          case "ascii": {
            const region = await readRegion(live, args);
            const view = renderAscii(region);
            return ok(
              {
                op: "ascii",
                sprite: region.spriteName,
                width: view.width,
                height: view.height,
                text: view.text,
                legend: view.legend,
              },
              `${view.width}×${view.height} at (${view.originX},${view.originY})\n\n${view.text}\n\nLegend: ${formatLegend(view.legend)}\n'.' = transparent`,
            );
          }

          case "diff": {
            const from = args.fromFrame ?? 1;
            const to = args.toFrame ?? from + 1;
            const [before, after] = await Promise.all([
              readRegion(live, { ...args, frame: from }),
              readRegion(live, { ...args, frame: to }),
            ]);
            const view = renderDiff(before, after);
            return ok(
              {
                op: "diff",
                sprite: before.spriteName,
                width: before.width,
                height: before.height,
                text: view.text,
                legend: view.legend,
                changedPixels: view.changed,
                totalPixels: view.total,
              },
              `Frame ${from} → ${to}: ${view.changed} of ${view.total} pixels changed.\n\n${view.text}\n\nLegend: ${formatLegend(view.legend)}\n'.' unchanged  '-' erased`,
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
            }>("look.filmstrip", {
              sprite: args.sprite,
              path: out,
              scale: args.scale,
            });
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

          default: {
            const out = tempPng("preview");
            const meta = await live.call<{
              sprite: string;
              sourceWidth: number;
              sourceHeight: number;
              width: number;
              height: number;
              scale: number;
            }>("look.preview", {
              sprite: args.sprite,
              frame: args.frame,
              layer: args.layer,
              region: args.region,
              path: out,
              // Omitted scale means the extension picks one from the sprite size.
              scale: args.scale,
            });
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
  live: LiveClient,
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
  }>("pixels.read", {
    sprite: args.sprite,
    layer: args.layer,
    frame: args.frame,
    region: args.region,
    composite: args.composite ?? true,
  });
  return { ...data, spriteName: data.sprite };
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
