---
name: pixel-draw
title: Draw a sprite
description: Draw a sprite from silhouette to finished pixels, in the order that catches mistakes while they are still cheap — block in, check the silhouette, shade, outline, verify. Use for the main body of any drawing task.
---

# Draw a sprite

The order matters more than the technique. Detail added before the form is right
just makes the wrongness harder to see and more expensive to fix.

## Procedure

### 1. Look before you draw

`preflight`, then `sprite_info`. You need the real layer names, frame count and
palette. Do not assume them — a wrong layer name means drawing into the user's
finished art.

### 2. Block in the silhouette

One flat colour, no detail. Target the `base` layer. Everything in one `draw`
call:

```
draw layer="base" label="block in knight" ops=[
  { kind:"ellipse", rect:{x:12,y:4,width:8,height:8}, color:"#5f574f", fill:"#5f574f" },
  { kind:"rect",    rect:{x:11,y:12,width:10,height:10}, color:"#5f574f", fill:"#5f574f" },
  …
]
```

Batch aggressively. One call is one undo step for the user; forty calls are
forty. See `rules://03-silhouette-and-form`.

### 3. Check the silhouette immediately

```
look op="preview"
```

Ask yourself the only question that matters here: **is it recognisable as one
flat shape?** If not, fix it now. Shading a bad silhouette is wasted work.

Watch for: symmetry that reads as a statue, tangents where an arm fuses into the
torso, limbs all the same thickness.

### 4. Separate the materials

Replace regions of the blockout with each material's base colour — skin, metal,
leather, cloth. Still flat. Still one `draw` call.

### 5. Shade

See `pixel-shade`. One shadow step, look, one light step, look. Stop there
unless the sprite is 32px+ and genuinely needs more.

### 6. Outline

Pick one style from `rules://04-outlines-and-edges` and apply it consistently.
Selective outlining — outside only — is usually right. `transform` op `outline`
does the mechanical part; hand-place where you want it broken.

### 7. Verify precisely

```
look op="ascii"
```

The text grid is where you catch the pixel one row too low and the line run of
3 in a sequence of 2s. A preview cannot show you those.

### 8. Validate and report

```
validate
```

Fix every error. Report warnings you chose not to fix, with the reason.

## Batching rules

- Ops run in array order, so paint fills before outlines and outlines before
  highlights.
- Leave `paletteLock` on. When the result says a colour moved with ΔE > 12, the
  palette has no colour for what you asked — say so rather than turning the lock
  off.
- Use `label` to describe the intent; it becomes the user's undo entry.

## Related

`rules://00-core-principles`, `rules://02-shading-and-light`,
`rules://03-silhouette-and-form`, `rules://04-outlines-and-edges`.
