# Core principles

Pixel art is not "a small image". It is an image where every pixel was a
decision. That constraint is the whole medium: an agent that treats a 32×32
canvas as a low-resolution render will produce something that is technically
correct and unmistakably wrong.

## The loop

Inspect → decide → draw in one batch → look → fix → validate.

Skipping "look" is the single most common failure. You cannot tell from a tool
result whether a sprite reads; you have to see it. `look` op `preview` shows you
what a human sees; op `ascii` shows you exactly which pixel is where.

## Resolution is a budget, not a limitation

At 16×16 a character gets roughly 3 pixels of head, 5 of torso and 4 of legs.
There is no room for a nose. Decide what the sprite must communicate at a
glance — a class, a threat, a direction — and spend the pixels there.

Common sizes and what fits:

| Size | Fits |
|------|------|
| 8×8 | An icon or an item. One idea. |
| 16×16 | A readable character with 2–3 colours per material. |
| 32×32 | Facial suggestion, distinct armour pieces, believable weapon. |
| 48×48+ | Real detail; now the risk is noise, not scarcity. |

## Constraints beat cleverness

Pick and write down, before drawing: canvas size, palette, light direction,
outline style, and whether the sprite is side-on, top-down or 3⁄4. Every later
decision either follows from those or is a mistake.

## What makes generated pixel art look generated

In rough order of how quickly a person spots it:

1. **Too many colours.** Ninety near-identical browns instead of a four-step
   ramp. Fix: a palette, and `paletteLock` left on.
2. **Flat luminance shading.** Shadow = the same hue, darker. Real shading
   shifts hue (see `rules://02-shading-and-light`).
3. **Anti-aliased or semi-transparent pixels.** Usually from a resize or a soft
   brush. At 1× they read as blur, not smoothness.
4. **Noise.** Isolated pixels with no neighbour, "detail" that is just dirt.
5. **Mushy silhouette.** The shape does not read as anything when filled black.
6. **Mechanical timing.** Every animation frame the same duration.

`validate` checks 1, 3, 4 and 6 mechanically. The rest you have to look at.

## Never silently change what the user did not ask about

Do not resize their canvas, re-index their colour mode, flatten their layers or
overwrite their file unless they asked. When a task seems to require one of
those, say so and ask.
