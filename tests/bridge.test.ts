import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { WebSocket } from "ws";
import { Bridge } from "../dist/bridge/bridge.js";
import { LiveClient } from "../dist/bridge/client.js";

// Ports well away from the defaults so a real Aseprite session on this machine
// is never disturbed by the test suite.
const PLUGIN_PORT = 19931;
const CONTROL_PORT = 19932;

const bridge = new Bridge({
  pluginPort: PLUGIN_PORT,
  controlPort: CONTROL_PORT,
  version: "test",
});

const started = await bridge.start();
assert.ok(started, "bridge failed to bind its test ports");

after(async () => {
  await bridge.stop();
});

/** Stands in for the Aseprite Lua extension. */
function fakePlugin(handler: (cmd: string, args: unknown) => unknown): Promise<WebSocket> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PLUGIN_PORT}`);
    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          type: "hello",
          protocol: 1,
          extensionVersion: "test",
          asepriteVersion: "1.3.17",
          features: ["draw_batch"],
        }),
      );
      resolve(socket);
    });
    socket.on("message", (raw) => {
      const frame = JSON.parse(raw.toString()) as { id: string; cmd: string; args: unknown };
      try {
        socket.send(JSON.stringify({ id: frame.id, ok: true, data: handler(frame.cmd, frame.args) }));
      } catch (err) {
        socket.send(
          JSON.stringify({
            id: frame.id,
            ok: false,
            error: { code: "aseprite_error", message: (err as Error).message },
          }),
        );
      }
    });
  });
}

function client(): LiveClient {
  return new LiveClient({
    controlPort: CONTROL_PORT,
    pluginPort: PLUGIN_PORT,
    autoSpawnBridge: false,
    timeoutMs: 3_000,
  });
}

test("a call fails fast with not_connected when Aseprite is absent", async () => {
  const c = client();
  await c.waitForBridge(2_000);
  assert.equal(c.pluginConnected, false);

  await assert.rejects(c.call("sprite.info"), (err: Error & { code?: string; details?: Record<string, unknown> }) => {
    assert.equal(err.code, "not_connected");
    // Load-bearing: without this an agent "recovers" by editing the file on
    // disk, which the user never sees and a later save silently overwrites.
    assert.equal(err.details?.doNotFallBackToDisk, true);
    return true;
  });
  c.close();
});

test("a command round-trips through the bridge to the plugin and back", async () => {
  const plugin = await fakePlugin((cmd, args) => ({ echoed: cmd, args }));
  const c = client();

  assert.ok(await c.waitForPlugin(3_000), "client never saw the plugin attach");
  assert.equal(c.hello?.asepriteVersion, "1.3.17");
  assert.ok(c.hasFeature("draw_batch"));
  assert.equal(c.hasFeature("tileset"), false);

  const result = await c.call<{ echoed: string; args: { n: number } }>("ping", { n: 7 });
  assert.equal(result.echoed, "ping");
  assert.equal(result.args.n, 7);

  c.close();
  plugin.close();
});

test("two clients get their own replies back, not each other's", async () => {
  // Namespaced ids are what let a second agent window attach without stealing
  // the first one's responses.
  const plugin = await fakePlugin((_cmd, args) => ({ from: (args as { who: string }).who }));
  const a = client();
  const b = client();

  assert.ok(await a.waitForPlugin(3_000));
  assert.ok(await b.waitForPlugin(3_000));

  const [ra, rb] = await Promise.all([
    a.call<{ from: string }>("who", { who: "a" }),
    b.call<{ from: string }>("who", { who: "b" }),
  ]);
  assert.equal(ra.from, "a");
  assert.equal(rb.from, "b");

  a.close();
  b.close();
  plugin.close();
});

test("a plugin error surfaces with its code intact", async () => {
  const plugin = await fakePlugin(() => {
    throw new Error("no active sprite");
  });
  const c = client();
  assert.ok(await c.waitForPlugin(3_000));

  await assert.rejects(c.call("sprite.info"), (err: Error & { code?: string }) => {
    assert.equal(err.code, "aseprite_error");
    assert.match(err.message, /no active sprite/);
    return true;
  });

  c.close();
  plugin.close();
});

test("a reconnecting plugin replaces the old one instead of being locked out", async () => {
  const first = await fakePlugin(() => ({ generation: 1 }));
  const c = client();
  assert.ok(await c.waitForPlugin(3_000));
  assert.deepEqual(await c.call("gen"), { generation: 1 });

  first.close();
  const second = await fakePlugin(() => ({ generation: 2 }));
  assert.ok(await c.waitForPlugin(3_000), "client did not see the replacement plugin");
  assert.deepEqual(await c.call("gen"), { generation: 2 });

  c.close();
  second.close();
});

test("a dropped bridge fails in-flight calls immediately, not on their own timeout", async () => {
  // Letting each call wait out its 20s timeout makes a known disconnect read to
  // an agent as "Aseprite is slow" — and slow is the reading that makes it try
  // editing files on disk instead.
  const plugin = await fakePlugin(() => new Promise(() => {}) as never);
  const c = client();
  assert.ok(await c.waitForPlugin(3_000));

  const inFlight = c.call("sprite.info");
  // Drop the plugin AND the client's control link.
  plugin.close();
  await new Promise((r) => setTimeout(r, 50));
  (c as unknown as { socket: { close(): void } }).socket.close();

  const started = Date.now();
  await assert.rejects(inFlight, (err: Error & { code?: string }) => {
    assert.equal(err.code, "not_connected");
    return true;
  });
  const waited = Date.now() - started;
  assert.ok(waited < 2_000, `should fail fast, waited ${waited}ms`);
  c.close();
});

test("a second bridge on the same ports loses the race and says so", async () => {
  const duplicate = new Bridge({
    pluginPort: PLUGIN_PORT,
    controlPort: CONTROL_PORT,
    version: "test-duplicate",
  });
  assert.equal(await duplicate.start(), false);
  await duplicate.stop();
});

test("a reply missing a field the caller needs is an error, not undefined", async () => {
  // An extension older than the server answers a command it knows with fields
  // it does not have. Passed through, the missing value reaches the agent as
  // "undefined pixel(s) changed" on a call that looks like it succeeded.
  const plugin = await fakePlugin((cmd) =>
    cmd === "session.site" ? { sprite: null } : { opsApplied: 1 },
  );
  const c = client();
  await c.waitForPlugin(2_000);

  await assert.rejects(
    () => c.call("draw.batch", {}, { expect: ["opsApplied", "pixelsChanged"] }),
    (err: Error & { code?: string; details?: { missing?: string[] } }) => {
      assert.equal(err.code, "aseprite_error");
      assert.deepEqual(err.details?.missing, ["pixelsChanged"]);
      assert.match(err.message, /install-extension/);
      return true;
    },
  );

  // A field that is present but null is an answer, not an omission.
  const data = await c.call<{ sprite: null }>("session.site", {}, { expect: ["sprite"] });
  assert.equal(data.sprite, null);

  c.close();
  plugin.close();
});

test("a field the extension leaves unset is not something a call may require", () => {
  // Regression: `session.site` answers {sprite = nil} when no document is open,
  // and a Lua table cannot hold nil — the key never reaches the wire. Requiring
  // it turned the normal state of a freshly started editor into "your extension
  // is out of date". `openSprites` is the field that is always there.
  const asAnEmptyEditorAnswers = { openSprites: 0 };
  assert.equal("sprite" in asAnEmptyEditorAnswers, false);
  assert.equal("openSprites" in asAnEmptyEditorAnswers, true);
});
