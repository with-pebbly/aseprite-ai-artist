import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server.js";

async function connected(opts: { prompts?: boolean } = {}) {
  const { server, live } = createServer({
    // Ports nothing listens on, and no bridge spawn: these tests are about the
    // MCP surface, not the Aseprite link.
    pluginPort: 19941,
    controlPort: 19942,
    autoSpawnBridge: false,
    allowLua: false,
    ...opts,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, close: async () => { live.close(); await server.close(); } };
}

test("the tool surface stays small enough to be cheap on every turn", async () => {
  const { client, close } = await connected();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();

  // The whole point of the grouped `op` design; if this fails, someone added a
  // tool per verb again and the schema cost went up for every user turn.
  assert.ok(tools.length <= 24, `tool count grew to ${tools.length}: ${names.join(", ")}`);

  for (const required of [
    "preflight", "sprite_info", "sprite_manage", "look", "read_pixels",
    "draw", "select", "transform", "layer", "frame", "tag", "cel",
    "palette", "recolor", "validate", "reference", "export", "tileset",
  ]) {
    assert.ok(names.includes(required), `missing tool '${required}'`);
  }

  // run_lua is arbitrary code execution in the app holding the user's unsaved
  // work; it must stay off until the operator opts in.
  assert.ok(!names.includes("run_lua"), "run_lua exposed without opt-in");

  await close();
});

test("every tool declares a description and an output schema", async () => {
  const { client, close } = await connected();
  const { tools } = await client.listTools();
  for (const tool of tools) {
    assert.ok((tool.description ?? "").length > 40, `${tool.name} needs a real description`);
    assert.ok(tool.outputSchema, `${tool.name} has no outputSchema, so results are unvalidated text`);
    assert.ok(tool.inputSchema, `${tool.name} has no inputSchema`);
  }
  await close();
});

test("sprite_info's payload stays inside its declared output schema", async () => {
  // OpenCode validates structuredContent strictly and rejects any property the
  // schema does not declare ("data must NOT have additional properties"), so a
  // field the extension returns but the schema forgets is a hard failure there
  // and silence everywhere else. This is the shape sprite.info returns
  // (captured from extension 0.8.0; palette and batch arrays trimmed).
  const payload = {
    id: 6,
    name: "Sprite-0001",
    filename: "Sprite-0001",
    width: 128,
    height: 128,
    colorMode: "rgb",
    frameCount: 1,
    modified: false,
    layers: [
      {
        name: "Layer 1",
        index: 1,
        visible: true,
        editable: true,
        opacity: 255,
        blendMode: "normal",
        isGroup: false,
        isTilemap: false,
        cels: [1],
      },
    ],
    frames: [{ number: 1, durationMs: 100 }],
    tags: [],
    palette: ["#000000", "#ffffff"],
    slices: [],
    selection: { x: 1, y: 2, width: 3, height: 4 },
    activeLayer: "Layer 1",
    activeFrame: 1,
  };

  const { client, close } = await connected();
  const { tools } = await client.listTools();
  const schema = tools.find((t) => t.name === "sprite_info")?.outputSchema;
  assert.ok(schema, "sprite_info declares an output schema");
  assert.deepEqual(undeclared(payload, schema as Record<string, unknown>), []);
  await close();
});

/** Keys in `value` that `schema` does not declare, at any nesting depth. */
function undeclared(value: unknown, schema: Record<string, unknown> | undefined, at = ""): string[] {
  if (!schema) return [];
  const branches = (schema.anyOf ?? schema.oneOf) as Record<string, unknown>[] | undefined;
  const shape = branches?.find((s) => s.type === "object" && s.properties) ?? schema;
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => undeclared(v, shape.items as Record<string, unknown> | undefined, `${at}[${i}]`));
  }
  if (value && typeof value === "object") {
    const props = (shape.properties as Record<string, Record<string, unknown>> | undefined) ?? {};
    const extra = Object.keys(value)
      .filter((k) => !(k in props))
      .map((k) => (at ? `${at}.${k}` : k));
    const nested = Object.entries(value).flatMap(([k, v]) =>
      k in props ? undeclared(v, props[k], at ? `${at}.${k}` : k) : [],
    );
    return [...extra, ...nested];
  }
  return [];
}

test("read-only tools are annotated as read-only", async () => {
  const { client, close } = await connected();
  const { tools } = await client.listTools();
  const byName = new Map(tools.map((t) => [t.name, t]));
  for (const name of ["preflight", "sprite_info", "look", "read_pixels", "validate"]) {
    assert.equal(byName.get(name)?.annotations?.readOnlyHint, true, `${name} should be read-only`);
  }
  assert.notEqual(byName.get("draw")?.annotations?.readOnlyHint, true);
  await close();
});

test("skills and rules are served as resources so non-plugin clients get them too", async () => {
  const { client, close } = await connected();

  const { resources } = await client.listResources();
  const uris = resources.map((r) => r.uri);
  assert.ok(uris.some((u) => u.startsWith("skill://")), "no skills exposed as resources");
  assert.ok(uris.some((u) => u.startsWith("rules://")), "no rules exposed as resources");

  const index = await client.readResource({ uri: "rules://index" });
  assert.match(String(index.contents[0]?.text), /Pixel-art rulebook/);

  await close();
});

test("every rules:// reference in skills, agents, rules and hooks names a served rule", async () => {
  // Skills point at rules by name instead of restating them; a renamed or
  // never-written rule leaves an agent reading a resource that does not exist.
  const { client, close } = await connected();
  const { resources } = await client.listResources();
  const served = new Set(resources.map((r) => r.uri).filter((u) => u.startsWith("rules://")));
  await close();

  const root = path.resolve(import.meta.dirname, "..");
  const files = ["skills", "agents", "rules", "hooks"].flatMap((dir) =>
    readdirSync(path.join(root, dir), { recursive: true, encoding: "utf8" })
      .filter((f) => /\.(md|mjs)$/.test(f))
      .map((f) => path.join(root, dir, f)),
  );
  const dangling: string[] = [];
  for (const file of files) {
    for (const [uri] of readFileSync(file, "utf8").matchAll(/rules:\/\/[0-9a-z-]+/g)) {
      if (!served.has(uri)) dangling.push(`${path.relative(root, file)}: ${uri}`);
    }
  }
  assert.deepEqual(dangling, []);
});

test("every skill is also reachable as a prompt", async () => {
  const { client, close } = await connected();
  const { prompts } = await client.listPrompts();
  assert.ok(prompts.length > 0, "no prompts registered");
  assert.ok(
    prompts.every((p) => p.name.startsWith("aseprite:")),
    "every workflow is namespaced aseprite:<name>, the same as in Claude Code and omp",
  );
  assert.ok(prompts.some((p) => p.name === "aseprite:studio"));

  const first = prompts[0]!;
  const got = await client.getPrompt({ name: first.name, arguments: {} });
  assert.ok(String(got.messages[0]?.content.text).length > 100, "prompt body is empty");

  await close();
});

test("plugin installs drop the prompts but keep the skill resources", async () => {
  // Claude Code and omp already list skills as /aseprite:<name>; prompts there
  // would reappear as /aseprite:aseprite:aseprite:<name>.
  const { client, close } = await connected({ prompts: false });
  const { prompts } = await client.listPrompts().catch(() => ({ prompts: [] }));
  assert.equal(prompts.length, 0);
  const { resources } = await client.listResources();
  assert.ok(resources.some((r) => r.uri === "skill://studio"));
  await close();
});

test("the server instructions carry the rules an agent gets wrong catastrophically", async () => {
  const { client, close } = await connected();
  const instructions = client.getInstructions() ?? "";
  assert.match(instructions, /preflight/);
  assert.match(instructions, /disk/i);
  await close();
});

test("a mutating tool returns a structured not_connected error, not a hang", async () => {
  const { client, close } = await connected();
  const result = await client.callTool({
    name: "draw",
    arguments: { ops: [{ kind: "pixels", color: "#ffffff", points: [{ x: 0, y: 0 }] }] },
  });
  assert.equal(result.isError, true);
  const structured = result.structuredContent as { code?: string; details?: Record<string, unknown> };
  assert.equal(structured.code, "not_connected");
  assert.equal(structured.details?.doNotFallBackToDisk, true);
  await close();
});

test("draw measureOnly with a text op returns textBounds and never calls the (absent) bridge", async () => {
  const { client, close } = await connected();
  const result = await client.callTool({
    name: "draw",
    arguments: {
      measureOnly: true,
      ops: [{ kind: "text", text: "Hi", x: 10, y: 10, color: "#ffffff" }],
    },
  });
  // No bridge is running (autoSpawnBridge: false); if measureOnly reached
  // live.call anyway this would fail with a structured not_connected error
  // instead of answering, since nothing is listening on the plugin port.
  assert.notEqual(result.isError, true, "measureOnly must not touch the live bridge");
  const structured = result.structuredContent as {
    measureOnly: boolean;
    textBounds: { index: number; bounds: { x: number; y: number; width: number; height: number } | null }[];
  };
  assert.equal(structured.measureOnly, true);
  assert.equal(structured.textBounds.length, 1);
  assert.equal(structured.textBounds[0]?.index, 0);
  // "Hi" in the bundled pixel5x7 font at top_left(10,10): known ink bounds.
  assert.deepEqual(structured.textBounds[0]?.bounds, { x: 10, y: 10, width: 8, height: 6 });
  await close();
});

test("draw measureOnly rejects a batch that mixes a non-text op", async () => {
  const { client, close } = await connected();
  const result = await client.callTool({
    name: "draw",
    arguments: {
      measureOnly: true,
      ops: [
        { kind: "text", text: "Hi", x: 0, y: 0, color: "#ffffff" },
        { kind: "pixels", color: "#ffffff", points: [{ x: 0, y: 0 }] },
      ],
    },
  });
  assert.equal(result.isError, true);
  const structured = result.structuredContent as { code?: string };
  assert.equal(structured.code, "invalid_args");
  await close();
});

test("a grid op with both or neither of rows and file is refused before Aseprite is asked", async () => {
  const { client, close } = await connected();
  const legend = { A: "#ffffff" };
  for (const grid of [{ rows: ["A"], file: "g.txt" }, {}]) {
    const result = await client.callTool({ name: "draw", arguments: { ops: [{ kind: "grid", x: 0, y: 0, legend, ...grid }] } });
    assert.equal(result.isError, true);
    // invalid_args, not not_connected: the check runs before the canvas call.
    assert.equal((result.structuredContent as { code?: string }).code, "invalid_args");
  }
  await close();
});

test("preflight answers instead of failing when Aseprite is absent", async () => {
  const { client, close } = await connected();
  const result = await client.callTool({ name: "preflight", arguments: {} });
  assert.notEqual(result.isError, true, "preflight must always answer");
  const structured = result.structuredContent as { ready: boolean; directive: string };
  assert.equal(structured.ready, false);
  assert.ok(structured.directive.length > 20);
  await close();
});

test("run_lua appears only when the operator enables it", async () => {
  const { server, live } = createServer({
    pluginPort: 19943,
    controlPort: 19944,
    autoSpawnBridge: false,
    allowLua: true,
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([client.connect(ct), server.connect(st)]);

  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === "run_lua"));

  live.close();
  await server.close();
});
