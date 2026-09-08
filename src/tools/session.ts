import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LiveClient } from "../bridge/client.js";
import { fail, ok, targetShape } from "./kit.js";
import { packageVersion } from "../lib/version.js";

export function registerSessionTools(server: McpServer, live: LiveClient): void {
  server.registerTool(
    "preflight",
    {
      title: "Preflight",
      description:
        "Check that Aseprite is connected and report what this session can do. Call this FIRST in any pixel-art task and stop if `ready` is false — every editing tool writes into the user's open Aseprite window, and there is no useful fallback when that window is not there.",
      inputSchema: {},
      outputSchema: {
        ready: z.boolean().describe("True only when Aseprite is attached and accepting commands."),
        bridgeConnected: z.boolean(),
        pluginConnected: z.boolean(),
        asepriteVersion: z.string().nullish(),
        extensionVersion: z.string().nullish(),
        features: z.array(z.string()).describe("Optional capabilities this extension build supports."),
        activeSprite: z
          .object({
            name: z.string(),
            width: z.number().int(),
            height: z.number().int(),
            colorMode: z.string(),
            frames: z.number().int(),
            layers: z.number().int(),
          })
          .nullish(),
        directive: z.string().describe("What to do next, in one sentence."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      await live.waitForBridge(2_000);
      if (!live.pluginConnected) await live.waitForPlugin(1_500);

      const base = {
        bridgeConnected: live.bridgeConnected,
        pluginConnected: live.pluginConnected,
        asepriteVersion: live.hello?.asepriteVersion ?? null,
        extensionVersion: live.hello?.extensionVersion ?? null,
        features: live.features,
      };

      if (!live.pluginConnected) {
        return ok(
          {
            ...base,
            ready: false,
            activeSprite: null,
            directive: live.bridgeConnected
              ? "The bridge is running but Aseprite is not attached. Ask the user to open Aseprite with the aseprite-ai-artist extension installed, then call preflight again."
              : "The bridge is not running. Ask the user to run `npx @pebbly/aseprite-ai-artist doctor`.",
          },
          "NOT READY — Aseprite is not connected. Do not attempt to edit files on disk instead.",
        );
      }

      // Aseprite loads the extension once, at startup, so an editor left open
      // across an upgrade keeps answering with the old build — and the agent
      // spends the session working around bugs that were fixed weeks ago. Say
      // so up front; it is the first thing preflight is asked.
      const stale =
        base.extensionVersion !== null && base.extensionVersion !== packageVersion()
          ? `The attached extension is ${String(base.extensionVersion)} but this server is ${packageVersion()}. ` +
            "Tell the user to run `install-extension` and restart Aseprite before trusting a command that misbehaves. "
          : "";

      try {
        const site = await live.call<Record<string, unknown>>("session.site", {}, { expect: ["openSprites"] });
        const sprite = site.sprite as Record<string, unknown> | null;
        return ok(
          {
            ...base,
            ready: true,
            activeSprite: sprite
              ? {
                  name: String(sprite.name ?? "untitled"),
                  width: Number(sprite.width ?? 0),
                  height: Number(sprite.height ?? 0),
                  colorMode: String(sprite.colorMode ?? "rgb"),
                  frames: Number(sprite.frames ?? 0),
                  layers: Number(sprite.layers ?? 0),
                }
              : null,
            directive:
              stale +
              (sprite
                ? "Ready. Call sprite_info before your first edit so you are working from the real layer, frame and palette state."
                : "Ready, but no sprite is open. Use sprite_manage with op 'new' or 'open' first."),
          },
          sprite
            ? `READY — Aseprite ${base.asepriteVersion}, active sprite ${String(sprite.name)} (${String(sprite.width)}×${String(sprite.height)}).`
            : "READY — Aseprite is connected but no sprite is open.",
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "sprite_info",
    {
      title: "Sprite info",
      description:
        "Full structured state of a sprite: dimensions, colour mode, palette, every layer (with opacity, blend mode, visibility, group nesting), every frame with its duration, animation tags, slices and the current selection. Read this before editing — guessing at layer names or frame counts is the most common way an agent corrupts someone's file.",
      inputSchema: {
        sprite: targetShape.sprite,
        includePalette: z.boolean().default(true).describe("Include the full palette as hex."),
        includeSlices: z.boolean().default(false),
      },
      outputSchema: {
        id: z.number().int().describe("Stable id for this open document. Pass it back as '#<id>'."),
        name: z.string(),
        filename: z.string().nullish(),
        width: z.number().int(),
        height: z.number().int(),
        colorMode: z.enum(["rgb", "grayscale", "indexed"]),
        transparentIndex: z.number().int().nullish(),
        frameCount: z.number().int(),
        layers: z.array(
          z.object({
            name: z.string(),
            index: z.number().int(),
            visible: z.boolean(),
            editable: z.boolean(),
            opacity: z.number().int(),
            blendMode: z.string(),
            isGroup: z.boolean(),
            isTilemap: z.boolean(),
            parent: z.string().nullish(),
            cels: z.array(z.number().int()).describe("1-based frames that have a cel on this layer."),
          }),
        ),
        frames: z.array(z.object({ number: z.number().int(), durationMs: z.number().int() })),
        tags: z.array(
          z.object({
            name: z.string(),
            from: z.number().int(),
            to: z.number().int(),
            direction: z.string(),
            repeats: z.number().int().nullish().describe("Loop count; 0 means forever."),
          }),
        ),
        palette: z.array(z.string()).optional(),
        slices: z
          .array(z.object({ name: z.string(), bounds: z.record(z.number()) }))
          .optional(),
        selection: z
          .object({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() })
          .nullish(),
        activeLayer: z.string().nullish(),
        activeFrame: z.number().int().nullish(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const data = await live.call<Record<string, unknown>>("sprite.info", args, {
          expect: ["name", "width", "height", "colorMode", "frameCount", "layers"],
        });
        return ok(data, describeSprite(data));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "sprite_manage",
    {
      title: "Manage sprites",
      description:
        "Open, create, focus, resize, save and close sprites in the running Aseprite session. Ops: 'list' (open documents), 'new', 'open', 'activate', 'save', 'save_as', 'close', 'resize_canvas', 'set_properties'. Canvas resize keeps existing pixels — pass an anchor to say where they land.",
      inputSchema: {
        op: z.enum([
          "list",
          "new",
          "open",
          "activate",
          "save",
          "save_as",
          "close",
          "resize_canvas",
          "set_properties",
        ]),
        sprite: targetShape.sprite,
        path: z.string().optional().describe("File path for 'open' and 'save_as'."),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        colorMode: z.enum(["rgb", "grayscale", "indexed"]).optional().describe("For 'new'. Indexed keeps a sprite honest about its palette."),
        anchor: z
          .enum(["top_left", "top", "top_right", "left", "center", "right", "bottom_left", "bottom", "bottom_right"])
          .default("center")
          .describe("Where existing pixels sit after 'resize_canvas'."),
        pixelAspect: z.string().optional().describe("e.g. '1:1' or '1:2'."),
        force: z
          .boolean()
          .default(false)
          .describe("Allow 'close' to discard unsaved changes. Ask the user before setting this."),
      },
      outputSchema: {
        op: z.string(),
        sprites: z
          .array(
            z.object({
              id: z.number().int(),
              name: z.string(),
              filename: z.string().nullish(),
              width: z.number().int(),
              height: z.number().int(),
              colorMode: z.string(),
              frames: z.number().int(),
              layers: z.number().int(),
              active: z.boolean(),
              modified: z.boolean(),
            }),
          )
          .optional(),
        sprite: z.string().optional(),
        id: z.number().int().optional().describe("Stable id of the affected document; pass it back as '#<id>'."),
        path: z.string().optional(),
        width: z.number().int().optional(),
        height: z.number().int().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        if (args.op === "close" && !args.force) {
          // A close that discards work is not recoverable through undo.
          const info = await live.call<{ modified?: boolean; name?: string }>("sprite.info", {
            sprite: args.sprite,
            includePalette: false,
          });
          if (info.modified) {
            return fail(
              new Error(
                `'${info.name ?? "This sprite"}' has unsaved changes. Save it first, or ask the user to confirm and call again with force: true.`,
              ),
            );
          }
        }
        const data = await live.call<Record<string, unknown>>("sprite.manage", args);
        const merged = { op: args.op, ...data };
        // Hand back the unambiguous form: the display name of a fresh document
        // is "Sprite" for every unsaved sprite at once, so an agent that feeds
        // the name straight back can address the wrong one.
        const hint = data.id === undefined ? "" : ` Refer to it as '#${String(data.id)}'.`;
        return ok(merged, `${args.op}: ${String(data.sprite ?? "ok")}.${hint}`);
      } catch (err) {
        return fail(err);
      }
    },
  );
}

function describeSprite(data: Record<string, unknown>): string {
  const layers = (data.layers as unknown[] | undefined)?.length ?? 0;
  const tags = (data.tags as { name: string }[] | undefined) ?? [];
  const palette = (data.palette as unknown[] | undefined)?.length;
  const bits = [
    `${String(data.name)} ${String(data.width)}×${String(data.height)} ${String(data.colorMode)}`,
    `${String(data.frameCount)} frame(s)`,
    `${layers} layer(s)`,
  ];
  if (palette !== undefined) bits.push(`${palette}-colour palette`);
  if (tags.length > 0) bits.push(`tags: ${tags.map((t) => t.name).join(", ")}`);
  return bits.join(" · ");
}
