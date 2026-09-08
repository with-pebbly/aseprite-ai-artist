# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[semver](https://semver.org/).

## [0.1.0] — 2026-09-08

First release. Includes every fix from the pre-release audit below.

### Fixed — 2026-09-08 multi-expert audit

Six reviewers plus two live Codex CLI runs; every item below was reproduced
before it was fixed and has a regression test that fails without the fix.

- **Closed polylines lost their closing edge.** The outline loop stopped one
  short of the wrap the fill loop already did, so a "closed" triangle shipped
  with one side missing and the call reported success.
- **Thick lines were silently clipped.** The bounding box ignored `thickness`,
  so the cel was grown to the endpoints only and the rest of the brush was
  dropped — a 7×7 stamp landing one pixel, reported as success.
- **Fuzzy tile packing merged unrelated tiles on indexed sprites.** The distance
  function read RGB channels out of palette indices. It now refuses non-RGB
  sprites instead of guessing.
- **`transform` op `rotate` with `angle: 0` reported a full-canvas change** for
  an operation that touched nothing, breaking idempotency checks.
- **`validate` never ran its `outline` or `banding` checks.** Both were in the
  schema and in the handler's own default set, and no branch read either — the
  tool answered "Clean." without running them. Both are now implemented.
- **`cel` op `list` always reported `linked: false`**, and `frame` op
  `duplicate` with `linkCels` never actually linked (it called a command that
  does not exist in Aseprite 1.3).
- **`draw` op `gradient` ignored `dither`**, and `diagonal` and `radial`
  silently rendered as `vertical`. All four directions and the dither flag now
  work.
- **`transform`'s `scope` parameter did nothing.** Removed rather than
  half-implemented; transforms act on one cel, and the docs now say so.
- **`tag`'s `repeat` was ignored.** The schema said `repeat` on input and
  output while Aseprite's property is `repeats`, so loop counts were silently
  dropped. Renamed to `repeats` on both sides.
- **`sprite_manage` op `new` returned an identifier that could not be used.** It
  answered `"untitled"` while the sprite was called `"Sprite"`, so feeding a
  tool's own output into the next call failed. Every result now carries a stable
  `id`, and two unsaved documents are no longer ambiguous.
- **Previews were capped far below a readable size.** The upscale factor was
  capped at 16, rendering a 16px sprite at 256px — the case where upscaling
  matters most. The bound is now on output size (~2048px), so small sprites
  reach the documented ~1024px.
- **`selectionOnly` silently widened to the whole cel** when nothing was
  selected. It now refuses.
- **Text grids collided past 71 colours**, quietly misreporting which colour was
  where in the tool used to verify edits. It now refuses.
- **Config writes were not atomic.** A partial write to `~/.claude.json` (100KB+
  of Claude Code's own state) would have broken the user's whole setup. Writes
  go through a temp file and a rename.
- **A dropped bridge left in-flight calls waiting out their 20s timeout**, which
  reads to an agent as "slow" rather than "disconnected". They now fail
  immediately, and a bridge that dies after being spawned can be respawned.
- **Non-`EADDRINUSE` bind failures were reported as "another bridge owns this
  port"**, sending users after a process that does not exist.
- **`run_lua` could leave Lua's global `print` hijacked** for the rest of the
  Aseprite session if the transaction threw.
- **The Claude Code plugin could not start on Windows.** Its MCP `command`
  pointed at a bash script, and Windows does not interpret `#!`. The launcher is
  now Node.
- **`package.json` claimed the 2026-07-28 spec**, contradicting ADR-0004's
  decision to target 2025-11-25. `engines.node` also promised 20.10 while the
  test script needs 22.6.

### Fixed — audit round two

The six reviewers' full reports arrived after the first round of fixes and
carried a further fourteen items, all closed here.

- **`snapToPalette` promised a transparency guard it did not have.** A fully
  transparent input now snaps to itself instead of to the nearest opaque colour,
  which would have painted over deliberate holes.
- **`refused` and `too_large` error codes were declared and never raised**, so
  every "you asked for something out of bounds" refusal arrived as a generic
  `aseprite_error` and an agent could not tell it apart from an internal
  failure. Both are now used at the real refusal sites.
- **The bridge had no frame-size or client cap** on an unauthenticated socket —
  `ws` defaults to 100 MiB per frame. Now 16 MiB and 64 clients.
- **The Codex TOML editor matched its block header anywhere in the file**,
  including inside a comment or a string. The match is now anchored to a line.
- **`layer`'s `batch` was the least-typed path in the surface** while being the
  documented way to build a rig: `z.record(z.unknown())` accepted an opacity of
  `"hello"` and Lua assigned it. It is now the same typed object as the
  single-op form.
- **The Lua reconnect state machine had no per-socket identity check**, so an
  event from a superseded socket could clobber the new connection's state. The
  TypeScript side already guarded the mirror-image race.
- **A rejected `close()`/`stop()` left a floating promise rejection** in the
  CLI's shutdown paths.
- **Four output schemas under-documented what Lua actually returns** —
  `palette` op `load`'s `path`, `sprite_manage` op `list`'s colour mode and
  counts, and the layer entries' `editable`/`isTilemap`/`cels`.
- **Lua test cleanup was not exception-safe.** One failing assertion left the
  active document pointing at a closed scratch sprite and cascaded into every
  later check — the failure this project already hit once. All sixteen scratch
  blocks now go through a helper that always closes and always restores.
- **The cross-language CIELAB claim was not actually enforced.** ADR-0001 and
  ARCHITECTURE.md both said the two ports are held to the same expectations;
  only the TypeScript side had numeric fixtures. The Lua side now pins the same
  white/black L\*, ΔE bounds, grey-snaps-to-grey case and hue-shift direction.
- **`export` op `frames` had no coverage at any level.** Verified it does write
  one file per frame (numbered from 0, now documented) and locked that in.
- **The e2e test used the real default ports**, so running it on a machine with
  a live Aseprite session could steal that session — the bridge accepts the last
  plugin to connect. Ports are now overridable, the risk is documented, and the
  test removes the files it writes.
- **`SECURITY.md` overstated the `allowLua` gate.** It gates the tool surface
  your agent sees, not the capability: the extension implements `lua.run`
  whenever installed and the bridge has no authentication. Now stated plainly,
  alongside the filesystem reach of every `path` argument.

### Added

- `SECURITY.md` — threat model, the localhost bridge's real exposure, what
  `install` touches, and the `run_lua` gate.

### Added — initial implementation

- **MCP server** (`serve`) speaking protocol `2025-11-25`, with 18 tools grouped
  by noun. Every tool declares an `outputSchema` and returns
  `structuredContent`. See [ADR-0003](docs/adr/0003-compact-tool-surface.md) and
  [ADR-0004](docs/adr/0004-protocol-version.md).
- **Standalone WebSocket bridge** (`bridge`), singleton by port ownership,
  outliving MCP server restarts and serving several agent windows at once. See
  [ADR-0002](docs/adr/0002-standalone-bridge.md).
- **Aseprite extension** (`extension/ai-artist.lua`) implementing 23 commands
  against Aseprite 1.3's Lua API, with every mutation inside a transaction so
  one Ctrl+Z undoes one agent action.
- **`look`** — upscaled previews, exact one-glyph-per-pixel text grids,
  animation filmstrips and pixel-level frame diffs.
- **Palette discipline** — CIELAB ΔE snapping on by default in `draw` and
  `recolor`, with a report of every colour moved and how far.
- **Hue-shifted shading** (`recolor` op `shade`, `palette` op `ramp`): shadows
  cool, highlights warm.
- **`validate`** — a lint pass with located findings for palette sprawl, stray
  pixels, semi-transparent pixels, untagged animation and uniform timing.
- **Skills over MCP** — 11 `/pixel-*` workflows and an 8-chapter pixel-art
  rulebook, served as `skill://` and `rules://` resources and as MCP prompts, so
  Codex, Gemini CLI and Cursor get the same discipline as Claude Code.
- **Cross-client installer** (`install`) for Claude Code, Codex, Gemini CLI,
  Cursor, VS Code and Windsurf, with backups and `--dry-run`, plus an
  `AGENTS.md` writer.
- **`doctor`** — a diagnosis command that reports each link in the chain.
- **Claude Code plugin** with four specialist subagents (pixel-critic,
  palette-smith, rig-builder, animation-director) and two hooks.
- **Tests** — TypeScript unit and integration tests for colour, rendering, the
  bridge transport and the MCP surface; a headless Lua harness running the real
  extension handlers inside `aseprite -b` against a real sprite.

- **Tilesets** — `pack` turns a hand-painted mockup into a deduplicated tileset
  plus a tilemap that reconstructs it pixel for pixel (with an optional
  `tolerance` for merging near-identical cells), and `export` writes Tiled
  (`.tsj` tileset plus a `.tmj` map that uses it), Godot 4 (`.tres`) or JSON,
  each beside a packed PNG. `layout: "blob47"` adds a Tiled wangset whose 47
  canonical masks are computed, not hardcoded.

### Known limits

- `blob47` export assumes the tileset is authored in canonical blob-mask order
  and refuses an incomplete set rather than writing a wangset that would
  autotile wrongly.
- Godot export targets Godot 4 (`TileSetAtlasSource`); Godot 3 is not emitted.
- Re-establishing a *dropped* Aseprite connection can wait until the Aseprite
  window is focused once. A live connection keeps working unfocused.
- `look` op `ascii` refuses above 64×64; pass a region.
