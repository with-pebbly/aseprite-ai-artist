import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildRamp,
  contrastRatio,
  deltaE,
  hueShiftShade,
  parseHex,
  rgbToLab,
  snapToPalette,
  toHex,
} from "../dist/lib/color.js";

test("parseHex accepts both lengths and rejects junk", () => {
  assert.deepEqual(parseHex("#ff004d"), { r: 255, g: 0, b: 77, a: 255 });
  assert.deepEqual(parseHex("ff004d80"), { r: 255, g: 0, b: 77, a: 128 });
  assert.throws(() => parseHex("#xyz"), /Invalid colour/);
});

test("toHex drops alpha unless asked and it matters", () => {
  assert.equal(toHex({ r: 255, g: 0, b: 77, a: 255 }, true), "#ff004d");
  assert.equal(toHex({ r: 255, g: 0, b: 77, a: 128 }, true), "#ff004d80");
  assert.equal(toHex({ r: 255, g: 0, b: 77, a: 128 }, false), "#ff004d");
});

test("CIELAB puts pure white and black at the ends of the L axis", () => {
  assert.ok(Math.abs(rgbToLab(parseHex("#ffffff")).l - 100) < 0.5);
  assert.ok(Math.abs(rgbToLab(parseHex("#000000")).l) < 0.5);
});

test("deltaE is zero for identical colours and grows with difference", () => {
  const red = rgbToLab(parseHex("#ff0000"));
  const nearRed = rgbToLab(parseHex("#fe0101"));
  const blue = rgbToLab(parseHex("#0000ff"));
  assert.equal(deltaE(red, red), 0);
  assert.ok(deltaE(red, nearRed) < 2);
  assert.ok(deltaE(red, blue) > 100);
});

test("snapToPalette picks the perceptually nearest entry, not the RGB-nearest", () => {
  // Classic case: RGB distance overweights green, so a dark olive can look
  // closer to a saturated green than to the grey a human would pick.
  const palette = ["#000000", "#808080", "#00ff00", "#ffffff"];
  const snapped = snapToPalette(parseHex("#7a7a7a"), palette);
  assert.equal(snapped.hex, "#808080");
  assert.ok(snapped.distance < 5);
});

test("snapToPalette refuses an empty palette rather than guessing", () => {
  assert.throws(() => snapToPalette(parseHex("#ffffff"), []), /empty/i);
});

test("shading a colour darker also cools its hue", () => {
  const base = parseHex("#c04030"); // warm red
  const shadow = hueShiftShade(base, { amount: -0.4 });
  const light = hueShiftShade(base, { amount: 0.4 });

  assert.ok(rgbToLab(shadow).l < rgbToLab(base).l, "shadow should be darker");
  assert.ok(rgbToLab(light).l > rgbToLab(base).l, "highlight should be lighter");
  // Cooling means the blue channel loses less than the red channel does.
  const redDrop = base.r - shadow.r;
  const blueDrop = base.b - shadow.b;
  assert.ok(redDrop > blueDrop, `expected red to fall faster than blue (${redDrop} vs ${blueDrop})`);
});

test("buildRamp centres on the base colour and returns the requested length", () => {
  const ramp = buildRamp(parseHex("#c04030"), 5);
  assert.equal(ramp.length, 5);
  const lightness = ramp.map((hex) => rgbToLab(parseHex(hex)).l);
  for (let i = 1; i < lightness.length; i++) {
    assert.ok(lightness[i]! > lightness[i - 1]!, "ramp must increase in lightness");
  }
  assert.throws(() => buildRamp(parseHex("#000000"), 1), /at least 2/);
});

test("contrastRatio matches the WCAG extremes", () => {
  assert.ok(Math.abs(contrastRatio(parseHex("#ffffff"), parseHex("#000000")) - 21) < 0.01);
  assert.equal(contrastRatio(parseHex("#777777"), parseHex("#777777")), 1);
});
