import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LiveClient } from "../bridge/client.js";
import { fail, ok, targetShape } from "./kit.js";

export function registerAssetTools(server: McpServer, live: LiveClient): void {
  server.registerTool(
    "reference",
    {
      title: "Reference image",
      description:
        "Bring an external image into the sprite as a reference layer, so you can trace proportions or sample colours from it. Ops: 'import' (place an image on a locked, semi-transparent layer above the art), 'sample_palette' (read its dominant colours without importing), 'list', 'remove'. " +
        "Importing at a different size uses nearest-neighbour; a photo scaled down to 32×32 is a starting point for a silhouette, never a finished sprite.",
      inputSchema: {
        op: z.enum(["import", "sample_palette", "list", "remove"]),
        sprite: targetShape.sprite,
        path: z.string().optional().describe("Image file to read."),
        name: z.string().optional().describe("Layer name. Default: 'reference'."),
        x: z.number().int().default(0),
        y: z.number().int().default(0),
        fit: z
          .enum(["none", "contain", "cover", "stretch"])
          .default("contain")
          .describe("How to size the image against the canvas."),
        opacity: z.number().int().min(0).max(255).default(128),
        colors: z.number().int().min(2).max(64).default(16).describe("For 'sample_palette'."),
      },
      outputSchema: {
        sprite: z.string(),
        op: z.string(),
        layer: z.string().optional(),
        width: z.number().int().optional(),
        height: z.number().int().optional(),
        palette: z
          .array(z.object({ hex: z.string(), share: z.number() }))
          .optional()
          .describe("Dominant colours with their share of the image."),
        references: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const data = await live.call<Record<string, unknown>>("reference.apply", args);
        return ok(data);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "export",
    {
      title: "Export",
      description:
        "Write game-ready files. Ops: 'png' (single frame), 'gif' (animation), 'spritesheet' (packed sheet plus a JSON atlas with per-frame and per-tag data), 'frames' (numbered PNGs), 'aseprite' (save a copy of the source). " +
        "Spritesheet is what an engine actually consumes: pass `sheetType` and `byTag` to control layout. Exporting does not save the working document — use sprite_manage op 'save' for that.",
      inputSchema: {
        op: z.enum(["png", "gif", "spritesheet", "frames", "aseprite"]),
        sprite: targetShape.sprite,
        path: z
          .string()
          .describe(
            "Output file path. For 'frames', a pattern containing {frame}, e.g. 'walk_{frame}.png' — Aseprite expands it into one file per frame, numbered from 0.",
          ),
        frame: targetShape.frame,
        scale: z.number().int().min(1).max(16).default(1).describe("Integer upscale, nearest-neighbour."),
        sheetType: z
          .enum(["horizontal", "vertical", "rows", "columns", "packed"])
          .default("horizontal")
          .describe("Spritesheet layout."),
        byTag: z.boolean().default(false).describe("Split the sheet by animation tag."),
        padding: z.number().int().min(0).max(16).default(0).describe("Pixels between frames; prevents bleed at non-integer zoom."),
        trim: z.boolean().default(false).describe("Trim transparent margins; the atlas keeps the original offsets."),
        includeJson: z.boolean().default(true).describe("Write a sibling JSON atlas for 'spritesheet'."),
        layers: z.array(z.string()).optional().describe("Export only these layers."),
        tags: z.array(z.string()).optional().describe("Export only these tags."),
      },
      outputSchema: {
        sprite: z.string(),
        op: z.string(),
        files: z.array(z.string()),
        width: z.number().int().optional(),
        height: z.number().int().optional(),
        frameCount: z.number().int().optional(),
        frame: z.number().int().optional().describe("Which frame a single-frame export wrote. Defaults to the active frame, which is not always the one you drew on."),
        atlas: z.string().nullish().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const data = await live.call<Record<string, unknown>>("export.run", args, {
          expect: ["files"],
          // Aseprite's first GIF write in a session takes tens of seconds — it
          // warms a codec once, then answers in about two. Measured at 38s on
          // a 32x32 sprite, so the default 20s turned the very first animation
          // export anyone tries into a timeout on work that then succeeded.
          timeoutMs: 120_000,
        });
        const files = (data.files as string[]) ?? [];
        return ok(data, `Wrote ${files.length} file(s): ${files.join(", ")}`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "tileset",
    {
      title: "Tilesets",
      description:
        "Work with Aseprite tilemap layers. Ops:\n" +
        "• 'list' — tilesets in the sprite.\n" +
        "• 'create_layer' — a new empty tilemap layer on a given grid.\n" +
        "• 'get' — tile count and, with a path, the tiles as one packed PNG.\n" +
        "• 'stamp' — place tiles by grid coordinate. x/y are grid cells, not pixels.\n" +
        "• 'pack' — turn a hand-painted mockup layer into a tileset plus a tilemap that reconstructs it exactly. Deduplicates identical cells; `tolerance` also merges near-identical ones. The canvas must be a whole number of tiles, and the source layer is hidden rather than deleted so you can compare.\n" +
        "• 'export' — writes the packed PNG plus the file the engine reads: 'tiled' (.tsj tileset and a .tmj map that uses it), 'godot' (Godot 4 .tres TileSet), or 'json' (tile grid plus the tilemap layout).\n" +
        "Painting a level by hand and packing it produces better tilesets than authoring tiles in isolation, because you see the whole picture while drawing. " +
        "`layout: 'blob47'` adds a Tiled wangset for autotiling, and assumes the tileset is authored in canonical blob47 order after the empty tile — it refuses rather than writing a wangset that would autotile wrongly. " +
        "Requires an extension build advertising the 'tileset' feature — check preflight first.",
      inputSchema: {
        op: z.enum(["list", "create_layer", "get", "stamp", "pack", "export"]),
        ...targetShape,
        name: z.string().optional(),
        tileWidth: z.number().int().positive().max(256).default(16),
        tileHeight: z.number().int().positive().max(256).default(16),
        tiles: z
          .array(z.object({ x: z.number().int(), y: z.number().int(), tile: z.number().int().min(0) }))
          .optional()
          .describe("For 'stamp'. x/y are tile-grid cells, not pixels."),
        path: z.string().optional().describe("Output path for 'export' and 'get'."),
        format: z.enum(["tiled", "godot", "json"]).default("tiled"),
        layout: z.enum(["grid", "blob47"]).default("grid").describe("Autotile layout for 'export'."),
        tolerance: z
          .number()
          .int()
          .min(0)
          .max(255)
          .default(0)
          .describe(
            "For 'pack': maximum per-channel difference at which two cells count as the same tile. 0 means exact, which is also much faster — anything above 0 compares every cell against every tile found so far.",
          ),
      },
      outputSchema: {
        sprite: z.string(),
        op: z.string(),
        tilesets: z
          .array(z.object({ name: z.string(), tileCount: z.number().int(), tileWidth: z.number().int(), tileHeight: z.number().int() }))
          .optional(),
        tileCount: z.number().int().optional(),
        tileWidth: z.number().int().optional(),
        tileHeight: z.number().int().optional(),
        columns: z.number().int().optional(),
        rows: z.number().int().optional(),
        files: z.array(z.string()).optional(),
        layer: z.string().optional(),
        sourceLayer: z.string().optional().describe("For 'pack': the mockup layer, now hidden."),
        cellCount: z.number().int().optional().describe("For 'pack': grid cells examined."),
        reusedExact: z.number().int().optional().describe("For 'pack': cells that matched an existing tile exactly."),
        reusedFuzzy: z.number().int().optional().describe("For 'pack': cells merged by `tolerance`. A high number here with a low tolerance means the mockup has near-duplicate tiles worth cleaning up."),
        skipped: z.number().int().optional().describe("For 'stamp': placements outside the grid or naming a tile that does not exist."),
        format: z.string().optional(),
        layout: z.string().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        if (!live.hasFeature("tileset")) {
          return fail(
            new Error(
              "This Aseprite extension build does not advertise the 'tileset' feature. Update the extension (npx @pebbly/aseprite-ai-artist install-extension) and restart Aseprite.",
            ),
          );
        }
        const data = await live.call<Record<string, unknown>>("tileset.apply", args);
        return ok(data, describeTileset(args.op, data));
      } catch (err) {
        return fail(err);
      }
    },
  );
}

function describeTileset(op: string, data: Record<string, unknown>): string | undefined {
  if (op === "pack") {
    const cells = Number(data.cellCount ?? 0);
    const tiles = Number(data.tileCount ?? 0);
    const fuzzy = Number(data.reusedFuzzy ?? 0);
    const lines = [
      `${cells} cell(s) packed into ${tiles} tile(s) on '${String(data.layer)}'. '${String(data.sourceLayer)}' is hidden, not deleted — unhide it to compare.`,
    ];
    if (fuzzy > 0) {
      lines.push(`${fuzzy} cell(s) were merged by tolerance, so the tilemap is an approximation of the mockup, not a copy.`);
    }
    if (tiles > cells / 2) {
      lines.push(
        `That is a lot of unique tiles for ${cells} cells — usually a sign the mockup was painted without the grid in mind. Check the tile size before building on it.`,
      );
    }
    return lines.join(" ");
  }
  if (op === "export") {
    const files = (data.files as string[]) ?? [];
    return `Wrote ${files.length} file(s) for ${String(data.format)}: ${files.join(", ")}`;
  }
  if (op === "stamp" && Number(data.skipped ?? 0) > 0) {
    return `Placed ${String(data.tileCount)} tile(s); skipped ${String(data.skipped)} outside the ${String(data.columns)}x${String(data.rows)} grid or naming a tile that does not exist.`;
  }
  return undefined;
}
