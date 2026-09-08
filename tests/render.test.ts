import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { PixelRegion } from "../dist/lib/render.js";
import {
  filmstripLayout,
  previewScale,
  renderAscii,
  renderDiff,
} from "../dist/lib/render.js";

function region(width: number, height: number, grid: number[], colors: string[]): PixelRegion {
  return { x: 0, y: 0, width, height, colors: ["#00000000", ...colors], grid };
}

test("renderAscii lays out one glyph per pixel with rulers", () => {
  const view = renderAscii(region(3, 2, [0, 1, 1, 1, 0, 2], ["#ff0000", "#00ff00"]));
  const lines = view.text.split("\n");
  // two ruler rows, then two pixel rows
  assert.equal(lines.length, 4);
  assert.ok(lines[2]!.endsWith(".AA"));
  assert.ok(lines[3]!.endsWith("A.B"));
  assert.deepEqual(view.legend, { A: "#ff0000", B: "#00ff00" });
});

test("renderAscii keeps absolute coordinates in the row labels", () => {
  const r = region(2, 2, [1, 1, 1, 1], ["#ffffff"]);
  r.x = 10;
  r.y = 7;
  const view = renderAscii(r);
  const lines = view.text.split("\n");
  assert.ok(lines[2]!.startsWith("7 "), `expected row label 7, got '${lines[2]}'`);
  assert.equal(view.originX, 10);
});

test("renderAscii refuses a grid too large to read", () => {
  const big = region(100, 100, new Array(10000).fill(0), []);
  assert.throws(() => renderAscii(big), /exceeds the .* text-grid limit/);
});

test("renderDiff marks unchanged, erased and repainted pixels distinctly", () => {
  const before = region(3, 1, [1, 1, 2], ["#ff0000", "#00ff00"]);
  const after = region(3, 1, [1, 0, 1], ["#ff0000"]);
  const diff = renderDiff(before, after);
  assert.equal(diff.text, ".-A");
  assert.equal(diff.changed, 2);
  assert.equal(diff.total, 3);
  assert.deepEqual(diff.legend, { A: "#ff0000" });
});

test("renderDiff refuses mismatched sizes instead of silently truncating", () => {
  assert.throws(
    () => renderDiff(region(2, 1, [0, 0], []), region(3, 1, [0, 0, 0], [])),
    /different sizes/,
  );
});

test("previewScale lands a small sprite near the target and caps the factor", () => {
  assert.equal(previewScale(32, 32, 1024), 16); // capped
  assert.equal(previewScale(128, 128, 1024), 8);
  assert.equal(previewScale(2048, 2048, 1024), 1); // never downscales below 1
});

test("filmstripLayout stays as square as whole cells allow", () => {
  assert.deepEqual(filmstripLayout(4), { cols: 2, rows: 2 });
  assert.deepEqual(filmstripLayout(5), { cols: 3, rows: 2 });
  assert.deepEqual(filmstripLayout(0), { cols: 0, rows: 0 });
});
