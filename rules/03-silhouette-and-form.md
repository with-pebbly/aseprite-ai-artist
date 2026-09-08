# Silhouette and form

## The silhouette test

Fill the sprite with a single flat colour. Can you still tell what it is? If not,
no amount of shading will save it.

This is the highest-leverage check in pixel art and it takes one call:
`look` op `preview` after a `recolor` op `replace` on a copy, or just squint at
the preview. Do it before you shade, not after.

Silhouettes fail because of:

- **Symmetry.** A perfectly symmetrical pose reads as a statue. Break it: one
  arm forward, weapon on one side, head turned.
- **Tangents.** An arm whose outline touches the torso outline fuses into one
  blob. Leave a gap, or overlap clearly.
- **Uniform limb width.** Everything the same thickness reads as a stick figure.

## Proportions

Game characters are usually stylised shorter than life. Common ratios, measured
in head-heights:

| Style | Heads tall | Reads as |
|-------|-----------|----------|
| 2 | Chibi / cute | Toy, mascot |
| 3–4 | Classic JRPG / action | The default; safe |
| 5–6 | Realistic-ish | Needs 48px+ to work |

At 16×16 you are at 2–3 heads whether you planned it or not. Plan it.

## The 3⁄4 view

Most top-down and isometric games want 3⁄4: the character faces the camera but
is seen slightly from above. In practice:

- The head shows the face **and** a little of the top of the skull.
- The shoulders are wider than a pure front view suggests.
- Feet are visible as separate shapes, not a single base.
- The far-side limb is partly hidden by the torso — that is what sells depth.

## Direction sets

A 4-direction set is down / up / left / right; 8 adds the diagonals. Rules:

- **Left and right are mirrors** — draw one, use `transform` op `flip` on a
  copied layer. Mirror asymmetric details (a scar, a shoulder pad) back by hand
  if the character has any, or accept the flip and say so.
- **Up** shows the back of the head and no face. This is the frame agents most
  often get wrong by drawing a face on the back of a head.
- Keep the **same pixel height and centre of mass** across all directions, or
  the character appears to bob when the player turns.

## Volume consistency

Across an animation, a limb must stay the same number of pixels thick unless it
is foreshortened on purpose. Volume drift — an arm that quietly gains two pixels
by frame four — is very visible in motion and invisible frame by frame. Review
with `look` op `filmstrip`, which is exactly what it is for.
