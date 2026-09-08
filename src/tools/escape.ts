import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LiveClient } from "../bridge/client.js";
import { fail, ok, targetShape } from "./kit.js";

/**
 * The escape hatch.
 *
 * A compact tool surface has a cost: something a user wants will eventually sit
 * outside it. Rather than let that become a reason to grow the surface to 120
 * tools, this runs Lua directly in Aseprite — and is off unless the operator
 * turns it on, because it is arbitrary code execution inside the app that holds
 * the user's unsaved work.
 */
export function registerEscapeTools(server: McpServer, live: LiveClient, enabled: boolean): void {
  if (!enabled) return;

  server.registerTool(
    "run_lua",
    {
      title: "Run Lua in Aseprite",
      description:
        "Execute a Lua script inside the running Aseprite session and return its result. " +
        "This is an escape hatch for operations the typed tools do not cover — prefer a typed tool whenever one fits, because this bypasses palette locking, undo labelling and every safety check. " +
        "The script runs with full Aseprite API access against the user's open document. Wrap mutations in app.transaction so the user can undo them in one step. " +
        "Return a value to receive it as JSON.",
      inputSchema: {
        ...targetShape,
        script: z.string().min(1).max(60_000).describe("Lua source. `sprite` is bound to the target sprite."),
        label: z.string().optional().describe("Undo-history label for any mutation."),
        timeoutMs: z.number().int().min(100).max(120_000).default(20_000),
      },
      outputSchema: {
        ok: z.boolean(),
        result: z.unknown().nullish(),
        stdout: z.string(),
        durationMs: z.number().int(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const data = await live.call<Record<string, unknown>>("lua.run", args);
        return ok(data);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
