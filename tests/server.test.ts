import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server.js";

async function connected() {
  const { server, live } = createServer({
    // Ports nothing listens on, and no bridge spawn: these tests are about the
    // MCP surface, not the Aseprite link.
    pluginPort: 19941,
    controlPort: 19942,
    autoSpawnBridge: false,
    allowLua: false,
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

test("every skill is also reachable as a prompt", async () => {
  const { client, close } = await connected();
  const { prompts } = await client.listPrompts();
  assert.ok(prompts.length > 0, "no prompts registered");

  const first = prompts[0]!;
  const got = await client.getPrompt({ name: first.name, arguments: {} });
  assert.ok(String(got.messages[0]?.content.text).length > 100, "prompt body is empty");

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
