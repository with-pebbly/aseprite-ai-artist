# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[semver](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-09-08

First release.

### Added

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
