# Shading and light

## Pick a light direction and never move it

One light source, stated up front — usually upper-left or upper-right. Every
surface in the sprite is lit from that direction, in every frame of every
animation. A sprite whose light drifts between frames looks like it is made of
different materials each frame.

## Hue-shift, always

The difference between pixel art and a brightness slider:

- **Shadows** rotate toward the ambient — in practice, **toward blue/purple** —
  and lose a little saturation.
- **Highlights** rotate **toward yellow/orange** and gain a little saturation.

A red `#c04030` shades to something like `#8a2f45` (cooler), not `#802b20`
(the same hue, darker). The second one is the tell.

`recolor` op `shade` applies this rule; `palette` op `ramp` builds ramps that
already obey it. Use them instead of picking darker hex values by hand.

## Order of work

1. **Block in** flat base colours per material. No shading at all yet.
2. **Check the silhouette** — see `rules://03-silhouette-and-form`.
3. **One shadow step**, on the side away from the light. Stop and look.
4. **One light step**, on the side facing it.
5. Only then consider a second shadow, a specular, or reflected light.

Most sprites are finished at step 4. Detail added before the form is right just
makes the wrongness harder to see.

## Dithering

Dithering buys you an intermediate value you do not have colours for, and it
adds texture. It is not free: at small sizes it reads as noise.

- Use it for large flat areas, skies, gradients on 32×32 and up.
- Avoid it on a 16×16 character; you do not have the pixels.
- Prefer ordered patterns (`bayer4`) over `noise`. Random dithering looks like
  dirt at low resolutions.
- Keep the two dithered colours adjacent in a ramp. Dithering between distant
  colours produces visible speckle.

`draw` op `dither` handles the pattern; you choose the two colours and the ratio.

## Anti-aliasing

Manual AA — placing one intermediate colour at a hard diagonal — is a legitimate
technique on larger sprites. It is **not** the same as alpha blending.

Never leave semi-transparent pixels in pixel art. They come from soft brushes and
non-integer resizes, and they make a sprite look blurry and impossible to palette
swap. `validate` flags them.
