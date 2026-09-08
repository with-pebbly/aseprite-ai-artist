import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LiveClient } from "../bridge/client.js";
import { fail, hexColor, ok, targetShape } from "./kit.js";

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
    tolerance: z.number().int().min(0).max(255).default(0),
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
]);

export function registerDrawTools(server: McpServer, live: LiveClient): void {
  server.registerTool(
    "draw",
    {
      title: "Draw",
      description:
        "Apply a batch of drawing operations to one cel, as a single undoable action. Ops: pixels, line, polyline, rect, ellipse, fill, replace, dither, gradient, clear, blit. " +
        "Batch aggressively — a whole sprite in one call is normal and correct, and it means the user can undo your work with one Ctrl+Z. " +
        "Set `paletteLock` (default true) to snap every colour to the sprite's palette by perceptual distance before anything is written, so you cannot silently widen a curated palette. " +
        "Ops run in array order, so paint fills before outlines and outlines before highlights.",
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
      },
      outputSchema: {
        sprite: z.string(),
        layer: z.string(),
        frame: z.number().int(),
        opsApplied: z.number().int(),
        pixelsChanged: z.number().int(),
        colorsSnapped: z
          .array(z.object({ from: z.string(), to: z.string(), deltaE: z.number() }))
          .describe("Colours palette-lock moved, and how far. A large ΔE means the palette lacks that colour."),
        bounds: z
          .object({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() })
          .nullish()
          .describe("Bounding box actually touched."),
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
        const data = await live.call<Record<string, unknown>>("draw.batch", args, {
          expect: ["opsApplied", "pixelsChanged", "layer", "frame"],
        });
        const snapped = (data.colorsSnapped as { from: string; to: string; deltaE: number }[]) ?? [];
        const far = snapped.filter((s) => s.deltaE > 12);
        const summary = [
          `${String(data.opsApplied ?? args.ops.length)} op(s), ${String(data.pixelsChanged ?? 0)} pixel(s) changed on '${String(data.layer)}' frame ${String(data.frame)}.`,
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
        tolerance: z.number().int().min(0).max(255).default(0),
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
