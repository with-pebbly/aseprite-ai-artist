# Tools

Eighteen tools, grouped by noun with an `op` enum for the verbs. See
[ADR-0003](adr/0003-compact-tool-surface.md) for why.

Every tool returns `structuredContent` validated against an `outputSchema`.
Errors come back as tool results — never as protocol errors — because the model
has to see them to recover.

## Session

| Tool | Ops | Notes |
|------|-----|-------|
| `preflight` | — | Connection, capabilities, active sprite, `mode` (`live` or `headless`) and a one-line directive. **Call this first.** Always answers, never fails. `mode: "headless"\|"live"` switches the session's Aseprite (reported as `switched`); each side keeps its documents. In headless mode it starts the batch Aseprite and reports why when it cannot. |
| `sprite_info` | — | Full document state: dimensions, colour mode, palette, layers with nesting, frames with durations, tags, slices (with 9-patch `center`/`pivot` when set), selection. |
| `sprite_manage` | `list` `new` `open` `activate` `save` `save_as` `close` `resize_canvas` `set_properties` `slice_create` `slice_update` `slice_delete` | `close` refuses on unsaved changes unless `force`. Slices name a rectangle for an engine to read back: `bounds` always, plus an optional 9-patch `center` and a hotspot `pivot`; these land in the spritesheet atlas on export. |

## Looking

| Tool | Ops | Notes |
|------|-----|-------|
| `look` | `preview` `ascii` `filmstrip` `diff` `onion` `compare` | The see-your-work tool. |
| `read_pixels` | — | Structured pixel data: distinct colours plus a row-major index grid. |

- **`preview`** — nearest-neighbour upscale to a ~1024px long edge (bounded so
  the output never exceeds ~2048px). For judging the overall read.
- **`ascii`** — exact text grid, one glyph per pixel, with coordinate rulers and
  a colour legend. For verifying precise positions, and for clients with no
  vision. Reads up to the whole canvas; pass a `region` to crop. Glyph *n* is
  palette entry *n* on every read, so regions of one sprite share a legend;
  colours outside the palette are listed in `offPalette` and are the only
  glyphs that can change between reads. With rulers (the default) the grid comes
  back once, as ruled `text`; `rulers: false` returns it once as bare `gridRows`
  instead, which — with `legend` and `origin` — `draw` kind `grid` takes back
  unchanged: read with `rulers: false`, edit the rows, write.
- **`filmstrip`** — every frame in one image. A vision model reads only the
  first frame of a GIF, so this is the only way to review animation. `layer`
  limits it to one layer.
- **`diff`** — pixel-level text diff between two frames. `.` unchanged,
  `-` erased, glyph = the new colour. Reports `changedBounds` (tight bounding
  box of every changed pixel, null when nothing changed) and `percentChanged`.
- **`onion`** — the target frame at full opacity over ghosted neighbouring
  frames (`framesBefore`/`framesAfter`, default 1 each; `ghostOpacity`
  0-255, default 90), oldest-first. For checking in-betweens and spacing while
  animating without stepping through frames one at a time. Over an opaque
  background the target hides the ghosts — pass `layer` to show only the part
  that moves. Reports
  `framesUsed`, the 1-based frame numbers composited.
- **`compare`** — the reference layer (`reference`, default `"reference"`) at
  full opacity on the left, the art with every reference layer removed on the
  right, same frame and scale, one grey pixel between. For the loop that makes a
  reference pay off: name the few largest mismatches, fix only those, compare
  again. Rendered from a scratch copy, so no layer in the document is hidden
  or shown to produce it.

## Drawing

| Tool | Ops / kinds | Notes |
|------|-------------|-------|
| `draw` | `pixels` `line` `polyline` `rect` `ellipse` `fill` `replace` `dither` `gradient` `clear` `blit` `text` `grid` | Batch. One transaction, one undo step. |
| `select` | `get` `none` `all` `rect` `ellipse` `color` `invert` `grow` `shrink` | Scopes `draw`, `transform` and `recolor`. |
| `transform` | `translate` `flip` `rotate` `scale` `outline` `crop_to_content` | Acts on ONE cel; there is no scope parameter. Non-90° rotation needs `allowLossy`. `outline`'s `side` (`outside` default, `inside`) picks which pixels get painted; `diagonals` (default `false`) switches 4- to 8-neighbour. |
| `recolor` | `shade` `snap` `replace` `hue_shift` `desaturate` | Operates on distinct colours, not pixels; one pass, one undo step. |

`draw` op kind `text` lays out a string from a bitmap font and expands it to
plain pixels before it reaches Aseprite: `text`, `x`, `y`, `color`, `font`
(name in `knowledge/fonts/`, default `pixel5x7`), `anchor` (one of
`top_left` `top` `top_right` `left` `center` `right` `bottom_left` `bottom`
`bottom_right` `baseline_left` `baseline` `baseline_right`, resolved against
the glyph ink box — outline and shadow never shift it), `letterSpacing`,
`lineSpacing`, `bold` (0-3, grid-cell passes grown rightward), `outlineColor`,
`outlineDiagonals` (default `true`), `shadowColor`, `shadowOffset`
(default `{x:1,y:1}`), `scale` (1-8). Multiline via `\n`. Pass top-level
`measureOnly: true` with only `text` ops to get each one's ink bounds
(`textBounds`, null when there's no ink) without touching the sprite — size a
panel or centre a label first. See
[ADR-0005](adr/0005-bitmap-text.md) and the font format below.

`draw` op kind `grid` is a picture written as text — the writable form of
`look op="ascii"`: `x`, `y` (top-left, default 0), `legend` (one character →
`#rrggbb` or `#rrggbbaa`, or `null` for transparent; `.` is transparent unless redefined),
`rows` (top to bottom, one character per pixel, every row the same width, at
most 256×256), `transparent` (`erase`, the default, clears transparent cells so
the rectangle ends up exactly as written; `skip` leaves what is underneath).
It is compiled on the server into `clear` rectangles and one `pixels` op per
colour: the palette lock snaps each legend colour once, and `selectionOnly`
clips both the painted and the erased cells. A
ragged row or a character missing from the legend is refused with its row and
column, never padded. See [ADR-0010](adr/0010-pixel-grid.md).

### Font format

A font is `knowledge/fonts/<name>.json`: `name`, `license`, `cellWidth`,
`cellHeight`, `baseline` (rows above the baseline, inclusive), `spaceWidth`,
`glyphs` (a map from character to rows of `#`/`.`, top to bottom — row length
is the glyph's width), and an optional `advance` map overriding a glyph's
default width. One font ships: `pixel5x7`, hand-drawn ASCII 32–126, CC0.

## Structure

| Tool | Ops | Notes |
|------|-----|-------|
| `layer` | `list` `create` `rename` `delete` `reorder` `set` `group` `ungroup` `merge` `duplicate` `activate` | Accepts a `batch` array. `duplicate` takes an optional `toSprite` to copy a layer's cels into another OPEN sprite by frame index; frames past the target's frame count are dropped and reported. |
| `frame` | `list` `add` `duplicate` `delete` `set_duration` `activate` `reorder` | `durations` sets a whole cycle's timing at once. |
| `tag` | `list` `create` `update` `delete` | Untagged animation frames are unusable by an engine. |
| `cel` | `list` `create` `clear` `delete` `move` `copy` `link` `unlink` `set` `tween` `oscillate` | `move` shifts a limb without redrawing it. `tween` interpolates position or opacity between two frames with an easing curve (`linear` `ease_in` `ease_out` `ease_in_out` `smoothstep`); `oscillate` adds a sinusoidal position offset (`amplitudeX`/`amplitudeY`, `period`, `phase`) over a frame range. Both fill in any missing in-between cels from the start cel, in one transaction. |

Every `layer` parameter takes a plain name or a `group/child` path. A name
that matches more than one layer — the same name inside two groups, or a
path that resolves more than one way — fails with `invalid_args` naming every
match (`Layer name 'X' is ambiguous: A/X, B/X. Pass a group path.`) instead of
silently picking one.

## Colour and quality

| Tool | Ops | Notes |
|------|-----|-------|
| `palette` | `get` `set` `preset` `load` `ramp` `analyze` `extract` | `ramp` builds hue-shifted ramps; `analyze` finds near-duplicates and off-palette art; `extract` replaces the palette with one quantized from the art itself. |
| `validate` | — | Lints palette, strays, outlines, banding, anti-aliasing, layers, animation and export readiness. Findings carry coordinates. |

`extract` (op on `palette`) replaces the palette with one quantized from the
art itself (RGB sprites only, `maxColors` 2-256, default 16) — for deriving a
curated palette from a reference image imported at full colour.

`validate`'s `expect` runs independently of `checks`, whenever given: a
`layerFrames` map of per-layer `[from,to]` frame ranges flags art outside them
or a missing cel inside one, and `mustNotOverlap` layer-name pairs flag any
frame where both layers' opaque pixels intersect.

## Assets

| Tool | Ops | Notes |
|------|-----|-------|
| `reference` | `import` `sample_palette` `list` `remove` | Imports on a locked, semi-transparent layer. `region` crops one panel of the source (source pixels, also for `sample_palette`); `grid` `{columns, rows, count?, gap?}` cuts a storyboard into panels and puts panel i on frame `frame`+i-1 of one layer — the sprite needs the frames first. |
| `export` | `png` `gif` `spritesheet` `frames` `aseprite` | `spritesheet` writes a JSON atlas beside the PNG. `layers` (png, gif, frames, spritesheet) exports only those layers; `tags` (gif, frames, spritesheet) only the frames they cover. `aseprite` refuses both, and an unknown name is refused rather than exported as everything. Named layers export visible even if hidden; with `tags`, `frames` filenames count from the first kept frame. |
| `tileset` | `list` `create_layer` `get` `stamp` `pack` `export` | Needs the `tileset` feature. `pack` turns a painted mockup into a tileset plus a reconstructing tilemap; `export` writes Tiled (`.tsj` + `.tmj`), Godot 4 (`.tres`) or JSON, with the packed PNG. |

## Escape hatch

`run_lua` executes Lua inside Aseprite. **Off by default, and gated twice** — it
is arbitrary code execution in the application holding the user's unsaved work.
The server hides the tool unless `--allowLua` (or `ASEPRITE_AI_ALLOW_LUA=1` in
its environment) is set, and the extension itself refuses the call unless the
**Aseprite process** was started with `ASEPRITE_AI_ALLOW_LUA=1`. Headless
sessions need only the flag: the server passes the variable on.

## Resources and prompts

| URI | What |
|-----|------|
| `rules://index` | The pixel-art rulebook contents |
| `rules://{name}` | One chapter, e.g. `rules://02-shading-and-light` |
| `skill://{name}` | One workflow, e.g. `skill://animate` |
| `knowledge://palettes` | Bundled palette presets with notes |

Every skill is also registered as an MCP **prompt**, so clients that render
prompts get them as commands.
