import { deflateSync } from "node:zlib";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decodePng } from "../dist/lib/png.js";
import { compileImage, gridRowsFromText, readOpFile } from "../dist/lib/grid.js";
import { chunk, png } from "./png-writer.ts";

const px = (d: { rgba: Uint8Array; width: number }, x: number, y: number) =>
  Array.from(d.rgba.subarray((y * d.width + x) * 4, (y * d.width + x) * 4 + 4));

test("decodes 8-bit RGBA", () => {
  const d = decodePng(png(2, 1, 8, 6, [[255, 0, 0, 255, 0, 0, 0, 0]]));
  assert.equal(d.width, 2);
  assert.deepEqual(px(d, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(px(d, 1, 0), [0, 0, 0, 0]);
});

test("undoes Sub, Up, Average and Paeth filters", () => {
  // Target image (RGB): row0 = (10,20,30)(40,50,60), row1 = (11,22,33)(44,55,66), rows 2–3 repeat row 1.
  const target = [
    [10, 20, 30, 40, 50, 60],
    [11, 22, 33, 44, 55, 66],
    [11, 22, 33, 44, 55, 66],
    [11, 22, 33, 44, 55, 66],
  ];
  const sub = (r: number[]) => r.map((v, i) => (v - (i >= 3 ? r[i - 3]! : 0)) & 0xff);
  const up = (r: number[], p: number[]) => r.map((v, i) => (v - p[i]!) & 0xff);
  const avg = (r: number[], p: number[]) => r.map((v, i) => (v - (((i >= 3 ? r[i - 3]! : 0) + p[i]!) >> 1)) & 0xff);
  const paeth = (r: number[], p: number[]) =>
    r.map((v, i) => {
      const a = i >= 3 ? r[i - 3]! : 0;
      const b = p[i]!;
      const c = i >= 3 ? p[i - 3]! : 0;
      const q = a + b - c;
      const pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
      return (v - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
    });
  const rows = [sub(target[0]!), up(target[1]!, target[0]!), avg(target[2]!, target[1]!), paeth(target[3]!, target[2]!)];
  const d = decodePng(png(2, 4, 8, 2, rows, [], [1, 2, 3, 4]));
  for (let y = 0; y < 4; y++) {
    assert.deepEqual(px(d, 0, y).slice(0, 3), target[y]!.slice(0, 3), `row ${y} pixel 0`);
    assert.deepEqual(px(d, 1, y).slice(0, 3), target[y]!.slice(3, 6), `row ${y} pixel 1`);
  }
});

test("decodes a 4-bit palette image with tRNS", () => {
  const plte = chunk("PLTE", Buffer.from([0, 0, 0, 255, 119, 168, 0, 228, 54]));
  const trns = chunk("tRNS", Buffer.from([0]));
  // indices 0,1,2,1 → packed 0x01, 0x21
  const d = decodePng(png(4, 1, 4, 3, [[0x01, 0x21]], [plte, trns]));
  assert.deepEqual(px(d, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(px(d, 1, 0), [255, 119, 168, 255]);
  assert.deepEqual(px(d, 2, 0), [0, 228, 54, 255]);
});

test("an RGB colour key in tRNS is transparent", () => {
  const trns = chunk("tRNS", Buffer.from([0, 1, 0, 2, 0, 3]));
  const d = decodePng(png(2, 1, 8, 2, [[1, 2, 3, 9, 9, 9]], [trns]));
  assert.equal(px(d, 0, 0)[3], 0);
  assert.equal(px(d, 1, 0)[3], 255);
});

test("interlaced and 16-bit PNGs are refused by name", () => {
  const p = png(1, 1, 16, 6, [[0, 0, 0, 0, 0, 0, 0, 0]]);
  assert.throws(() => decodePng(p), /bit depth 16/);
  const i = png(1, 1, 8, 6, [[0, 0, 0, 0]]);
  i[8 + 8 + 12] = 1; // IHDR interlace byte
  assert.throws(() => decodePng(i), /Interlaced/);
  assert.throws(() => decodePng(Buffer.from("not a png")), /signature/);
});

test("a PNG that inflates past its header, or declares a huge one, is refused before decoding", () => {
  // 1×1 RGBA promises 5 bytes of image data; this IDAT inflates to 64 MiB.
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const bomb = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(64 * 1024 * 1024))),
    chunk("IEND", new Uint8Array()),
  ]);
  assert.throws(() => decodePng(bomb), /inflates past the 1×1/);
  // The header alone decides the allocation, so a 65535×65535 claim stops there.
  const huge = png(1, 1, 8, 6, [[0, 0, 0, 0]]);
  huge.writeUInt32BE(65535, 16);
  huge.writeUInt32BE(65535, 20);
  assert.throws(() => decodePng(huge), /65535×65535; the limit is/);
});

test("compileImage paints colours, erases alpha 0, honours crop and x/y", () => {
  const d = decodePng(png(3, 1, 8, 6, [[255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255]]));
  const out = compileImage(d, { x: 5, y: 6, transparent: "erase" }, { width: 64, height: 64 });
  assert.deepEqual(out.ops, [
    { kind: "clear", region: { x: 6, y: 6, width: 1, height: 1 } },
    { kind: "pixels", color: "#ff0000", points: [{ x: 5, y: 6 }] },
    { kind: "pixels", color: "#0000ff", points: [{ x: 7, y: 6 }] },
  ]);
  const cropped = compileImage(d, { x: 0, y: 0, transparent: "skip", crop: { x: 2, y: 0, width: 1, height: 1 } }, { width: 64, height: 64 });
  assert.deepEqual(cropped.ops, [{ kind: "pixels", color: "#0000ff", points: [{ x: 0, y: 0 }] }]);
});

test("compileImage refuses partial alpha, a crop outside the image and an image bigger than the canvas", () => {
  const soft = decodePng(png(1, 1, 8, 6, [[255, 0, 0, 128]]));
  assert.throws(() => compileImage(soft, { x: 0, y: 0, transparent: "erase" }, { width: 8, height: 8 }), /semi-transparent.*\(0,0\).*128/);
  const big = decodePng(png(3, 1, 8, 2, [[0, 0, 0, 0, 0, 0, 0, 0, 0]]));
  assert.throws(() => compileImage(big, { x: 0, y: 0, transparent: "erase" }, { width: 2, height: 2 }), /canvas is 2×2/);
  assert.throws(
    () => compileImage(big, { x: 0, y: 0, transparent: "erase", crop: { x: 2, y: 0, width: 2, height: 1 } }, { width: 8, height: 8 }),
    /outside/,
  );
});

test("grid files: one row per line, CRLF and trailing blank lines ignored", () => {
  assert.deepEqual(gridRowsFromText("﻿.O.\r\nOOO\n\n\n"), [".O.", "OOO"]);
  // A blank line in the middle stays, so the ragged-row check names it.
  assert.deepEqual(gridRowsFromText("O\n\nO\n"), ["O", "", "O"]);
});

test("readOpFile resolves against the given directory and names a missing file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aia-png-"));
  writeFileSync(path.join(dir, "g.txt"), "OO\n");
  assert.equal(readOpFile("g.txt", dir).toString("utf8"), "OO\n");
  assert.throws(() => readOpFile("nope.txt", dir), /Cannot read 'nope.txt'/);
});
