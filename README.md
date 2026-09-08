# Aseprite AI Artist

Let a coding agent draw pixel art in your **open Aseprite window** — not in a
copy, not on disk, in the document you are looking at.

One MCP server, one Aseprite extension, and a pixel-art rulebook the agent
actually has to follow. Works with **Claude Code, Codex CLI, Gemini CLI, Cursor,
VS Code and Windsurf** from the same one-line config.

```bash
npx @with-pebbly/aseprite-ai-artist install --all --agents
npx @with-pebbly/aseprite-ai-artist install-extension
# restart Aseprite, restart your agent
```

> **Requires Aseprite 1.3+** and Node 20.10+.

---

## What it does

> *"Draw me a 32×32 knight in the PICO-8 palette, then a 4-frame idle."*

The agent inspects the document, picks a palette, blocks in a silhouette,
**looks at what it drew**, shades with proper hue shifting, rigs the character
onto layers, animates, tags the cycle, validates, and tells you what it
compromised on. In your window, undoable, one Ctrl+Z per edit.

## What makes it different

**It works everywhere, not just in Claude Code.** Most Aseprite MCP projects put
their craft knowledge in a Claude Code plugin. Codex, Gemini and Cursor then get
raw tools and none of the discipline — which is most of what separates a sprite
from coloured noise. Here the rules and workflows are served over MCP as
`rules://` and `skill://` resources *and* as MCP prompts, so every client gets
them from one source of truth.

**Eighteen tools, not ninety.** Every tool schema sits in the model's context on
every turn, whether or not you are drawing. Grouping by noun with an `op` enum,
plus batch arrays, covers the same ground at roughly a sixth of the cost — and
makes batching the default, so one `draw` call is one undo step for you.

**One config line on every OS.** No compiled binary, no per-platform path, no
native dependencies. `npx` and go.

**It has to look at its own work.** `look` gives the agent an upscaled preview,
an exact one-glyph-per-pixel text grid, a filmstrip of every animation frame,
and a pixel-level diff between frames. `validate` then checks the sprite
mechanically before anything gets called finished.

**It cannot quietly wreck your file.** When Aseprite is not attached, every tool
refuses immediately with `doNotFallBackToDisk` rather than timing out — because
an agent that "recovers" by editing the `.aseprite` file makes changes you never
see and your next save overwrites.

There is [a whole page](docs/RESEARCH.md) on the other projects in this space,
what was taken from them, and where they are still better.

## Install

See **[docs/INSTALL.md](docs/INSTALL.md)** for per-client detail and
troubleshooting.

### Claude Code

The plugin brings the `/pixel-*` skills, the specialist subagents and the hooks,
not just the tools:

```
/plugin marketplace add with-pebbly/aseprite-ai-artist
/plugin install aseprite-ai-artist
```

### Everything else

```bash
npx @with-pebbly/aseprite-ai-artist install codex      # ~/.codex/config.toml
npx @with-pebbly/aseprite-ai-artist install gemini     # ~/.gemini/settings.json
npx @with-pebbly/aseprite-ai-artist install cursor     # ~/.cursor/mcp.json
npx @with-pebbly/aseprite-ai-artist install --all      # all of the above
```

Existing config is backed up first. `--dry-run` shows the change without making
it. `--project` writes into the repository instead of your home directory.

### Check it

```bash
npx @with-pebbly/aseprite-ai-artist doctor
```

## The tools

Eighteen, grouped by noun. Full reference in **[docs/TOOLS.md](docs/TOOLS.md)**.

| | |
|---|---|
| **Session** | `preflight` · `sprite_info` · `sprite_manage` |
| **Looking** | `look` · `read_pixels` |
| **Drawing** | `draw` · `select` · `transform` · `recolor` |
| **Structure** | `layer` · `frame` · `tag` · `cel` |
| **Colour & quality** | `palette` · `validate` |
| **Assets** | `reference` · `export` · `tileset` |

Plus `run_lua` as an escape hatch, off by default.

## The skills

Workflows the agent follows, served to every client:

`pixel-brief` · `pixel-new` · `pixel-palette` · `pixel-draw` · `pixel-shade` ·
`pixel-rig` · `pixel-animate` · `pixel-tileset` · `pixel-review` · `pixel-fix` ·
`pixel-export`

And in Claude Code, four specialist subagents: **pixel-critic** (visual QA),
**palette-smith** (colour), **rig-builder** (layer rigs), **animation-director**
(cycle planning).

## The rules

The craft is encoded in [`rules/`](rules/) and served as `rules://` resources —
palette discipline, hue-shifted shading, silhouette and proportion, outlines and
edges, animation timing, layer rigging, and a review checklist. Skills reference
rules rather than restating them, so a rule has exactly one place to be wrong.

The mechanical parts are enforced by the tools themselves: `draw` and `recolor`
snap to the palette by perceptual distance and report every colour they moved,
so an agent that never reads a word of the rulebook still cannot casually widen
your palette.

## How it works

```
your agent  ──stdio/MCP──▶  server  ──ws:9932──▶  bridge  ──ws:9931──▶  Aseprite
```

Aseprite's Lua WebSocket is a client only, so the bridge holds the listening
socket. It runs as its own singleton process so that restarting the MCP server —
which agent hosts do freely — does not drop your Aseprite connection, and so a
second agent window can attach without stealing the first one's replies.

Details in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** and the
[ADRs](docs/adr/).

## Development

```bash
npm install
npm run build
npm test                                        # TypeScript: colour, render, bridge, MCP surface
npm run test:extension                          # Lua handlers, headless, against a real sprite
```

The Lua tests run the real command handlers inside `aseprite -b` against a real
sprite — the only way to prove that side works without a human clicking.

## Security

The bridge binds `127.0.0.1` only, on both ports. There is no remote surface and
no authentication because there is nothing remote to authenticate. `run_lua` is
arbitrary code execution inside the app holding your unsaved work, and is off
unless you turn it on.

## Licence

MIT. See [LICENSE](LICENSE).

Aseprite is a trademark of Igara Studio S.A. This project is not affiliated with
or endorsed by them.
