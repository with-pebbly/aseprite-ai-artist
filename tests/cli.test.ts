import { strict as assert } from "node:assert";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { Bridge } from "../dist/bridge/bridge.js";
import { linkLines } from "../dist/lib/report.js";

const run = promisify(execFile);

/** Well away from the defaults, so a real Aseprite session is never disturbed. */
const PORTS = {
  noBridge: { plugin: 19951, control: 19952 },
  ownBridge: { plugin: 19953, control: 19954 },
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

// The wording itself is checked here rather than through a subprocess: making a
// bridge genuinely unreachable needs a port nothing can bind, and "nothing" is
// not the same set on every OS — a Windows runner runs as admin and binds the
// privileged ports a POSIX one refuses.

test("a bridge started by the check is not reported as a healthy setup", () => {
  const [bridge] = linkLines({
    bridgeUp: true,
    wasAlreadyRunning: false,
    pluginUp: false,
    controlPort: 9932,
  });
  assert.doesNotMatch(bridge, /✓/, "a bridge this command started must not read as a tick");
  assert.match(bridge, /started one to test/);
});

test("a bridge that was already running is a tick", () => {
  const [bridge] = linkLines({
    bridgeUp: true,
    wasAlreadyRunning: true,
    pluginUp: true,
    controlPort: 9932,
  });
  assert.match(bridge, /^✓ Bridge/);
  assert.match(bridge, /ws:\/\/127\.0\.0\.1:9932/);
});

test("with no bridge the extension is unknown, and Aseprite is not blamed", () => {
  const [bridge, extension] = linkLines({
    bridgeUp: false,
    wasAlreadyRunning: false,
    pluginUp: false,
    controlPort: 9932,
  });
  assert.match(bridge, /^✗ Bridge/);
  assert.match(extension, /unknown — cannot be checked without a bridge/);
  // Sending the user to reinstall an extension that was never the problem.
  assert.doesNotMatch(extension, /open Aseprite/);
});

test("a reachable bridge with no Aseprite names the fix", () => {
  const [, extension] = linkLines({
    bridgeUp: true,
    wasAlreadyRunning: true,
    pluginUp: false,
    controlPort: 9932,
  });
  assert.match(extension, /^✗ Aseprite extension/);
  assert.match(extension, /install-extension/);
});

test("a connected extension reports both versions", () => {
  const [, extension] = linkLines({
    bridgeUp: true,
    wasAlreadyRunning: true,
    pluginUp: true,
    controlPort: 9932,
    extensionVersion: "0.1.0",
    asepriteVersion: "1.3.17",
  });
  assert.match(extension, /^✓ Aseprite extension/);
  assert.match(extension, /0\.1\.0 on Aseprite 1\.3\.17/);
});
