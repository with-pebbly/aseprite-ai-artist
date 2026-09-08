# Palette and colour

## Decide the palette first

A palette chosen after the art is finished means repainting the art. Choose
before the first pixel, and state it back to the user so they can object early.

Reasonable defaults when the user has no preference:

- "retro" / "8-bit" / no detail given → **PICO-8** (16 colours, forgiving, reads well)
- "Game Boy" / "monochrome" → **gameboy** (4 values; pure form study)
- "NES-like" → a hand-built 12–16 colour palette, 3–4 hues × 4 values
- A specific game named → sample it: `reference` op `sample_palette`

Load one with `palette` op `preset`, or a file the user has with op `load`.

## Size

Most sprites want **8–32 colours total**. Per material, 3–5 steps is plenty:
shadow, base, light, and optionally a deep shadow and a specular.

More colours is not more quality. It is more decisions, more inconsistency, and
a sprite that cannot be recoloured for a palette swap later.

## Ramps, not gradients

A **ramp** is an ordered run of colours for one material. Build them with
`palette` op `ramp`, which hue-shifts as it goes (see
`rules://02-shading-and-light`). Reuse ramps across materials wherever you can —
sharing the darkest step between skin and leather ties a sprite together and
costs nothing.

## Palette lock

`draw` and `recolor` snap every colour to the nearest palette entry by
perceptual (CIELAB) distance, by default. Leave it on.

When the report says a colour moved a long way (ΔE > 12), that is the tool
telling you the palette has no colour for what you asked. Do not turn the lock
off to force it through — either pick a different colour or tell the user the
palette needs a new entry and let them decide.

## Contrast is what makes a sprite readable

Value contrast, not hue contrast, carries readability. A sprite that is all
mid-tones disappears against a background. Check by squinting — or run
`recolor` op `desaturate` on a copy and see whether the shapes survive.

Keep the darkest and lightest steps of a ramp genuinely far apart. Two colours
with ΔE under 3 are the same colour to a viewer; `palette` op `analyze` flags
those as near-duplicates.
