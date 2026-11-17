import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AsepriteLink } from "../bridge/link.js";
import { LiveError } from "../lib/protocol.js";
import { compileGrid, compileImage, gridRowsFromText, readOpFile, type CanvasSize } from "../lib/grid.js";
import { decodePng } from "../lib/png.js";
import { layoutText, loadFont, type TextAnchor } from "../lib/text.js";
import { fail, hexColor, ok, targetShape } from "./kit.js";

const textAnchor = z.enum([
  "top_left", "top", "top_right",
  "left", "center", "right",
  "bottom_left", "bottom", "bottom_right",
  "baseline_left", "baseline", "baseline_right",
]) satisfies z.ZodType<TextAnchor>;

const pointWithColor = z.object({
  x: z.number().int(),
  y: z.number().int(),
  color: hexColor.optional().describe("Per-pixel colour. Falls back to the op's `color`."),
});

const rectShape = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/**
 * One batch tool instead of a dozen primitives.
 *
 * Two reasons. First, an agent drawing a 32×32 sprite one primitive per tool
 * call burns a round trip per stroke and fills its own context with acks.
 * Second — and this is the part that matters to the person watching — every op
 * in a batch lands inside a single Aseprite transaction, so one Ctrl+Z undoes
 * "the agent's last edit" rather than one of forty stray pixels.
 */
const drawOp = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pixels"),
    color: hexColor.optional(),
    points: z.array(pointWithColor).min(1).max(20000),
  }),
  z.object({
    kind: z.literal("line"),
    color: hexColor,
    from: z.object({ x: z.number().int(), y: z.number().int() }),
    to: z.object({ x: z.number().int(), y: z.number().int() }),
    thickness: z.number().int().positive().max(64).default(1),
  }),
  z.object({
    kind: z.literal("polyline"),
    color: hexColor,
    points: z.array(z.object({ x: z.number().int(), y: z.number().int() })).min(2),
    closed: z.boolean().default(false),
    fill: hexColor.optional().describe("Fill colour; only meaningful when closed."),
  }),
  z.object({
    kind: z.literal("rect"),
    color: hexColor.describe("Outline colour."),
    rect: rectShape,
    fill: hexColor.optional().describe("Omit for an outline only."),
  }),
  z.object({
    kind: z.literal("ellipse"),
    color: hexColor,
    rect: rectShape.describe("Bounding box of the ellipse."),
    fill: hexColor.optional(),
  }),
  z.object({
    kind: z.literal("fill"),
    color: hexColor,
    at: z.object({ x: z.number().int(), y: z.number().int() }),
    tolerance: z.number().int().min(0).max(255).default(0).describe("Largest per-channel difference (0–255) still counted as the clicked colour. RGB sprites only; indexed and grayscale fills stay exact."),
    contiguous: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal("replace"),
    from: hexColor,
    to: hexColor,
    region: rectShape.optional(),
  }),
  z.object({
    kind: z.literal("dither"),
    rect: rectShape,
    colorA: hexColor,
    colorB: hexColor,
    pattern: z.enum(["checker", "bayer2", "bayer4", "bayer8", "noise"]).default("bayer4"),
    ratio: z
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .describe("0 = all colorA, 1 = all colorB."),
  }),
  z.object({
    kind: z.literal("gradient"),
    rect: rectShape,
    from: hexColor,
    to: hexColor,
    direction: z.enum(["vertical", "horizontal", "diagonal", "radial"]).default("vertical"),
    steps: z
      .number()
      .int()
      .min(2)
      .max(64)
      .default(4)
      .describe("Banded, not smooth — a smooth gradient is not pixel art."),
    dither: z.boolean().default(false).describe("Dither the band boundaries."),
  }),
  z.object({
    kind: z.literal("clear"),
    region: rectShape.optional().describe("Omit to clear the whole cel."),
  }),
  z.object({
    kind: z.literal("blit"),
    from: rectShape,
    to: z.object({ x: z.number().int(), y: z.number().int() }),
    fromFrame: z.number().int().positive().optional(),
    fromLayer: z.string().optional(),
    flipHorizontal: z.boolean().default(false),
    flipVertical: z.boolean().default(false),
    skipTransparent: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal("text"),
    text: z.string().min(1).describe("Multiline via \\n."),
    x: z.number().int(),
    y: z.number().int(),
    color: hexColor,
    font: z.string().default("pixel5x7").describe("Name in knowledge/fonts, without the .json extension."),
    anchor: textAnchor
      .default("top_left")
      .describe("Resolved against the glyph ink box, not the full advance box — outline and shadow never shift it."),
    letterSpacing: z.number().int().default(1),
    lineSpacing: z.number().int().default(1),
    bold: z.number().int().min(0).max(3).default(0).describe("Grid-cell passes grown rightward; 0 is regular weight."),
    outlineColor: hexColor.optional(),
    outlineDiagonals: z.boolean().default(true).describe("8-neighbour outline instead of 4."),
    shadowColor: hexColor.optional(),
    shadowOffset: z.object({ x: z.number().int(), y: z.number().int() }).default({ x: 1, y: 1 }),
    scale: z.number().int().min(1).max(8).default(1),
  }),
  z.object({
    kind: z.literal("grid"),
    x: z.number().int().default(0).describe("Sprite x of the grid's left column."),
    y: z.number().int().default(0).describe("Sprite y of the grid's top row."),
    legend: z
      .record(z.string(), hexColor.nullable())
      .describe("One character → colour; null is transparent. '.' is transparent unless you redefine it."),
    rows: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe("Top to bottom, one character per pixel, every row the same width. Up to the canvas size. Give this or `file`."),
    file: z
      .string()
      .optional()
      .describe(
        "Instead of `rows`: a text file with the same rows, one per line (relative to your working directory). Use it when a script wrote the grid — no retyping.",
      ),
    transparent: z
      .enum(["erase", "skip"])
      .default("erase")
      .describe(
        "Transparent cells: 'erase' clears them, so the grid's rectangle ends up exactly as written; 'skip' leaves the pixel underneath, to stamp a shape over existing art.",
      ),
  }),
  z.object({
    kind: z.literal("image"),
    path: z.string().describe("A PNG at 1× (one image pixel = one sprite pixel), relative to your working directory."),
    x: z.number().int().default(0).describe("Sprite x of the image's left column."),
    y: z.number().int().default(0).describe("Sprite y of the image's top row."),
    crop: rectShape.optional().describe("Use only this rectangle of the PNG — one frame or layer cell of a sheet."),
    transparent: z
      .enum(["erase", "skip"])
      .default("erase")
      .describe("Alpha-0 pixels: 'erase' clears them, 'skip' leaves the pixel underneath. Partial alpha is refused."),
  }),
]);

export function registerDrawTools(server: McpServer, live: AsepriteLink): void {
  server.registerTool(
    "draw",
    {
      title: "Draw",
      description:
        "Apply a batch of drawing operations to one cel, as a single undoable action. Ops: pixels, line, polyline, rect, ellipse, fill, replace, dither, gradient, clear, blit, text, grid, image. " +
        "Batch aggressively — a whole sprite in one call is normal and correct, and it means the user can undo your work with one Ctrl+Z. " +
        "Set `paletteLock` (default true) to snap every colour to the sprite's palette by perceptual distance before anything is written, so you cannot silently widen a curated palette. " +
        "Ops run in array order, so paint fills before outlines and outlines before highlights. " +
        "'text' is laid out here from a bitmap font and expanded to plain pixels before it reaches Aseprite — pass `measureOnly: true` with only 'text' ops to get each one's ink bounds without touching the sprite, e.g. to centre a label first. " +
        "'grid' paints a picture written as text — one character per pixel, a legend mapping characters to colours, the same shape `look op=\"ascii\"` returns — so you can see the whole silhouette while you write it instead of composing it from shapes. " +
        "It is the easiest way to draw a small sprite or a whole animation frame, and to edit one: read a region with `look op=\"ascii\" layer=… rulers=false`, change the rows, and send them back as a grid at the region's x/y. " +
        "If a script of yours produced the art, don't paste it: pass the rows as grid `file`, or the 1× PNG as 'image' — same palette lock, same erase/skip rule.",
      inputSchema: {
        ...targetShape,
        ops: z.array(drawOp).min(1).max(512).describe("Applied in order, in one transaction."),
        paletteLock: z
          .boolean()
          .default(true)
          .describe(
            "Snap every colour to the nearest palette entry (CIELAB ΔE). Set false only when the user asked to introduce new colours.",
          ),
        selectionOnly: z
          .boolean()
          .default(false)
          .describe("Clip every op to the current selection."),
        createCel: z
          .boolean()
          .default(true)
          .describe("Create the cel if the target layer/frame has none."),
        label: z
          .string()
          .optional()
          .describe("Name shown in Aseprite's undo history. Describe the intent, e.g. 'shade helmet'."),
        measureOnly: z
          .boolean()
          .default(false)
          .describe(
            "Every op must be 'text'. Returns each one's ink bounds without calling Aseprite at all — use to size a panel or centre a label before actually drawing it.",
          ),
      },
      outputSchema: {
        sprite: z.string().optional(),
        layer: z.string().optional(),
        frame: z.number().int().optional(),
        opsApplied: z.number().int().optional(),
        pixelsChanged: z.number().int().optional(),
        colorsSnapped: z
          .array(z.object({ from: z.string(), to: z.string(), deltaE: z.number() }))
          .optional()
          .describe("Colours palette-lock moved, and how far. A large ΔE means the palette lacks that colour."),
        bounds: z
          .object({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() })
          .nullish()
          .describe("Bounding box actually touched."),
        measureOnly: z.boolean().optional(),
        textBounds: z
          .array(
            z.object({
              index: z.number().int().describe("Position of this op in the `ops` array."),
              bounds: z
                .object({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() })
                .nullish()
                .describe("Ink bounds of the laid-out text; null for text with no ink (e.g. all spaces)."),
            }),
          )
          .optional()
          .describe("Only present when `measureOnly` was set."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        if (args.measureOnly) {
          if (args.ops.some((op) => op.kind !== "text")) {
            return fail(
              new LiveError(
                "invalid_args",
                "measureOnly only accepts 'text' ops — nothing else has ink bounds to measure without drawing.",
              ),
            );
          }
          const textOps = args.ops as Extract<(typeof args.ops)[number], { kind: "text" }>[];
          const textBounds = textOps.map((op, index) => ({
            index,
            bounds: layoutText({ ...op, font: loadFont(op.font) }).inkBounds,
          }));
          return ok(
            { measureOnly: true, textBounds },
            `Measured ${textBounds.length} text op(s) without touching the sprite.`,
          );
        }

        // Checked before the canvas call, so a malformed op is refused without Aseprite.
        if (args.ops.some((op) => op.kind === "grid" && (op.rows === undefined) === (op.file === undefined))) {
          throw new LiveError("invalid_args", "A grid op needs exactly one of `rows` or `file`.");
        }

        // A grid is bounded by the canvas, which only Aseprite knows.
        const canvas: CanvasSize | undefined = args.ops.some((op) => op.kind === "grid" || op.kind === "image")
          ? await live.call<CanvasSize>("sprite.info", { sprite: args.sprite, includePalette: false }, { expect: ["width", "height"] })
          : undefined;
        const expandedOps: Record<string, unknown>[] = [];
        for (const op of args.ops) {
          if (op.kind === "text") {
            const layout = layoutText({ ...op, font: loadFont(op.font) });
            if (layout.pixels.length > 0) expandedOps.push({ kind: "pixels", points: layout.pixels });
          } else if (op.kind === "grid") {
            const rows = op.rows ?? gridRowsFromText(readOpFile(op.file!).toString("utf8"));
            expandedOps.push(...compileGrid({ ...op, rows }, canvas!).ops);
          } else if (op.kind === "image") {
            const png = decodePng(readOpFile(op.path));
            expandedOps.push(...compileImage(png, op, canvas!, `image '${op.path}'`).ops);
          } else {
            expandedOps.push(op);
          }
        }

        const data = await live.call<Record<string, unknown>>(
          "draw.batch",
          { ...args, ops: expandedOps, measureOnly: undefined },
          { expect: ["opsApplied", "pixelsChanged", "layer", "frame"] },
        );
        const snapped = (data.colorsSnapped as { from: string; to: string; deltaE: number }[]) ?? [];
        const far = snapped.filter((s) => s.deltaE > 12);
        // Lua counts the expanded ops; the agent sent — and should hear back about — its own.
        data.opsApplied = args.ops.length;
        const summary = [
          `${args.ops.length} op(s), ${String(data.pixelsChanged ?? 0)} pixel(s) changed on '${String(data.layer)}' frame ${String(data.frame)}.`,
        ];
        if (far.length > 0) {
          summary.push(
            `Palette lock moved ${far.length} colour(s) a long way (ΔE > 12): ${far
              .slice(0, 5)
              .map((s) => `${s.from}→${s.to}`)
              .join(", ")}. Extend the palette if you meant those colours.`,
          );
        }
        summary.push("Now call look to see the result before moving on.");
        return ok(data, summary.join(" "));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "select",
    {
      title: "Selection",
      description:
        "Read or change the active selection. Ops: 'get', 'none', 'all', 'rect', 'ellipse', 'color' (select every pixel matching a colour), 'invert', 'grow', 'shrink'. A selection scopes draw, transform and recolor, which is usually cheaper and safer than masking by hand.",
      inputSchema: {
        op: z.enum(["get", "none", "all", "rect", "ellipse", "color", "invert", "grow", "shrink"]),
        ...targetShape,
        rect: rectShape.optional(),
        color: hexColor.optional().describe("For op 'color'."),
        tolerance: z.number().int().min(0).max(255).default(0).describe("Largest per-channel difference (0–255) still counted as the clicked colour. RGB sprites only; indexed and grayscale fills stay exact."),
        contiguous: z.boolean().default(false).describe("For op 'color'."),
        amount: z.number().int().positive().default(1).describe("Pixels, for grow/shrink."),
        mode: z
          .enum(["replace", "add", "subtract", "intersect"])
          .default("replace")
          .describe("How this selection combines with the existing one."),
      },
      outputSchema: {
        sprite: z.string(),
        empty: z.boolean(),
        bounds: z
          .object({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() })
          .nullish(),
        pixelCount: z.number().int(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const data = await live.call<Record<string, unknown>>("select.apply", args);
        return ok(data);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "transform",
    {
      title: "Transform",
      description:
        "Move, flip, rotate or scale pixels on ONE cel — the target layer's image on the target frame. Ops: 'translate', 'flip', 'rotate', 'scale', 'outline', 'crop_to_content'. " +
        "To transform part of a cel, crop the region out with `draw` op 'blit' first; there is no selection-scoped transform. " +
        "Rotation is only clean at 90° multiples — arbitrary angles destroy pixel art, so anything else needs `allowLossy`. " +
        "Scaling is nearest-neighbour and integer-only for the same reason.",
      inputSchema: {
        op: z.enum(["translate", "flip", "rotate", "scale", "outline", "crop_to_content"]),
        ...targetShape,
        dx: z.number().int().default(0),
        dy: z.number().int().default(0),
        axis: z.enum(["horizontal", "vertical"]).optional().describe("For 'flip'."),
        angle: z.number().default(90).describe("Degrees, clockwise. For 'rotate'."),
        factor: z.number().int().min(1).max(16).default(2).describe("For 'scale'."),
        color: hexColor.optional().describe("Outline colour, for 'outline'."),
        side: z
          .enum(["outside", "inside"])
          .default("outside")
          .describe(
            "For 'outline'. 'outside' paints transparent pixels touching opaque ones, growing the cel by one pixel each way. 'inside' recolours opaque pixels that touch transparency instead, same size in and out.",
          ),
        diagonals: z
          .boolean()
          .default(false)
          .describe("For 'outline'. Treat diagonal neighbours as touching too (8-neighbour instead of 4)."),
        thickness: z.number().int().positive().max(8).default(1),
        allowLossy: z
          .boolean()
          .default(false)
          .describe("Permit a non-90° rotation or non-integer scale. Ask the user first."),
      },
      outputSchema: {
        sprite: z.string(),
        op: z.string(),
        pixelsChanged: z.number().int(),
        bounds: z
          .object({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() })
          .nullish(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        if (args.op === "rotate" && args.angle % 90 !== 0 && !args.allowLossy) {
          return fail(
            new Error(
              `A ${args.angle}° rotation resamples every pixel and will destroy the sprite's crispness. Use a multiple of 90, or confirm with the user and pass allowLossy: true.`,
            ),
          );
        }
        const data = await live.call<Record<string, unknown>>("transform.apply", args);
        return ok(data);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
