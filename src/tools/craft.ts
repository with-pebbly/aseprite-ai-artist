import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LiveClient } from "../bridge/client.js";
import { fail, hexColor, ok, targetShape } from "./kit.js";

/**
 * Operations that encode pixel-art craft rather than Aseprite mechanics.
 *
 * `recolor` exists because "make this darker" done naively — subtract from every
 * channel — produces the muddy, plastic look that reads instantly as generated.
 * A real shadow shifts hue toward the ambient (cool) and loses a little
 * saturation; a highlight warms. That rule is applied here, in one place, so
 * every skill and every agent gets it for free.
 */
export function registerCraftTools(server: McpServer, live: LiveClient): void {
  server.registerTool(
    "recolor",
    {
      title: "Recolor",
      description:
        "Change colours in a region by intent, staying palette-legal. Ops:\n" +
        "• 'shade' — darken or lighten with proper hue shifting (shadows cool, highlights warm). Use this instead of picking a darker hex by hand.\n" +
        "• 'snap' — pull off-palette pixels onto the nearest palette colour by perceptual (CIELAB) distance.\n" +
        "• 'replace' — swap one exact colour for another.\n" +
        "• 'hue_shift' — rotate hue, e.g. to make a colour variant of a finished sprite.\n" +
        "• 'desaturate' — drop toward grey, useful for a value check.\n" +
        "Operates on a region's distinct colours in one pass, so a 64×64 recolour is one undo step, not four thousand.",
      inputSchema: {
        op: z.enum(["shade", "snap", "replace", "hue_shift", "desaturate"]),
        ...targetShape,
        region: z
          .object({
            x: z.number().int(),
            y: z.number().int(),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          })
          .optional()
          .describe("Omit to affect the whole cel."),
        selectionOnly: z.boolean().default(false),
        amount: z
          .number()
          .min(-1)
          .max(1)
          .default(-0.2)
          .describe("For 'shade': negative darkens, positive lightens. One ramp step is roughly 0.15."),
        degrees: z.number().min(-180).max(180).default(30).describe("For 'hue_shift'."),
        strength: z.number().min(0).max(1).default(1).describe("For 'desaturate'."),
        from: hexColor.optional().describe("For 'replace'."),
        to: hexColor.optional().describe("For 'replace'."),
        clampToPalette: z
          .boolean()
          .default(true)
          .describe("Snap the result back onto the palette. Turn off only when growing the palette deliberately."),
      },
      outputSchema: {
        sprite: z.string(),
        op: z.string(),
        pixelsChanged: z.number().int(),
        mapping: z
          .array(z.object({ from: z.string(), to: z.string(), pixels: z.number().int() }))
          .describe("Exactly which colour became which, and how many pixels each move touched."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        if (args.op === "replace" && (!args.from || !args.to)) {
          return fail(new Error("op 'replace' needs both `from` and `to`."));
        }
        const data = await live.call<Record<string, unknown>>("recolor.apply", args, ["pixelsChanged"]);
        const mapping = (data.mapping as { from: string; to: string; pixels: number }[]) ?? [];
        return ok(
          data,
          `${String(data.pixelsChanged ?? 0)} pixel(s) recoloured. ${mapping
            .slice(0, 8)
            .map((m) => `${m.from}→${m.to}`)
            .join(", ")}`,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "validate",
    {
      title: "Validate",
      description:
        "Lint a sprite against pixel-art rules and report concrete, located problems. Checks: off-palette colours, orphan/stray pixels, broken or doubled outlines, banding, unintentional anti-aliasing on a hard-edged sprite, odd-pixel asymmetry, empty layers, untagged frames, inconsistent frame timing, and cross-frame volume drift in an animation. " +
        "Run this before telling the user a sprite is finished. It answers 'is this actually done' with evidence rather than optimism.",
      inputSchema: {
        sprite: targetShape.sprite,
        checks: z
          .array(
            z.enum([
              "palette",
              "strays",
              "outline",
              "banding",
              "antialiasing",
              "layers",
              "animation",
              "export_readiness",
            ]),
          )
          .optional()
          .describe("Omit to run everything."),
        strict: z
          .boolean()
          .default(false)
          .describe("Treat style warnings as failures. Use when the user asked for a specific discipline."),
      },
      outputSchema: {
        sprite: z.string(),
        passed: z.boolean(),
        score: z.number().int().min(0).max(100),
        findings: z.array(
          z.object({
            check: z.string(),
            severity: z.enum(["error", "warning", "note"]),
            message: z.string(),
            layer: z.string().nullish(),
            frame: z.number().int().nullish(),
            at: z
              .object({ x: z.number().int(), y: z.number().int() })
              .nullish()
              .describe("Where to look, when the problem has a location."),
            count: z.number().int().nullish(),
          }),
        ),
        summary: z.string(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const data = await live.call<{
          sprite: string;
          findings: {
            check: string;
            severity: "error" | "warning" | "note";
            message: string;
            layer: string | null;
            frame: number | null;
            at: { x: number; y: number } | null;
            count: number | null;
          }[];
        }>("validate.run", args);

        const errors = data.findings.filter((f) => f.severity === "error");
        const warnings = data.findings.filter((f) => f.severity === "warning");
        const passed = errors.length === 0 && (!args.strict || warnings.length === 0);
        const score = Math.max(0, 100 - errors.length * 15 - warnings.length * 5);

        const summary = passed
          ? `Clean${warnings.length > 0 ? ` (${warnings.length} style note(s))` : ""}.`
          : `${errors.length} error(s), ${warnings.length} warning(s). Fix the errors before calling this done.`;

        return ok(
          { ...data, passed, score, summary },
          [
            summary,
            ...data.findings
              .slice(0, 15)
              .map(
                (f) =>
                  `[${f.severity}] ${f.check}: ${f.message}` +
                  (f.at ? ` at (${f.at.x},${f.at.y})` : "") +
                  (f.layer ? ` on '${f.layer}'` : "") +
                  (f.frame ? ` frame ${f.frame}` : ""),
              ),
          ].join("\n"),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );
}
