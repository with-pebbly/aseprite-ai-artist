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
   tiles in each direction. `pack` refuses otherwise rather than silently
   losing a partial edge tile.
2. Pack it:
   ```
   tileset op="pack" layer="mockup" name="terrain" tileWidth=16 tileHeight=16
   ```
   You get a tileset plus a tilemap layer that reconstructs the mockup exactly.
   The mockup is **hidden, not deleted** — unhide it to compare if a tile looks
   wrong.
3. Read the result. `cellCount` against `tileCount` tells you how much the
   mockup actually reused. A 400-cell mockup that yields 300 tiles was painted
   without regard to the grid; the tool says so, and the fix is to redraw with
   the grid visible, not to accept it.
4. `tolerance` merges near-identical cells (per-channel difference, 0–255). It
   is off by default because a merge changes the art: the tilemap becomes an
   approximation of the mockup rather than a copy, and the result says how many
   cells that affected.

## Export

```
tileset op="export" layer="terrain" format="tiled" path="…/terrain.tsj"
```

Writes three files: the packed PNG, the `.tsj` tileset, and a `.tmj` map that
uses it — so the export opens in Tiled as a level, not just an image.

- `format="godot"` writes a Godot 4 `TileSet` resource (`.tres`).
- `format="json"` writes the tile grid plus the tilemap layout, for a custom
  engine. It states its own index convention in the file.
- LDtk needs no exporter — it reads `.aseprite` directly, so just save the
  document.

Aseprite reserves tile index 0 for the empty tile. The exporter drops it from
the atlas so engine indices line up, and index 0 becomes "no tile", which is
what every engine expects.

## Autotiling

```
tileset op="export" format="tiled" layout="blob47" path="…/terrain.tsj"
```

Adds a Tiled wangset for 4-connected autotiling. It assumes the 47 tiles are
authored in **canonical blob47 order** — the 47 distinct neighbour masks in
ascending order, after Aseprite's empty tile — and refuses if the set is
incomplete rather than writing a wangset that autotiles wrongly. If you are not
sure of the ordering, export `format="json"` first: it reports the
index-to-mask mapping so you can check a few tiles by eye.

## Related

`rules://04-outlines-and-edges` for edge consistency.
