import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { HeadlessClient } from "../dist/bridge/headless.js";
import { findAsepriteBinary } from "../dist/extension.js";
import { png } from "./png-writer.ts";
import { createServer } from "../dist/server.js";

const scratch = mkdtempSync(path.join(tmpdir(), "aia-headless-"));

/**
 * A stand-in for `aseprite -b` that speaks the runner's framing: it proves the
 * server side — framing, crash reporting, the editor guard — without Aseprite.
 * `crash` exits mid-session; every other command echoes what it received, and
 * the process remembers how many commands it has seen so a restart is visible.
 */
// The fake is a node script marked executable. Windows runs executables by extension only, so
// spawning it fails with EFTYPE there; these tests cover platform-independent protocol logic.
const noFakeBinary = process.platform === "win32" ? "a script cannot be spawned as an executable on Windows" : false;

function fakeAseprite(): string {
  const file = path.join(scratch, "fake-aseprite.mjs");
  writeFileSync(
    file,
    `#!/usr/bin/env node
import readline from "node:readline";
const MARK = "\\u001eaia ";
const emit = (o) => process.stdout.write(MARK + JSON.stringify(o) + "\\n");
process.stdout.write("Aseprite warning: this line is not a frame\\n");
emit({ type: "hello", protocol: 1, extensionVersion: "t", asepriteVersion: "fake", features: ["draw_batch"] });
let seen = 0;
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, cmd, args } = JSON.parse(line);
  seen++;
  if (cmd === "crash") process.exit(3);
  // Answers, then dies with nothing in flight: the idle-crash case. The exit
  // waits for the write — stdout to a pipe is asynchronous on macOS.
  if (cmd === "reply_then_die") {
    return process.stdout.write(MARK + JSON.stringify({ id, ok: true, data: { cmd, seen } }) + "\\n", () => process.exit(4));
  }
  process.stdout.write("stray print from a handler\\n");
  if (cmd === "sprite.info") return emit({ id, ok: true, data: { filename: "${path.join(scratch, "open.aseprite")}" } });
  if (cmd === "session.site") return emit({ id, ok: true, data: { openSprites: 0, seen } });
  emit({ id, ok: true, data: { cmd, args, seen } });
});
`,
  );
  chmodSync(file, 0o755);
  return file;
}

function client(guardFiles: string[] | null = null) {
  return new HeadlessClient({
    asepritePath: fakeAseprite(),
    cwd: scratch,
    userFolder: path.join(scratch, "home"),
    guard: { openFiles: async () => guardFiles, close: () => {} },
    startupTimeoutMs: 5_000,
  });
}

test("headless replies are matched by id and unmarked output is ignored", { skip: noFakeBinary }, async () => {
  const link = client();
  try {
    const [a, b] = await Promise.all([
      link.call<{ cmd: string }>("frame.apply", { op: "list" }),
      link.call<{ cmd: string }>("layer.apply", { op: "list" }),
    ]);
    assert.equal(a.cmd, "frame.apply");
    assert.equal(b.cmd, "layer.apply");
    assert.equal(link.hello?.asepriteVersion, "fake");
  } finally {
    link.close();
  }
});

test("a crash between calls is reported once, then the session restarts empty", { skip: noFakeBinary }, async () => {
  const link = client();
  try {
    await link.call("session.site");
    await assert.rejects(link.call("crash"), (err: { code?: string }) => err.code === "headless_exited");
    // In flight when it died: the rejection above is the report. The next call
    // gets a fresh process, and its counter proves it is not the old one.
    const fresh = await link.call<{ seen: number }>("session.site");
    assert.equal(fresh.seen, 1);
  } finally {
    link.close();
  }
});

test("a crash while idle surfaces on the next call instead of a silent fresh session", { skip: noFakeBinary }, async () => {
  const link = client();
  try {
    await link.call("reply_then_die");
    await assert.rejects(link.call("session.site"), (err: { code?: string; message: string }) =>
      err.code === "headless_exited" && /unsaved/.test(err.message),
    );
    const fresh = await link.call<{ seen: number }>("session.site");
    assert.equal(fresh.seen, 1);
  } finally {
    link.close();
  }
});

test("headless refuses to write a file the user's Aseprite window has open", { skip: noFakeBinary }, async () => {
  const open = path.join(scratch, "open.aseprite");
  const link = client([open]);
  try {
    for (const [cmd, args] of [
      ["sprite.manage", { op: "save_as", path: open }],
      ["sprite.manage", { op: "open", path: "open.aseprite" }], // relative to cwd
      ["sprite.manage", { op: "save" }], // the sprite's own filename is the open file
      ["export.run", { op: "aseprite", path: open }],
    ] as const) {
      await assert.rejects(
        link.call(cmd, args),
        (err: { code?: string }) => err.code === "file_open_in_editor",
        `${cmd} ${args.op} should be refused`,
      );
    }
    const other = await link.call<{ cmd: string }>("sprite.manage", {
      op: "save_as",
      path: path.join(scratch, "elsewhere.aseprite"),
    });
    assert.equal(other.cmd, "sprite.manage");
  } finally {
    link.close();
  }
});

test("headless preflight without an executable says so instead of pretending", async () => {
  const { server, live } = createServer({ headless: true, asepritePath: path.join(scratch, "missing-aseprite") });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0" });
  await Promise.all([mcp.connect(ct), server.connect(st)]);
  try {
    const result = await mcp.callTool({ name: "preflight", arguments: {} });
    const structured = result.structuredContent as { ready: boolean; mode: string; directive: string };
    assert.equal(structured.ready, false);
    assert.equal(structured.mode, "headless");
    assert.match(structured.directive, /Could not run|ASEPRITE_PATH/);
  } finally {
    live.close();
    await server.close();
  }
});

test("preflight switches mode only when asked, and the choice sticks", { skip: noFakeBinary }, async () => {
  // A live server with nothing to attach to: ports nobody listens on, no bridge spawn.
  const { server, live } = createServer({
    pluginPort: 19971,
    controlPort: 19972,
    autoSpawnBridge: false,
    asepritePath: fakeAseprite(),
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0" });
  await Promise.all([mcp.connect(ct), server.connect(st)]);
  const preflight = async (args: Record<string, unknown>) =>
    (await mcp.callTool({ name: "preflight", arguments: args })).structuredContent as {
      ready: boolean;
      mode: string;
      switched: boolean;
    };
  try {
    // Not ready in live mode is a refusal, not a cue to go headless.
    const first = await preflight({});
    assert.deepEqual([first.mode, first.ready, first.switched], ["live", false, false]);

    const forced = await preflight({ mode: "headless" });
    assert.deepEqual([forced.mode, forced.ready, forced.switched], ["headless", true, true]);

    // Every later call — including a preflight without `mode` — stays headless.
    const again = await preflight({});
    assert.deepEqual([again.mode, again.switched], ["headless", false]);
    const site = await mcp.callTool({ name: "sprite_manage", arguments: { op: "list" } });
    assert.notEqual(site.isError, true, "tools follow the switch");

    const back = await preflight({ mode: "live" });
    assert.deepEqual([back.mode, back.switched], ["live", true]);
  } finally {
    live.close();
    await server.close();
  }
});

// The real chain: MCP → HeadlessClient → aseprite -b → headless/runner.lua →
// the shipped extension. Skipped where Aseprite is not installed (CI).
test("serve --open opens each document in the batch Aseprite before the first call", { skip: noFakeBinary }, async () => {
  const docs = ["a.aseprite", "b.aseprite"];
  // Ports nothing listens on, so the editor guard finds no live window.
  const child = spawn(
    process.execPath,
    [path.resolve("dist/cli.js"), "serve", "--headless", "--aseprite", fakeAseprite(), "--open", docs.join(path.delimiter),
      "--plugin-port", "19961", "--control-port", "19962"],
    { cwd: scratch, stdio: ["pipe", "ignore", "pipe"] },
  );
  let log = "";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no 'opened' lines; stderr: ${log}`)), 10_000);
      child.stderr.on("data", (d: Buffer) => {
        log += d.toString();
        if (docs.every((doc) => log.includes(`opened ${path.join(scratch, doc)}`))) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  } finally {
    child.kill();
  }
});

const aseprite = findAsepriteBinary();
test("headless drives a real batch Aseprite end to end", { skip: aseprite ? false : "no Aseprite executable" }, async () => {
  const { server, live } = createServer({ headless: true });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0" });
  await Promise.all([mcp.connect(ct), server.connect(st)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await mcp.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result.content)}`);
    return result.structuredContent as Record<string, unknown>;
  };
  try {
    const pf = await call("preflight", {});
    assert.equal(pf.ready, true);
    assert.equal(pf.mode, "headless");

    await call("sprite_manage", { op: "new", width: 8, height: 8 });
    await call("draw", {
      ops: [{ kind: "rect", rect: { x: 2, y: 2, width: 3, height: 3 }, color: "#ff004d", fill: "#ff004d" }],
      paletteLock: false,
    });
    // State survives between calls: the sprite made two calls ago is still the
    // active one, with the pixels drawn in the previous call.
    const ascii = await call("look", { op: "ascii" });
    assert.ok(Object.values(ascii.legend as Record<string, string>).some((hex) => hex.startsWith("#ff004d")));

    const out = path.join(scratch, "real.aseprite");
    await call("sprite_manage", { op: "save_as", path: out });
    assert.equal(existsSync(out), true);

    // look op 'diff' with `layer` compares that layer alone: a change on
    // another layer must not show up, and the composite must.
    await call("layer", { op: "create", name: "still" });
    await call("frame", { op: "add" });
    await call("draw", {
      layer: "Layer 1",
      frame: 2,
      ops: [{ kind: "rect", rect: { x: 0, y: 0, width: 2, height: 2 }, color: "#29adff", fill: "#29adff" }],
      paletteLock: false,
    });
    const composite = await call("look", { op: "diff", fromFrame: 1, toFrame: 2 });
    const scoped = await call("look", { op: "diff", fromFrame: 1, toFrame: 2, layer: "still" });
    assert.ok((composite.changedPixels as number) > 0, "the composite sees the edit");
    assert.equal(scoped.changedPixels, 0, "a layer the edit never touched reports no change");

    // draw kind 'grid' writes exactly its rows, and look ascii rulers=false
    // reads them back cell for cell.
    await call("layer", { op: "create", name: "grid" });
    const legend = { A: "#ff004d", B: "#29adff" };
    const rows = ["..AB..", ".ABBA.", "AB..BA"];
    await call("draw", { layer: "grid", frame: 1, paletteLock: false, ops: [{ kind: "grid", x: 1, y: 2, legend, rows }] });
    const colours = async () => {
      const read = await call("look", { op: "ascii", layer: "grid", frame: 1, rulers: false, region: { x: 1, y: 2, width: 6, height: 3 } });
      assert.deepEqual(read.origin, { x: 1, y: 2 });
      const back = read.legend as Record<string, string>;
      return (read.gridRows as string[]).map((row) => Array.from(row, (g) => (g === "." ? "." : back[g]!.slice(0, 7))));
    };
    const expected = rows.map((row) => Array.from(row, (g) => (g === "." ? "." : legend[g as "A" | "B"])));
    assert.deepEqual(await colours(), expected);

    // The same picture from files a script wrote: grid `file`, then a 1× PNG
    // through op 'image' — alpha 0 erases, so the PNG's clear cells undo the grid.
    const gridFile = path.join(scratch, "grid.txt");
    writeFileSync(gridFile, rows.join("\n") + "\n");
    await call("cel", { op: "clear", layer: "grid", frame: 1 });
    await call("draw", { layer: "grid", frame: 1, paletteLock: false, ops: [{ kind: "grid", x: 1, y: 2, legend, file: gridFile }] });
    assert.deepEqual(await colours(), expected);
    const rgba = (g: string) => (g === "A" ? [255, 0, 77, 255] : g === "B" ? [41, 173, 255, 255] : [0, 0, 0, 0]);
    // A 7×3 sheet whose right 6 columns are the picture mirrored; crop takes them.
    const mirrored = rows.map((row) => [...row].reverse().join(""));
    writeFileSync(path.join(scratch, "sheet.png"), png(7, 3, 8, 6, mirrored.map((row) => [0, 0, 0, 255, ...[...row].flatMap(rgba)])));
    await call("draw", {
      layer: "grid",
      frame: 1,
      paletteLock: false,
      ops: [{ kind: "image", path: path.join(scratch, "sheet.png"), x: 1, y: 2, crop: { x: 1, y: 0, width: 6, height: 3 } }],
    });
    assert.deepEqual(await colours(), mirrored.map((row) => Array.from(row, (g) => (g === "." ? "." : legend[g as "A" | "B"]))));
    // Back to the original picture for the checks below.
    await call("draw", { layer: "grid", frame: 1, paletteLock: false, ops: [{ kind: "grid", x: 1, y: 2, legend, rows }] });
    // The grid comes back once: bare gridRows without rulers, ruled text with them.
    const bare = await call("look", { op: "ascii", layer: "grid", frame: 1, rulers: false, region: { x: 1, y: 2, width: 6, height: 3 } });
    assert.equal(bare.text, undefined, "rulers=false must not repeat the grid as text");
    const ruled = await call("look", { op: "ascii", layer: "grid", frame: 1, region: { x: 1, y: 2, width: 6, height: 3 } });
    assert.equal(ruled.gridRows, undefined, "a ruled read must not repeat the grid as gridRows");
    assert.match(String(ruled.text), /^\s+123456$/m, "the ruled text keeps its column ruler");

    // Glyphs are palette indices on a real sprite: two regions meeting the
    // colours in different orders agree, and an off-palette colour is flagged.
    // With per-read glyphs 'A' was #29adff on the right and #ff004d on the left.
    await call("palette", { op: "preset", preset: "pico8", replace: true });
    // (7,2) sits outside the 6×3 rectangle the selection check below reads.
    await call("draw", { layer: "grid", frame: 1, paletteLock: false, ops: [{ kind: "pixels", points: [{ x: 7, y: 2 }], color: "#123456" }] });
    const piece = async (x: number, width: number) =>
      call("look", { op: "ascii", layer: "grid", frame: 1, rulers: false, region: { x, y: 2, width, height: 3 } });
    const [left, right] = [await piece(1, 3), await piece(4, 4)];
    assert.deepEqual(left.legend, { I: "#ff004d", M: "#29adff" }, "PICO-8 index 8 → I, 12 → M");
    assert.deepEqual(right.legend, { I: "#ff004d", M: "#29adff", Q: "#123456" });
    assert.deepEqual(left.offPalette, []);
    assert.deepEqual(right.offPalette, ["Q"], "only the off-palette colour gets an unstable glyph");

    // Transparent cells erase — but only inside the selection when selectionOnly is set.
    await call("select", { op: "rect", rect: { x: 1, y: 2, width: 3, height: 3 } });
    await call("draw", {
      layer: "grid",
      frame: 1,
      selectionOnly: true,
      ops: [{ kind: "grid", x: 1, y: 2, legend: {}, rows: ["......", "......", "......"] }],
    });
    await call("select", { op: "none" });
    assert.deepEqual(
      await colours(),
      expected.map((row) => row.map((c, x) => (x < 3 ? "." : c))),
      "erase stops at the selection edge",
    );

    // look forwards every onion field to the extension: framesAfter and layer
    // were each dropped once on the TS side, and the call still succeeded.
    await call("frame", { op: "add", count: 3 });
    const onion = await call("look", { op: "onion", frame: 1, framesBefore: 0, framesAfter: 3, layer: "grid" });
    assert.deepEqual(onion.framesUsed, [1, 2, 3, 4]);
  } finally {
    live.close();
    await server.close();
  }
});

// `--allowLua` has to reach the batch Aseprite as an environment variable: the
// extension gates `lua.run` on its own process, and this child is the server's.
// Skipped where Aseprite is not installed (CI), like the test above.
test("headless passes the lua.run switch to the batch Aseprite", { skip: aseprite ? false : "no Aseprite executable" }, async () => {
  const { server, live } = createServer({ headless: true, allowLua: true });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0" });
  await Promise.all([mcp.connect(ct), server.connect(st)]);
  try {
    const result = await mcp.callTool({ name: "run_lua", arguments: { script: "return 7" } });
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    assert.equal((result.structuredContent as { result: number }).result, 7);
  } finally {
    live.close();
    await server.close();
  }
});
