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

test("a second bridge on the same ports loses the race and says so", async () => {
  const duplicate = new Bridge({
    pluginPort: PLUGIN_PORT,
    controlPort: CONTROL_PORT,
    version: "test-duplicate",
  });
  assert.equal(await duplicate.start(), false);
  await duplicate.stop();
});
