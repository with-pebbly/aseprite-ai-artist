/**
 * Colour maths for palette-legal editing.
 *
 * Pixel art lives or dies by palette discipline, and "nearest colour" in RGB
 * space is not the colour a human would pick — RGB distance weights green far
 * too heavily and ignores lightness. Everything here works in CIELAB with
 * CIE76 ΔE, which is close enough to perceptual for a ≤64-colour palette and
 * cheap enough to run per-pixel.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Lab {
  l: number;
  a: number;
  b: number;
}

const HEX_RE = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function parseHex(hex: string): Rgb {
  const m = HEX_RE.exec(hex.trim());
  if (!m || !m[1]) throw new Error(`Invalid colour '${hex}'. Expected #rrggbb or #rrggbbaa.`);
  const s = m[1];
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
    a: s.length === 8 ? parseInt(s.slice(6, 8), 16) : 255,
  };
}

export function toHex({ r, g, b, a }: Rgb, includeAlpha = false): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return includeAlpha && a !== 255 ? `#${h(r)}${h(g)}${h(b)}${h(a)}` : `#${h(r)}${h(g)}${h(b)}`;
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** D65 reference white. */
const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;

export function rgbToLab({ r, g, b }: Rgb): Lab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / XN;
  const y = (0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb) / YN;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / ZN;

  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27) * t / 116 + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIE76 ΔE. Values below ~2.3 are indistinguishable to most viewers. */
export function deltaE(a: Lab, b: Lab): number {
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b);
}

export interface SnapResult {
  index: number;
  hex: string;
  distance: number;
}

/**
 * Nearest palette entry to `colour`, by ΔE.
 *
 * A fully transparent input snaps to itself: a palette has no entry for
 * "nothing", and picking the nearest opaque colour for it would paint over
 * holes the artist left on purpose.
 */
export function snapToPalette(colour: Rgb, palette: readonly string[]): SnapResult {
  if (palette.length === 0) throw new Error("Palette is empty.");
  if (colour.a === 0) return { index: -1, hex: toHex(colour, true), distance: 0 };
  const target = rgbToLab(colour);
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < palette.length; i++) {
    const entry = palette[i];
    if (entry === undefined) continue;
    const d = deltaE(target, rgbToLab(parseHex(entry)));
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return { index: best, hex: palette[best]!, distance: bestDistance };
}

export interface HueShiftOptions {
  /** Positive lightens, negative darkens. Roughly one ramp step per 0.15. */
  amount: number;
  /** Degrees of hue rotation applied at full amount. */
  hueShiftDegrees?: number;
}

/**
 * Shade a colour the way a pixel artist does, not the way a brightness slider
 * does: shadows rotate toward blue and desaturate slightly, highlights rotate
 * toward yellow/orange and saturate. Flat luminance ramps are the single most
 * common tell of machine-made pixel art.
 */
export function hueShiftShade(colour: Rgb, opts: HueShiftOptions): Rgb {
  const { amount } = opts;
  const degrees = opts.hueShiftDegrees ?? 25;
  const { h, s, l } = rgbToHsl(colour);

  const shift = -Math.sign(amount) * degrees * Math.abs(amount);
  const newHue = (((h + shift) % 360) + 360) % 360;
  const newLight = clamp01(l + amount * 0.5);
  const newSat = clamp01(s + (amount > 0 ? 0.06 : -0.04) * Math.abs(amount) * 2);

  return { ...hslToRgb({ h: newHue, s: newSat, l: newLight }), a: colour.a };
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;

  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Omit<Rgb, "a"> {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = (((h % 360) + 360) % 360) / 360;
  const channel = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(channel(hk + 1 / 3) * 255),
    g: Math.round(channel(hk) * 255),
    b: Math.round(channel(hk - 1 / 3) * 255),
  };
}

/**
 * Build a hue-shifted ramp of `steps` colours around a base colour.
 * The base sits at the ramp's midpoint so callers get equal shadow and light.
 */
export function buildRamp(base: Rgb, steps: number, spread = 0.55): string[] {
  if (steps < 2) throw new Error("A ramp needs at least 2 steps.");
  const out: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : (i / (steps - 1)) * 2 - 1; // -1 … +1
    out.push(toHex(hueShiftShade(base, { amount: t * spread })));
  }
  return out;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Perceptual luminance, used by contrast and readability checks. */
export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
