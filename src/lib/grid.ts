import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { DecodedPng } from "./png.js";
import { LiveError } from "./protocol.js";

/**
 * PixelGrid: a picture written as text, one glyph per pixel, compiled into the
 * ordinary `draw` ops Aseprite already executes.
 *
 * It is the writable half of `look op="ascii"`. A model is far better at
 * laying out a silhouette it can see as rows of characters than at composing
 * it from ellipse/rect/line calls whose result it cannot see until afterwards,
 * so the grid is the authoring format and this file does the rasterising —
 * deterministically, in code, where an off-by-one is a test failure instead of
 * a misplaced limb.
 *
 * Expansion happens here, server-side, like `text`: the Lua extension never
 * learns a new op, and the same compiler serves the live window and headless.
 */

export const TRANSPARENT_GLYPH = ".";

/** The sprite's canvas. A grid may be as large as it and no larger. */
export interface CanvasSize {
  width: number;
  height: number;
}

export interface GridOp {
  x: number;
  y: number;
  /** glyph → colour; null is transparent. "." is transparent unless redefined. */
  legend: Record<string, string | null>;
  rows: string[];
  /** What transparent cells do: "erase" clears them, "skip" leaves the pixel underneath. */
  transparent: "erase" | "skip";
}

export interface CompiledGrid {
  /** Wire ops for draw.batch: `clear` rectangles first, then one `pixels` op per colour. */
  ops: Record<string, unknown>[];
  width: number;
  height: number;
  painted: number;
  erased: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function compileGrid(op: GridOp, canvas: CanvasSize): CompiledGrid {
  const legend = new Map<string, string | null>();
  if (!Object.hasOwn(op.legend, TRANSPARENT_GLYPH)) legend.set(TRANSPARENT_GLYPH, null);
  for (const [glyph, color] of Object.entries(op.legend)) {
    // Code points, not UTF-16 units: a glyph outside the BMP is still one cell.
    if (Array.from(glyph).length !== 1) {
      throw new LiveError(
        "invalid_args",
        `Legend key '${glyph}' is not a single character. Every grid cell is exactly one glyph, so every legend key must be one too.`,
        { glyph },
      );
    }
    legend.set(glyph, color);
  }

  const grid = op.rows.map((row) => Array.from(row));
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  if (height === 0 || width === 0) {
    throw new LiveError("invalid_args", "A grid needs at least one row with at least one cell.");
  }
  if (width > canvas.width || height > canvas.height) {
    throw new LiveError(
      "too_large",
      `Grid is ${width}×${height} but the canvas is ${canvas.width}×${canvas.height}. A grid can cover the whole canvas, not more — ` +
        `check for extra rows or columns.`,
      { width, height, canvasWidth: canvas.width, canvasHeight: canvas.height },
    );
  }

  // Ragged rows are the commonest way a model miscounts a grid. Padding or
  // truncating would silently shift everything right of the mistake, so name
  // the row instead and let the model fix the one line that is wrong.
  for (let r = 0; r < height; r++) {
    const length = grid[r]!.length;
    if (length !== width) {
      throw new LiveError(
        "invalid_args",
        `Grid row ${r} (y=${op.y + r}) has ${length} cell(s) but row 0 has ${width}. Every row must be the same width — ` +
          `pad with '${TRANSPARENT_GLYPH}' rather than leaving a row short.`,
        { row: r, y: op.y + r, cells: length, expected: width },
      );
    }
    for (let c = 0; c < width; c++) {
      const glyph = grid[r]![c]!;
      if (!legend.has(glyph)) {
        throw new LiveError(
          "invalid_args",
          `Grid row ${r}, column ${c} (x=${op.x + c}, y=${op.y + r}) uses '${glyph}', which is not in the legend. ` +
            `Add it to the legend or use '${TRANSPARENT_GLYPH}' for transparent.`,
          { row: r, column: c, x: op.x + c, y: op.y + r, glyph },
        );
      }
    }
  }

  const cells = grid.map((row) => row.map((glyph) => legend.get(glyph) ?? null));
  return compileCells(cells, op.x, op.y, op.transparent);
}

/**
 * Compile a rectangle of colours (null = transparent) placed at x/y into wire
 * ops. Shared by `grid` and `image`, so both erase, merge and batch the same way.
 * Callers check the size against the canvas first.
 */
export function compileCells(
  cells: (string | null)[][],
  x: number,
  y: number,
  transparent: "erase" | "skip",
): CompiledGrid {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  const byColor = new Map<string, { x: number; y: number }[]>();
  // Erased cells merge into rectangles: horizontal runs per row, then runs with
  // the same span in consecutive rows grow one rectangle downward. A transparent
  // margin around a sprite then costs a handful of clears, not one per cell.
  const erases: Rect[] = [];
  let open = new Map<string, Rect>();
  let painted = 0;
  let erased = 0;

  for (let r = 0; r < height; r++) {
    const row = cells[r]!;
    const next = new Map<string, Rect>();
    let c = 0;
    while (c < width) {
      const color = row[c] ?? null;
      if (color !== null) {
        const points = byColor.get(color) ?? [];
        points.push({ x: x + c, y: y + r });
        byColor.set(color, points);
        painted++;
        c++;
        continue;
      }
      const start = c;
      while (c < width && (row[c] ?? null) === null) c++;
      if (transparent === "skip") continue;
      erased += c - start;
      const key = `${start}:${c - start}`;
      const above = open.get(key);
      if (above) {
        above.height++;
        next.set(key, above);
      } else {
        const rect = { x: x + start, y: y + r, width: c - start, height: 1 };
        erases.push(rect);
        next.set(key, rect);
      }
    }
    open = next;
  }

  const ops: Record<string, unknown>[] = erases.map((region) => ({ kind: "clear", region }));
  for (const [color, points] of byColor) ops.push({ kind: "pixels", color, points });
  return { ops, width, height, painted, erased };
}

/** Biggest file `grid`'s `file` or `image`'s `path` will read: a 4096×4096 RGBA PNG is well under it. */
const MAX_FILE_BYTES = 16 * 1024 * 1024;

/**
 * Read a file an agent named in a draw op, relative to the server's working
 * directory (the agent's own). An agent that renders its art with a script
 * passes the file instead of retyping every row into the call — the rows cost
 * nothing to send, and nothing gets lost in the copy.
 */
export function readOpFile(file: string, cwd: string = process.cwd()): Buffer {
  const full = path.resolve(cwd, file);
  let size: number;
  try {
    size = statSync(full).size;
  } catch {
    throw new LiveError("invalid_args", `Cannot read '${file}' (resolved to ${full}).`, { path: full });
  }
  if (size > MAX_FILE_BYTES) {
    throw new LiveError("too_large", `'${file}' is ${size} bytes; the limit is ${MAX_FILE_BYTES}.`, { path: full, size });
  }
  return readFileSync(full);
}

/** A grid file: one row per line, trailing blank lines (and a final newline) ignored. */
export function gridRowsFromText(text: string): string[] {
  const rows = text.replace(/^﻿/, "").split(/\r?\n/);
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  return rows;
}

export interface ImageOp {
  x: number;
  y: number;
  transparent: "erase" | "skip";
  /** Use only this rectangle of the source image — one cell of a sheet. */
  crop?: Rect;
}

const hex2 = (v: number) => v.toString(16).padStart(2, "0");

/**
 * Compile a decoded PNG into the same wire ops a grid makes. Alpha 0 is
 * transparent and 255 is a colour; anything between is refused, because pixel
 * art has no partial alpha and quietly rounding it would invent or drop pixels.
 */
export function compileImage(png: DecodedPng, op: ImageOp, canvas: CanvasSize, label = "image"): CompiledGrid {
  const crop = op.crop ?? { x: 0, y: 0, width: png.width, height: png.height };
  if (crop.x < 0 || crop.y < 0 || crop.x + crop.width > png.width || crop.y + crop.height > png.height) {
    throw new LiveError(
      "invalid_args",
      `crop ${crop.width}×${crop.height} at (${crop.x},${crop.y}) is outside the ${png.width}×${png.height} ${label}.`,
      { crop, imageWidth: png.width, imageHeight: png.height },
    );
  }
  if (crop.width > canvas.width || crop.height > canvas.height) {
    throw new LiveError(
      "too_large",
      `The ${label} is ${crop.width}×${crop.height} but the canvas is ${canvas.width}×${canvas.height}. ` +
        "Pass `crop` to take one cell of a sheet, or export it at 1× (no upscale).",
      { width: crop.width, height: crop.height, canvasWidth: canvas.width, canvasHeight: canvas.height },
    );
  }
  const cells: (string | null)[][] = [];
  let partial = 0;
  let firstPartial: { x: number; y: number; alpha: number } | undefined;
  for (let r = 0; r < crop.height; r++) {
    const row: (string | null)[] = [];
    for (let c = 0; c < crop.width; c++) {
      const o = ((crop.y + r) * png.width + crop.x + c) * 4;
      const a = png.rgba[o + 3]!;
      if (a === 0) {
        row.push(null);
        continue;
      }
      if (a !== 255) {
        partial++;
        firstPartial ??= { x: crop.x + c, y: crop.y + r, alpha: a };
      }
      row.push(`#${hex2(png.rgba[o]!)}${hex2(png.rgba[o + 1]!)}${hex2(png.rgba[o + 2]!)}`);
    }
    cells.push(row);
  }
  if (firstPartial) {
    throw new LiveError(
      "invalid_args",
      `The ${label} has ${partial} semi-transparent pixel(s), first at (${firstPartial.x},${firstPartial.y}) with alpha ${firstPartial.alpha}. ` +
        "Pixel art needs alpha 0 or 255 — usually this is anti-aliasing or a smooth upscale; render with nearest-neighbour and no AA.",
      { count: partial, ...firstPartial },
    );
  }
  return compileCells(cells, op.x, op.y, op.transparent);
}
