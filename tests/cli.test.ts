import { strict as assert } from "node:assert";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { Bridge } from "../dist/bridge/bridge.js";

const run = promisify(execFile);

/** Well away from the defaults, so a real Aseprite session is never disturbed. */
const PORTS = {
  noBridge: { plugin: 19951, control: 19952 },
  ownBridge: { plugin: 19953, control: 19954 },
  // Privileged: nothing can bind them, and connecting is refused at once.
  blocked: { plugin: 1, control: 2 },
};

function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(true));
    probe.once("listening", () => probe.close(() => resolve(false)));
    probe.listen(port, "127.0.0.1");
  });
}

/** A killed process releases its port a moment later, not instantly. */
async function settledListening(port: number, expected: boolean): Promise<boolean> {
  const deadline = Date.now() + 3_000;
  let seen = await isListening(port);
  while (seen !== expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    seen = await isListening(port);
  }
  return seen;
}

async function doctor(ports: { plugin: number; control: number }): Promise<string> {
  const args = [
    "dist/cli.js",
    "doctor",
    "--plugin-port",
    String(ports.plugin),
    "--control-port",
    String(ports.control),
  ];
  try {
    const { stdout } = await run(process.execPath, args);
    return stdout;
  } catch (err) {
    // Exits non-zero whenever Aseprite is not attached, which is every run here.
    return String((err as { stdout?: string }).stdout ?? "");
  }
}

test("doctor does not leave behind a bridge it started itself", async () => {
  const out = await doctor(PORTS.noBridge);

  // It may start one — reaching Aseprite requires a bridge — but it must say so
  // rather than claim it found a healthy setup, and must clean up after itself.
  assert.match(out, /not running — started one to test/);
  assert.match(out, /Stopped the bridge this check started/);
  assert.doesNotMatch(out, /✓ Bridge/);

  assert.equal(
    await settledListening(PORTS.noBridge.control, false),
    false,
    "doctor left a bridge daemon running on the control port",
  );
});

test("a bridge that was already up is reported as found, and left running", async () => {
  const bridge = new Bridge({
    pluginPort: PORTS.ownBridge.plugin,
    controlPort: PORTS.ownBridge.control,
    version: "test",
  });
  assert.ok(await bridge.start(), "bridge failed to bind its test ports");

  try {
    const out = await doctor(PORTS.ownBridge);

    assert.match(out, /✓ Bridge/);
    assert.doesNotMatch(out, /started one to test/);
    assert.doesNotMatch(out, /Stopped the bridge/);

    // Killing a bridge it did not start would drop a live agent session.
    assert.equal(
      await isListening(PORTS.ownBridge.control),
      true,
      "doctor stopped a bridge that was not its to stop",
    );
  } finally {
    await bridge.stop();
  }
});

test("with no reachable bridge, the extension is 'unknown' rather than blamed", async () => {
  // Privileged ports make the failure certain and instant, with no socket to
  // clean up: connecting is refused straight away, and the bridge doctor tries
  // to start cannot bind them either. Before this, doctor told the user to go
  // open Aseprite — advice that fixes nothing, because Aseprite was never the
  // thing that was broken.
  const out = await doctor(PORTS.blocked);

  assert.match(out, /✗ Bridge {2,}could not reach or start it/);
  assert.match(out, /· Aseprite extension {2,}unknown — cannot be checked without a bridge/);
  assert.doesNotMatch(out, /open Aseprite/);
});
