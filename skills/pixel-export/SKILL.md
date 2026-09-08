---
name: pixel-export
title: Export game-ready assets
description: Produce the files an engine actually consumes — spritesheets with atlases, GIFs, scaled PNGs — with the tags and layout the target needs. Use when work is finished and needs to leave Aseprite.
---

# Export game-ready assets

## Ask what consumes it

The target decides the format, and guessing produces files someone has to
re-export. If you do not know, ask — it is one question.

| Target | Wants |
|--------|-------|
| Unity | Spritesheet PNG + JSON atlas, `byTag` split |
| Godot | Spritesheet PNG, or `.aseprite` via an importer plugin |
| Web / canvas | Spritesheet PNG + JSON |
| Preview for a human | GIF, or a scaled PNG |
| Print / social | PNG at 4–8× |

## Before exporting

Run `pixel-review`. Exporting broken art just distributes it.

Then check specifically:

- **Tags exist and are named the way the engine expects** — `idle`, `walk`,
  `attack`. `validate` errors on untagged multi-frame sprites.
- **The reference layer is deleted or hidden**, and so is the sketch layer.
- **Frame durations are set.** GIF and most engines read them from the file.

## Exporting

**Spritesheet with atlas** — what an engine usually wants:

```
export op="spritesheet" path="…/knight.png" sheetType="packed" byTag=true padding=1
```

`padding` prevents texture bleed at non-integer zoom, which shows up as a thin
line of the neighbouring frame along a sprite's edge. Use 1 unless the engine
says otherwise.

The JSON atlas is written beside the PNG and carries per-frame rectangles and
per-tag ranges.

**Animation preview for a human:**

```
export op="gif" path="…/walk.gif"
```

**Scaled PNG** — for a store page or a README:

```
export op="png" path="…/knight@8x.png" scale=8
```

Integer scale only. Nearest-neighbour. Any other kind of resize destroys the
thing you made.

## Save the source

Exporting does not save the working document.

```
sprite_manage op="save"
```

The `.aseprite` file is the asset. The PNG is a build artifact.

## Report

List the files you wrote, their dimensions, the frame count and the tags. That
is what the person wiring them into the engine needs.

## Related

`rules://07-review-checklist`, `rules://05-animation`.
