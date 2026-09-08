# hero2 generator

Procedural model behind `docs/media/hero2.aseprite` (the robot painting a
landscape at an easel, wiping it and starting over). Every layer of every
frame is a 192×96 grid of palette indices; nothing in the sprite was drawn by
hand, so tweaks (timing, palette, a different painting, a different wipe
pattern) are made here and re-pushed, never edited in the file.

## Files

- `scene.py` — canvas size, palette, grid helpers, local PNG writer, and
  `emit_ops()` which turns a grid into run-length `rect` / `pixels` ops for the
  MCP `draw` tool.
- `build.py` — the scene: backdrop, easel, robot, IK arm, the painting passes
  (frames 1–33), the hold (34–37), the erase phase (38–52) and the reset
  (53–54). `build_frame(f)` returns the eight layers of frame `f`.
- `gen_push.py` — writes `push/NN_Layer.json`, the minimal op list per layer
  and frame for frames 37–54, assuming those frames exist as duplicates of
  frame 36 in the live document.
- `pngio.py`, `compare.py` — a Pillow-free PNG reader and a frame-by-frame
  diff of the model against Aseprite's own CLI export.

## Regenerate and check

```sh
cd docs/media/src/hero2
python3 build.py            # renders out/fNN.png (scale 5), out/strip.png, out/seam.png
python3 build.py --ops      # additionally writes ops/Layer_NN.json for every frame (large)

# verify the model still matches the file on disk, frame by frame
mkdir -p cur
/Applications/Aseprite.app/Contents/MacOS/aseprite -b ../../hero2.aseprite --save-as "cur/f{frame1}.png"
python3 compare.py cur 54
```

## Push into the live document

The sprite is edited through the aseprite-ai-artist MCP bridge, never by
writing the file. The workflow that built frames 37–54:

1. `frame duplicate` frame 36 with `count` = 18 (static layers come for free).
2. `python3 gen_push.py`, then one `draw` call per `push/*.json` file
   (`layer` and `frame` from the file name). Each list starts with a `clear`
   op so the duplicated cel is replaced, followed by `blit` from a frame that
   already holds the wanted head / glow / arm, or fresh ops.
3. `frame set_duration` with `build.DUR`, tags from `build.TAGS`,
   `sprite_manage save`.

Export from the shell (the `export` tool pops a modal dialog on extension 0.1.3):

```sh
/Applications/Aseprite.app/Contents/MacOS/aseprite -b docs/media/hero2.aseprite --scale 4 --save-as docs/media/hero2.gif
/Applications/Aseprite.app/Contents/MacOS/aseprite -b docs/media/hero2.aseprite --frame-range 36,36 --scale 4 --save-as docs/media/hero2.png
```

## Scene facts worth knowing

- Canvas interior is x 92..131, y 33..64 (`CANVAS`); the wooden frame is 2 px
  around it. Shoulder pivot (72, 58); upper arm 18 px, forearm telescopes.
- Painting mode: `arm(tip, colour)` puts the hand 10 px behind the brush tip
  along `BRUSH = (8, -6)`. Erase mode: `arm_draw(hand, bvec, colour, pad,
  smudge)` — the brush swings up to `(-3, -10)` and an 8×8 felt pad slides out
  of the fist (`PAD_W`, `PAD_TOP`); `PAD_AT` is the pad's canvas footprint per
  frame and `cleared_rects()` accumulates the swept bands.
- Frame count is 54 = 6 × 9 so the dust motes (period 9) are continuous across
  the loop seam; the antenna blink uses an explicit beat list in the erase
  phase (`ERASE_ANTENNA`) for the same reason.
- Frame 54 is the frame-1 pose with a blank canvas; the only differences to
  frame 1 are the first dab, the antenna and one step of dust.
