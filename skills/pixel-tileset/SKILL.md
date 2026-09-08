---
name: pixel-tileset
title: Build a tileset
description: Design seamless tiles and autotile sets, or deduplicate a hand-painted mockup into a reusable tileset, then export for Tiled or Godot. Use for level art, terrain and anything that repeats.
---

# Build a tileset

Requires an extension advertising the `tileset` feature — check `preflight`
first. Older builds answer `unsupported_command` loudly rather than doing
nothing.

## Decide the grid before anything else

The tile size is the one decision everything else depends on, and it belongs to
the game, not to the art. Ask if you do not know it. 16×16 and 32×32 are the
common answers.

## Seamless tiles

A tile is seamless when its right edge continues into its own left edge, and its
bottom into its own top.

Method that works:

1. Draw the tile's interior first, ignoring edges.
2. Draw the edge pattern on one side.
3. `look op="ascii"` the first and last columns and make them continue into each
   other. This is exact work; do it in the text grid, not by eye.
4. Same for top and bottom rows.
5. Stamp the tile in a 3×3 block and `look op="preview"`. Seams show up
   immediately when tiled; they are invisible in isolation.

**Avoid a repeating feature.** A distinctive rock in the middle of a grass tile
becomes a visible grid the moment it repeats. Keep repeating tiles low-contrast
and put the distinctive elements in occasional variant tiles.

## Autotiling

A blob-47 set covers every combination of neighbours for a 4-connected terrain.
It is 47 tiles, and hand-authoring them in the right order is where this goes
wrong — build the terrain body first, then the edge and corner cases, then
export with `layout="blob47"` so the exporter writes the wangset.

## From a painted mockup

Painting a level by hand and extracting tiles from it produces better-looking
tilesets than authoring tiles in isolation, because you see the whole picture
while drawing.

1. Paint the mockup on a normal layer, on a canvas that is a whole number of
   tiles in each direction.
2. `tileset op="pack"` deduplicates it into a tileset plus a tilemap that
   reconstructs the original.
3. Check the tile count. A mockup that yields 200 tiles was painted without
   regard to the grid; redraw with the grid visible.

## Export

```
tileset op="export" format="tiled" layout="blob47" path="…/terrain.tsj"
```

Writes the engine file plus the packed PNG beside it. Godot uses `format:
"godot"`. LDtk reads `.aseprite` directly — just save the document.

## Related

`rules://04-outlines-and-edges` for edge consistency.
