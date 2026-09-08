/**
 * End-to-end smoke test against a LIVE Aseprite session.
 *
 * Unlike the rest of the suite this needs a human-visible Aseprite running with
 * the extension installed, so it is not part of `npm test`. It is the only test
 * that exercises the real chain — MCP server → bridge → Aseprite Lua → pixels —
 * and it is what caught the two bugs that every isolated test missed: Aseprite's
 * json.decode returning userdata, and its decoded arrays yielding nothing from
 * pairs.
 *
 * Run it against an isolated Aseprite so your own documents are never involved:
 *
 *   node dist/cli.js bridge &
 *   ASEPRITE_USER_FOLDER=/tmp/ase-home node dist/cli.js install-extension --dir /tmp/ase-home
 *   ASEPRITE_USER_FOLDER=/tmp/ase-home /path/to/aseprite &
 *   node tests/e2e.mjs
 *
 * It creates its own 16x16 sprite and closes it without saving.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server.js";

const { server, live } = createServer({ pluginPort: 9931, controlPort: 9932, autoSpawnBridge: false });
const [ct, st] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "e2e", version: "0" });
await Promise.all([client.connect(ct), server.connect(st)]);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${r.content[0].text}`);
  return r;
};

console.log("— preflight");
const pf = await call("preflight");
console.log("  ", pf.content[0].text);
if (!pf.structuredContent.ready) { console.log("NOT READY, stopping"); process.exit(1); }

console.log("— new sprite");
console.log("  ", (await call("sprite_manage", { op: "new", width: 16, height: 16, colorMode: "rgb" })).content[0].text);

console.log("— palette preset pico8");
console.log("  ", (await call("palette", { op: "preset", preset: "pico8", replace: true })).content[0].text.slice(0, 120));

console.log("— draw a batch");
const drew = await call("draw", {
  label: "e2e smoke",
  ops: [
    { kind: "ellipse", rect: { x: 4, y: 2, width: 8, height: 7 }, color: "#ab5236", fill: "#ffccaa" },
    { kind: "rect", rect: { x: 5, y: 9, width: 6, height: 6 }, color: "#1d2b53", fill: "#29adff" },
    { kind: "pixels", color: "#000000", points: [{ x: 6, y: 5 }, { x: 9, y: 5 }] },
    { kind: "line", from: { x: 6, y: 7 }, to: { x: 9, y: 7 }, color: "#ff004d" },
    // deliberately off-palette, to prove the snap report
    { kind: "pixels", color: "#fe0150", points: [{ x: 2, y: 2 }] },
  ],
});
console.log("  ", drew.content[0].text);
console.log("   snapped:", JSON.stringify(drew.structuredContent.colorsSnapped));

console.log("— look (ascii)");
const ascii = await call("look", { op: "ascii" });
console.log(ascii.content[0].text);

console.log("— look (preview)");
const prev = await call("look", { op: "preview" });
console.log("  ", prev.content[0].text, "| image bytes:", prev.content[1].data.length);

console.log("— frames + tag");
console.log("  ", (await call("frame", { op: "add", count: 3 })).content[0].text);
console.log("  ", (await call("frame", { op: "set_duration", durations: [200, 90, 90, 200] })).content[0].text);
console.log("  ", (await call("tag", { op: "create", name: "idle", from: 1, to: 4, direction: "pingpong" })).content[0].text);

console.log("— filmstrip");
const strip = await call("look", { op: "filmstrip" });
console.log("  ", strip.content[0].text, "| image bytes:", strip.content[1].data.length);

console.log("— validate");
const v = await call("validate");
console.log(v.content[0].text);

console.log("— recolor shade");
console.log("  ", (await call("recolor", { op: "shade", amount: -0.25, frame: 1 })).content[0].text.slice(0, 200));

console.log("— export png");
console.log("  ", (await call("export", { op: "png", frame: 1, path: process.env.E2E_OUT || "/tmp/aseprite-ai-artist-e2e.png", scale: 8 })).content[0].text);

console.log("— close without saving (should refuse)");
const closed = await client.callTool({ name: "sprite_manage", arguments: { op: "close" } });
console.log("  isError:", closed.isError, "|", closed.content[0].text.split("\n")[0]);

console.log("— close with force");
console.log("  ", (await call("sprite_manage", { op: "close", force: true })).content[0].text);

live.close();
await server.close();
console.log("\nE2E OK");
process.exit(0);
