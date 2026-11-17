---
name: draw
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

If `aseprite:concept` produced a PixelSpec, it is the plan: its landmarks and
bounding boxes are where the shapes go, its palette mapping is which colour
each mass gets, its deviations are what you leave out. When a reference layer
exists (`reference op="list"`), you are drawing over it — the steps below are
the same, and step 3 gains a comparison.

Then read the subject rules for what you are drawing — the table in
`skill://studio` under *Subject rules* names them. A hand, a face, a horse,
an isometric crate or a waterfall each has its own file with size budgets
and ` ```grid ` templates. A template is a starting point you transcribe with
`draw` op `grid`, mapping each legend role onto the sprite's palette; adapt
it to the pose rather than inventing the shape from nothing.

### 2. Block in the silhouette

One flat colour, no detail. Target the `base` layer. Everything in one `draw`
call.

For anything up to about 32×32, write it as a **grid**: one character per
pixel, so you see the whole silhouette while you write it instead of finding
out afterwards what a stack of ellipses and rects added up to.

```
draw layer="base" label="block in slime" ops=[
  { kind:"grid", x:8, y:10, legend:{ "O":"#5f574f" }, rows:[
    "....OOOO....",
    "..OOOOOOOO..",
    ".OOOOOOOOOO.",
    "OOOOOOOOOOOO",
    "OOOOOOOOOOOO",
    ".OOOOOOOOOO." ] }
]
```

Every row must be the same width, `.` is transparent, and transparent cells
erase what is under them (`transparent:"skip"` to stamp over existing art
instead). Bigger sprites: one grid per body part or per layer, each at its own
`x`/`y` — long rows of identical characters are where a model miscounts, and a
ragged row is refused with its row number rather than silently shifted.

If you build the art with a script of your own (handy for big or repeated
work: many frames, a growth sequence, a tile set), let the script write it to
a file and hand the file over instead of pasting its output into the call:
grid `file:"canopy.txt"` with the same rows and your legend, or
`{ kind:"image", path:"frame07.png" }` for a 1× PNG (alpha 0 or 255 only;
`crop` takes one cell of a sheet). Same palette lock, same erase/skip rule,
and nothing gets miscopied. One `draw` call still targets one layer and frame,
so name `layer` and `frame` on every call.

Shapes are still the right tool for big regular forms — a sky gradient, a
floor, a 40-pixel circle:

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

With a reference, `preview` blends the half-transparent reference into the
art — use `look op="compare"` instead: reference left, art right. Name the
three to five largest mismatches (silhouette, proportion, pose, where the
colour masses sit), fix only those in one `draw` call, compare again. Stop when
what is left is a deviation the PixelSpec lists. This loop repeats after
materials (step 4) and after shading (step 5): the reference is a check on
every stage, not only the first.

### 4. Separate the materials

Replace regions of the blockout with each material's base colour — skin, metal,
leather, cloth. Still flat. Still one `draw` call.

### 5. Shade

See `aseprite:shade`. One shadow step, look, one light step, look. Stop there
unless the sprite is 32px+ and genuinely needs more.

### 6. Outline

Pick one style from `rules://04-outlines-and-edges` and apply it consistently.
Selective outlining — outside only — is usually right. `transform` op `outline`
does the mechanical part: `side="outside"` grows the shape by a pixel,
`side="inside"` recolours its edge and keeps the size; `diagonals=true` fills
the corner pixels for square corners, off leaves them cut and softer.
Hand-place where you want it broken.

### 6b. Text, if the art has words

`draw` op kind `text` lays out a string from a bitmap font and draws it in the
same batch as everything else. Pass `measureOnly: true` with only `text` ops
first to get the ink bounds back without touching the sprite — that is how
you centre a label or size a panel around it before committing to a position.
See [TOOLS.md](../../docs/TOOLS.md#font-format) for the font format.

### 7. Verify precisely

```
look op="ascii"
```

The text grid is where you catch the pixel one row too low and the line run of
3 in a sequence of 2s. A preview cannot show you those.

To fix what it shows, edit the grid itself: `look op="ascii" layer="base"
rulers=false region=…` returns bare rows plus `origin`; change the cells that
are wrong and send the rows back as `draw` kind `grid` at that origin, with the
legend `look` gave you. Only the region you send is touched. A glyph is a
palette index and means the same colour in every region you read.

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
`rules://03-silhouette-and-form`, `rules://04-outlines-and-edges`,
`rules://10-lines-and-curves`, `rules://11-clusters-and-noise`, and the subject
files listed in `skill://studio` under *Subject rules*.
