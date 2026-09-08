---
name: pixel-rig
title: Rig a character for animation
description: Split a character onto named layers — head, torso, arms, legs — so it can be animated by moving cels instead of redrawing pixels. Use before animating anything, or when limbs are baked into one layer.
---

# Rig a character for animation

Pixels baked into a single layer cannot be animated without redrawing them. Rig
first; separating a finished sprite later is more work than building it split.

## The standard rig

Bottom to top, so nearer parts draw over farther ones:

```
arm-near     ← camera-side arm
leg-near
head
torso
arm-far      ← partly hidden by the torso; this is what sells depth
leg-far
shadow       ← ground contact, if the style has one
```

Add `weapon`, `cape`, `hair-front`, `hair-back` as the design needs. Keep names
stable — every later call refers to them by name.

## Building it fresh

One batch, one undo step:

```
layer batch=[
  {op:"create", name:"shadow"},
  {op:"create", name:"leg-far"},
  {op:"create", name:"arm-far"},
  {op:"create", name:"torso"},
  {op:"create", name:"head"},
  {op:"create", name:"leg-near"},
  {op:"create", name:"arm-near"},
]
```

Then draw each part on its own layer from the start.

## Splitting an existing sprite

When the art is already baked into one layer:

1. `sprite_info` to see what you have, and `look op="ascii"` to find exact part
   boundaries. Guessing at coordinates here is how limbs get clipped.
2. Create the rig layers (above).
3. For each part, in one `draw` call per target layer:
   ```
   draw layer="head" ops=[{ kind:"blit", from:{x:12,y:4,width:8,height:8}, to:{x:12,y:4} }]
   ```
   `blit` copies from the source layer; `skipTransparent` keeps the copy clean.
4. Clear the copied region from the original layer, or rename the original to
   `flat-original` and hide it. **Prefer hiding** — if a boundary was wrong you
   want the original still there.
5. `look op="preview"` with the original hidden. The sprite should look
   unchanged. If a limb lost pixels, the boundary was wrong.

## Overlap matters

A limb needs a pixel or two of overlap with the torso, or a gap appears the
moment it rotates. Copy generously and let the stacking order hide the excess.

## Then

`pixel-animate`.

## Related

`rules://06-layers-and-rigging`, `rules://03-silhouette-and-form`.
