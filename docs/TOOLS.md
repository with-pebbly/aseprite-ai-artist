# Tools

Eighteen tools, grouped by noun with an `op` enum for the verbs. See
[ADR-0003](adr/0003-compact-tool-surface.md) for why.

Every tool returns `structuredContent` validated against an `outputSchema`.
Errors come back as tool results — never as protocol errors — because the model
has to see them to recover.

## Session

| Tool | Ops | Notes |
|------|-----|-------|
| `preflight` | — | Connection, capabilities, active sprite, and a one-line directive. **Call this first.** Always answers, never fails. |
| `sprite_info` | — | Full document state: dimensions, colour mode, palette, layers with nesting, frames with durations, tags, slices, selection. |
| `sprite_manage` | `list` `new` `open` `activate` `save` `save_as` `close` `resize_canvas` `set_properties` | `close` refuses on unsaved changes unless `force`. |

## Looking

| Tool | Ops | Notes |
|------|-----|-------|
| `look` | `preview` `ascii` `filmstrip` `diff` | The see-your-work tool. |
| `read_pixels` | — | Structured pixel data: distinct colours plus a row-major index grid. |

- **`preview`** — nearest-neighbour upscale to a ~1024px long edge (bounded so
  the output never exceeds ~2048px). For judging the overall read.
- **`ascii`** — exact text grid, one glyph per pixel, with coordinate rulers and
  a colour legend. For verifying precise positions, and for clients with no
  vision. Capped at 64×64 cells and 71 distinct colours; above either it refuses
  rather than let glyphs collide.
- **`filmstrip`** — every frame in one image. A vision model reads only the
  first frame of a GIF, so this is the only way to review animation.
- **`diff`** — pixel-level text diff between two frames. `.` unchanged,
  `-` erased, glyph = the new colour.

## Drawing

| Tool | Ops / kinds | Notes |
|------|-------------|-------|
| `draw` | `pixels` `line` `polyline` `rect` `ellipse` `fill` `replace` `dither` `gradient` `clear` `blit` | Batch. One transaction, one undo step. |
| `select` | `get` `none` `all` `rect` `ellipse` `color` `invert` `grow` `shrink` | Scopes `draw`, `transform` and `recolor`. |
| `transform` | `translate` `flip` `rotate` `scale` `outline` `crop_to_content` | Acts on ONE cel; there is no scope parameter. Non-90° rotation needs `allowLossy`. |
| `recolor` | `shade` `snap` `replace` `hue_shift` `desaturate` | Operates on distinct colours, not pixels; one pass, one undo step. |

`draw` and `recolor` snap colours to the sprite's palette by CIELAB ΔE unless
`paletteLock` is turned off, and report every colour they moved with its
distance. A large ΔE means the palette lacks that colour — say so rather than
forcing it.

## Structure

| Tool | Ops | Notes |
|------|-----|-------|
| `layer` | `list` `create` `rename` `delete` `reorder` `set` `group` `ungroup` `merge` `duplicate` `activate` | Accepts a `batch` array. |
| `frame` | `list` `add` `duplicate` `delete` `set_duration` `activate` `reorder` | `durations` sets a whole cycle's timing at once. |
| `tag` | `list` `create` `update` `delete` | Untagged animation frames are unusable by an engine. |
| `cel` | `list` `create` `clear` `delete` `move` `copy` `link` `unlink` `set` | `move` shifts a limb without redrawing it. |

## Colour and quality

| Tool | Ops | Notes |
|------|-----|-------|
| `palette` | `get` `set` `preset` `load` `ramp` `analyze` | `ramp` builds hue-shifted ramps; `analyze` finds near-duplicates and off-palette art. |
| `validate` | — | Lints palette, strays, outlines, banding, anti-aliasing, layers, animation and export readiness. Findings carry coordinates. |

## Assets

| Tool | Ops | Notes |
|------|-----|-------|
| `reference` | `import` `sample_palette` `list` `remove` | Imports on a locked, semi-transparent layer. |
| `export` | `png` `gif` `spritesheet` `frames` `aseprite` | `spritesheet` writes a JSON atlas beside the PNG. |
| `tileset` | `list` `create_layer` `get` `stamp` `pack` `export` | Needs the `tileset` feature. `pack` turns a painted mockup into a tileset plus a reconstructing tilemap; `export` writes Tiled (`.tsj` + `.tmj`), Godot 4 (`.tres`) or JSON, with the packed PNG. |

## Escape hatch

`run_lua` executes Lua inside Aseprite. **Off by default** — it is arbitrary
code execution in the application holding the user's unsaved work. Enable with
`--allowLua` or `ASEPRITE_AI_ALLOW_LUA=1`.

## Resources and prompts

| URI | What |
|-----|------|
| `rules://index` | The pixel-art rulebook contents |
| `rules://{name}` | One chapter, e.g. `rules://02-shading-and-light` |
| `skill://{name}` | One workflow, e.g. `skill://pixel-animate` |
| `knowledge://palettes` | Bundled palette presets with notes |

Every skill is also registered as an MCP **prompt**, so clients that render
prompts get them as commands.
