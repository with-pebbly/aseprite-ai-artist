# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[semver](https://semver.org/).

## [0.1.6] — 2026-09-09

Mostly documentation and art, plus one thing that should have existed from the
start. The extension's own code is unchanged from 0.1.5 apart from the version
string it reports.

### Added

- **`doctor` and `preflight` now say when the attached extension is older than
  the server.** Aseprite loads the extension once, at startup, so an editor left
  open across an upgrade keeps answering with the old build — silently, for as
  long as that session lasts. Nothing compared the two versions, so this went
  unnoticed for a whole working day: three bugs fixed in 0.1.5 went on being
  worked around by an agent talking to a 0.1.3 extension that reported itself
  perfectly happily. A mismatch is no longer a tick, and `preflight` puts it in
  the directive the agent reads first.
- `docs/media/src/hero2/` — the generator the hero is built from: a coordinate
  model that emits all 54 frames, a push script, and `compare.py`, which diffs
  the model against Aseprite's own export and currently reports zero differing
  pixels. The scene had been regenerable only from a temporary directory.

### Changed

- **The hero animation closes its loop.** It ran 36 frames, finished the
  painting and hard-cut back to a blank canvas. Now the robot holds on the
  finished picture, wipes it off, and starts again — 54 frames, tagged `paint`
  (1–33), `hold` (34–37), `erase` (38–52), `reset` (53–54). Frame 54 hands over
  to frame 1 with 60 pixels different, all of them deliberate: the first dab,
  the antenna, one step of the dust clock.
- **The README is half the prose it was.** Fifteen headings became nine, the
  install is three short steps, and the per-client capability table moved to
  `docs/INSTALL.md`, which is where someone installing actually looks.
- `docs/INSTALL.md` explains why `npx @pebbly/aseprite-ai-artist` fails inside a
  checkout of this repository. npm resolves the current project as the package,
  skips fetching it, and looks for the binary in `node_modules/.bin` — where a
  package's own bin is never linked. The result is `command not found`, which
  reads like a broken package and is only ever a wrong working directory.

## [0.1.5] — 2026-09-09

Three commands reported success while doing nothing. That is worse than an
error: the agent believes the edit landed and builds the next step on top of it.
All three surfaced while drawing a 35-layer scene through the bridge, none of
them from a crash.

### Fixed

- **`layer` op `group` could never have worked.** It called
  `Sprite:newGroupLayer()`, which is not in the Aseprite API. Indexing a missing
  field throws rather than returning nil, so the whole batch — every other op in
  it included — rolled back with `Field newGroupLayer does not exist`. The
  method is `newGroup()`.
- **`cel` op `link` linked nothing and counted everything.** `LinkCels` acts on
  the timeline range, not on the active layer and frame; the old code set those
  and called the command once per target frame, which is a no-op, then reported
  one success per frame. A caller was told a static layer had been shared across
  a cycle while the target frames were still empty. The range now holds the
  source cel and every target together in one call, the reply counts only frames
  that actually ended up sharing the source image, and linking from a frame with
  no cel is now an error naming `copy` as the way to seed one.
- **`validate` timed out on a large sprite.** Its stray and outline scans asked
  `pixel_to_hex` — a `string.format` — whether a pixel was opaque, for every
  pixel and each of its four neighbours: tens of millions of strings allocated
  to compute a boolean. Presence is now answered without allocating. Measured on
  the 35-layer, 36-frame sprite this was found on, the stray scan went from
  10.5s to 2.2s and found the identical 1373 strays.

### Changed

- **The per-pixel checks skip hidden layers**, as `outline` and `banding`
  already did. A finding about pixels that never reach the export is noise, and
  a document that keeps its earlier drafts as hidden layers is mostly hidden —
  on the sprite above, 769 of 1042 cels. `validate` now says how many layers it
  passed over, so a clean result cannot quietly mean "clean, because I did not
  look".
- `validate.run` gets its own 120s budget rather than the shared 20s default. A
  thorough pass over a rigged sprite is legitimately slow, and a timeout reads
  to an agent as "Aseprite is not answering" — the one message that sends it
  looking for a workaround.

## [0.1.4] — 2026-09-08

### Fixed

- **GIF export waited for a click nobody was there to give.** Aseprite warns
  once per session that GIF cannot hold everything a sprite can, and no save API
  declines it. From outside it did not look like a prompt at all: a modal pumps
  events while it waits, so every other command kept answering and only the
  export appeared to hang. It is now suppressed for the duration of the export
  and handed straight back, so File ▸ Save As keeps whatever the user chose.
- 0.1.3 tried to fix this with `SaveFileCopyAs{ui = false}`. That flag does not
  govern this dialog. GIF export now converts a throwaway copy to indexed
  instead of leaving the conversion to a prompt — and on a copy, because doing
  it in place would silently change the colour mode of the document being
  worked in.

### Added

- `export` op `gif` honours `scale`. A browser scaling a 128px GIF up smooths
  it, and smoothed pixel art is ruined pixel art; exporting big keeps the pixels
  square wherever the file is shown.

### Known

- The first GIF export in an Aseprite session costs 20-30 seconds — measured
  20.6s, then 435ms for the identical export straight after. Something warms up
  once. The 120s export budget from 0.1.3 covers it.

## [0.1.3] — 2026-09-08

### Fixed

- **Exporting a GIF from a live window never returned.** Writing an RGB sprite
  to GIF needs a colour quantisation that Aseprite asks about, and
  `Sprite:saveCopyAs` has no way to decline the dialog. The diagnosis was
  misleading: a modal dialog pumps events while it waits, so every other command
  kept answering normally and only the export looked stuck. Now uses
  `SaveFileCopyAs{ui = false}`. Headless tests could never catch this — `aseprite
  -b` has no dialogs at all.
- **Even fixed, the first GIF export timed out.** Aseprite warms its GIF codec
  once per session: measured at 38s for the first write of a 32x32 sprite and
  about 2s for every one after, against a 20s client timeout. So the first
  animation anyone exported failed on work that then succeeded. `export` now
  gets its own 120s budget.

### Changed

- `LiveClient.call` takes an options object (`expect`, `timeoutMs`) instead of a
  third positional argument.

## [0.1.2] — 2026-09-08

### Fixed

- **`preflight` failed on a freshly started editor.** 0.1.1's new boundary check
  required `sprite` from `session.site`, but a Lua table cannot hold nil: with
  no document open the key never reaches the wire at all, and the check could
  not tell that apart from an extension too old to send it. The first call any
  agent makes therefore failed, telling the user to reinstall a perfectly
  current extension. It now requires `openSprites`, which is always present.

## [0.1.1] — 2026-09-08

### Fixed

- **`transform op=crop_to_content` did nothing and reported success.** It called
  `CanvasSize{trimOutside=true}`, which trims to the *selection*; with none set
  the canvas was untouched. Aseprite's own Sprite > Trim is `AutocropSprite`.
  `pixelsChanged` now reports the area dropped.
- **Importing a reference broke every write that followed it.** `app.open` makes
  the opened file the active sprite and closing it left *no* active sprite at
  all — `app.transaction` refuses to run in that state, so `reference` op
  `import` and `sample_palette` failed, and in the UI the user's tab changed
  under them. The active sprite is restored.
- **A failure inside a transaction arrived as `function: 0x...`.** `transact`
  retried the failing closure through the older one-argument `app.transaction`
  and reported the *second* attempt's error, hiding the first — and replaying a
  mutating closure on top of its own half-applied changes. Which form the build
  supports is probed once instead.
- **`doctor` started a bridge and then reported that bridge as healthy**, and
  left it running. It now says when it started one to test with, stops it again,
  and reports the extension as `unknown` rather than telling the user to open
  Aseprite when the bridge — not Aseprite — is what could not be reached.

### Added

- `tests/pure.test.lua`: the Lua checks that need no editor, so CI finally
  executes part of the extension instead of only parsing it. It runs under stock
  Lua with stand-ins, and unmodified inside Aseprite with the real types.
- A presence check at the Lua→TypeScript boundary: a call may declare the reply
  fields it goes on to read, and a reply without them fails with a message
  naming them instead of letting `undefined` reach the agent as a success. This
  catches an extension older than the server; it is not schema validation, and
  an argument the two sides spell differently is still only caught by the Lua
  suite.
- Coverage for every palette command, reference import/list/sample/remove,
  `transform` crop/translate/scale/outline, `select` all/ellipse/color/invert/
  grow/shrink, `resize_canvas`, `set_properties`, and png/gif/spritesheet
  export. The Lua suite goes from 39 checks to 57, the Node suite to 40.

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
