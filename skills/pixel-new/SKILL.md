---
name: pixel-new
title: Create a sprite document
description: Create a new Aseprite document with the right canvas size, colour mode, palette and layer structure, so later work does not have to fight the setup. Use when starting fresh rather than editing an existing sprite.
---

# Create a sprite document

Set-up mistakes are expensive to undo: a canvas that is the wrong size means
redrawing, and a palette chosen after the art means repainting. Get these four
things right and the rest of the work is drawing.

## Procedure

1. **`preflight`.** Stop if not ready.

2. **Create the canvas.**

   ```
   sprite_manage op="new" width=32 height=32 colorMode="rgb"
   ```

   - Use **RGB** unless the user wants hard palette enforcement at the file
     level. Indexed mode makes the palette a hard constraint Aseprite itself
     enforces — good for a strict retro target, awkward for iteration.
   - Size to the game's grid if there is one: a 16×16 tile game wants character
     sprites that are a multiple of 16 in at least one dimension.
   - Leave headroom. A 32×32 canvas for a 28px-tall character gives room for a
     weapon raise or a jump squash without a later canvas resize.

3. **Set the palette before drawing.**

   ```
   palette op="preset" preset="pico8" replace=true
   ```

   Or build one: `palette op="ramp" base="#c04030" steps=5` per material. See
   `rules://01-palette-and-color`.

4. **Build the layer structure** in one batch, so it is one undo step:

   ```
   layer batch=[
     {op:"create", name:"sketch"},
     {op:"create", name:"base"},
     {op:"create", name:"shading"},
     {op:"create", name:"outline"},
   ]
   ```

   For anything that will be animated, build the full character rig instead —
   see `pixel-rig`. Splitting baked pixels apart later is real work.

5. **Save immediately**, so the user has a file and undo has an anchor:

   ```
   sprite_manage op="save_as" path="…/knight.aseprite"
   ```

   Ask where, or put it beside whatever project the user is working in.

6. **Confirm** what you made in one line: size, mode, palette, layers.

## Then

`pixel-draw` to block in the art.

## Related

`rules://01-palette-and-color`, `rules://06-layers-and-rigging`.
