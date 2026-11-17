import { inflateSync } from "node:zlib";
import { LiveError } from "./protocol.js";

/**
 * A minimal PNG reader for `draw` op `image`: enough to bring in a frame an
 * agent rendered with its own script, nothing more. Non-interlaced, 1/2/4/8-bit
 * greyscale and palette images, 8-bit RGB, grey+alpha and RGBA — which covers
 * what Pillow, a hand-rolled zlib writer and Aseprite itself write for pixel
 * art. Anything else is refused by name instead of being decoded wrong.
 */

export interface DecodedPng {
  width: number;
  height: number;
  /** width × height × 4 bytes, row-major RGBA. */
  rgba: Uint8Array;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function unsupported(message: string): LiveError {
  return new LiveError("invalid_args", `${message} Save it as a non-interlaced 8-bit RGBA PNG.`);
}

export function decodePng(buf: Uint8Array): DecodedPng {
  if (buf.length < 8 || SIGNATURE.some((b, i) => buf[i] !== b)) {
    throw new LiveError("invalid_args", "Not a PNG file (bad signature).");
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let palette: Uint8Array | undefined;
  let paletteAlpha: Uint8Array | undefined;
  const idat: Uint8Array[] = [];

  let pos = 8;
  while (pos + 8 <= buf.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(buf[pos + 4]!, buf[pos + 5]!, buf[pos + 6]!, buf[pos + 7]!);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    if (data.length !== length) throw new LiveError("invalid_args", "PNG is truncated.");
    if (type === "IHDR") {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      depth = data[8]!;
      colorType = data[9]!;
      if (data[12] !== 0) throw unsupported("Interlaced PNGs are not supported.");
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "tRNS") {
      paletteAlpha = data;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + length;
  }

  if (width === 0 || height === 0) throw new LiveError("invalid_args", "PNG has no IHDR chunk or is empty.");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (channels === undefined) throw unsupported(`PNG colour type ${colorType} is not supported.`);
  const lowBitOk = colorType === 0 || colorType === 3;
  if (!(depth === 8 || (lowBitOk && (depth === 1 || depth === 2 || depth === 4)))) {
    throw unsupported(`PNG bit depth ${depth} with colour type ${colorType} is not supported.`);
  }
  if (colorType === 3 && !palette) throw new LiveError("invalid_args", "Palette PNG has no PLTE chunk.");

  const raw = inflateSync(Buffer.concat(idat));
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  if (raw.length < height * (stride + 1)) throw new LiveError("invalid_args", "PNG image data is truncated.");

  // Undo the per-row filters in place.
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : undefined;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp]! : 0;
      const b = prev ? prev[i]! : 0;
      const c = prev && i >= bpp ? prev[i - bpp]! : 0;
      let v = src[i]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new LiveError("invalid_args", `PNG row ${y} has unknown filter ${filter}.`);
      out[i] = v & 0xff;
    }
  }

  // tRNS on a greyscale or RGB image names one colour key that is fully transparent.
  const key =
    paletteAlpha && colorType === 0 && paletteAlpha.length >= 2
      ? [paletteAlpha[1]!]
      : paletteAlpha && colorType === 2 && paletteAlpha.length >= 6
        ? [paletteAlpha[1]!, paletteAlpha[3]!, paletteAlpha[5]!]
        : undefined;

  const rgba = new Uint8Array(width * height * 4);
  const sample = (row: Uint8Array, index: number): number => {
    if (depth === 8) return row[index]!;
    const bit = index * depth;
    return (row[bit >> 3]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  for (let y = 0; y < height; y++) {
    const row = rows.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 6) {
        rgba.set(row.subarray(x * 4, x * 4 + 4), o);
      } else if (colorType === 2) {
        rgba.set(row.subarray(x * 3, x * 3 + 3), o);
        rgba[o + 3] = key && key[0] === rgba[o] && key[1] === rgba[o + 1] && key[2] === rgba[o + 2] ? 0 : 255;
      } else if (colorType === 4) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = row[x * 2]!;
        rgba[o + 3] = row[x * 2 + 1]!;
      } else if (colorType === 0) {
        const s = sample(row, x);
        const g = Math.round((s * 255) / ((1 << depth) - 1));
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        rgba[o + 3] = key && key[0] === s ? 0 : 255;
      } else {
        const i = sample(row, x);
        if (i * 3 + 2 >= palette!.length) throw new LiveError("invalid_args", `PNG pixel (${x},${y}) uses palette index ${i}, past the PLTE chunk.`);
        rgba[o] = palette![i * 3]!;
        rgba[o + 1] = palette![i * 3 + 1]!;
        rgba[o + 2] = palette![i * 3 + 2]!;
        rgba[o + 3] = paletteAlpha && i < paletteAlpha.length ? paletteAlpha[i]! : 255;
      }
    }
  }
  return { width, height, rgba };
}
