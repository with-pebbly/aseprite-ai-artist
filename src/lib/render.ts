/**
 * Turning pixels into something a language model can actually read.
 *
 * A 32×32 sprite rendered as a PNG is ~8 screen pixels wide once a vision model
 * downsamples it; the model then guesses. Two representations fix that:
 *   - an upscaled preview PNG (done inside Aseprite, see the `preview` tool);
 *   - a text grid, one glyph per pixel, which is exact and works on clients
 *     with no vision at all.
 *
 * The text grid is the verification half of the draw → look → fix loop.
 */

export interface PixelRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Distinct colours in the region. Index 0 is always fully transparent. */
  colors: string[];
  /** Row-major indices into `colors`, length = width * height. */
  grid: number[];
}

/** Glyph alphabet, ordered so the most common colours get the most distinct shapes. */
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#@%&$?!+=*";
const TRANSPARENT_GLYPH = ".";

export interface AsciiOptions {
  /** Refuse above this many cells; a wall of text is worse than no answer. */
  maxCells?: number;
  showRulers?: boolean;
}

export interface AsciiView {
  text: string;
  legend: Record<string, string>;
  width: number;
  height: number;
  originX: number;
  originY: number;
}

export function renderAscii(region: PixelRegion, opts: AsciiOptions = {}): AsciiView {
  const maxCells = opts.maxCells ?? 4096; // 64×64
  const cells = region.width * region.height;
  if (cells > maxCells) {
    throw new Error(
      `Region is ${region.width}×${region.height} (${cells} cells) which exceeds the ${maxCells}-cell text-grid limit. ` +
        `Pass a smaller region, or use the preview tool for a whole-sprite look.`,
    );
  }

  const legend: Record<string, string> = {};
  const glyphFor = new Map<number, string>();
  glyphFor.set(0, TRANSPARENT_GLYPH);

  let next = 0;
  for (let i = 1; i < region.colors.length; i++) {
    const glyph = GLYPHS[next++] ?? "?";
    glyphFor.set(i, glyph);
    legend[glyph] = region.colors[i] ?? "#000000";
  }

  const showRulers = opts.showRulers ?? true;
  const lines: string[] = [];
  const rowLabelWidth = String(region.y + region.height - 1).length;
  const pad = " ".repeat(rowLabelWidth + 1);

  if (showRulers) {
    // Two ruler rows: tens then units, so a 3-digit x is still readable.
    let tens = pad;
    let units = pad;
    for (let x = 0; x < region.width; x++) {
      const abs = region.x + x;
      tens += abs % 10 === 0 ? String(Math.floor(abs / 10) % 10) : " ";
      units += String(abs % 10);
    }
    lines.push(tens.trimEnd());
    lines.push(units);
  }

  for (let row = 0; row < region.height; row++) {
    let line = String(region.y + row).padStart(rowLabelWidth) + " ";
    for (let col = 0; col < region.width; col++) {
      const idx = region.grid[row * region.width + col] ?? 0;
      line += glyphFor.get(idx) ?? "?";
    }
    lines.push(line);
  }

  return {
    text: lines.join("\n"),
    legend,
    width: region.width,
    height: region.height,
    originX: region.x,
    originY: region.y,
  };
}

export interface DiffView {
  text: string;
  legend: Record<string, string>;
  changed: number;
  total: number;
}

/**
 * Pixel-level diff between two regions of equal size.
 *   `.` unchanged   `-` became transparent   glyph = the *new* colour
 * This answers "what did my edit actually touch", which a before/after image
 * pair does not, at small sizes.
 */
export function renderDiff(before: PixelRegion, after: PixelRegion): DiffView {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(
      `Cannot diff regions of different sizes (${before.width}×${before.height} vs ${after.width}×${after.height}).`,
    );
  }

  const legend: Record<string, string> = {};
  const glyphForColor = new Map<string, string>();
  let next = 0;

  const lines: string[] = [];
  let changed = 0;

  for (let row = 0; row < before.height; row++) {
    let line = "";
    for (let col = 0; col < before.width; col++) {
      const i = row * before.width + col;
      const beforeColor = before.colors[before.grid[i] ?? 0] ?? "transparent";
      const afterIdx = after.grid[i] ?? 0;
      const afterColor = after.colors[afterIdx] ?? "transparent";

      if (beforeColor === afterColor) {
        line += ".";
        continue;
      }
      changed++;
      if (afterIdx === 0) {
        line += "-";
        continue;
      }
      let glyph = glyphForColor.get(afterColor);
      if (!glyph) {
        glyph = GLYPHS[next++] ?? "?";
        glyphForColor.set(afterColor, glyph);
        legend[glyph] = afterColor;
      }
      line += glyph;
    }
    lines.push(line);
  }

  return {
    text: lines.join("\n"),
    legend,
    changed,
    total: before.width * before.height,
  };
}

/**
 * Pick an integer upscale factor that lands a sprite's long edge near `target`.
 * Nearest-neighbour only — any smoothing destroys the thing being reviewed.
 */
export function previewScale(width: number, height: number, target = 1024, cap = 16): number {
  const longEdge = Math.max(width, height, 1);
  const scale = Math.max(1, Math.round(target / longEdge));
  return Math.min(scale, cap);
}

/** Grid layout for a filmstrip: as close to square as whole cells allow. */
export function filmstripLayout(frames: number): { cols: number; rows: number } {
  if (frames <= 0) return { cols: 0, rows: 0 };
  const cols = Math.ceil(Math.sqrt(frames));
  const rows = Math.ceil(frames / cols);
  return { cols, rows };
}
