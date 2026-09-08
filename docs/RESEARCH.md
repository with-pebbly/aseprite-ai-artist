# Prior art, and why this exists anyway

This project was started from a brief that had already been **archived** with
the verdict *"do not build a competing general Aseprite MCP / Claude plugin"*.
That verdict was correct about the landscape and worth taking seriously, so this
document records what is actually out there, what was taken from it, and what
the remaining gap is.

If you are deciding whether to use this or one of the alternatives, read this
page first. Several of them are excellent.

## The field, as of September 2026

| Project | Language | Shape |
|---------|----------|-------|
| [`bachhoang0606/aseprite-mcp`](https://github.com/bachhoang0606/aseprite-mcp) | Rust | ~90 `live_*` tools, live bridge, Claude Code plugin, `/pixel-*` skills, four subagents, evals, 3-OS CI. The most complete implementation. |
| [`rezaahmadn/aseprite-mcp-bridge`](https://github.com/rezaahmadn/aseprite-mcp-bridge) | — | ~122 tools over a live bridge. Broadest raw API coverage. |
| [`logiksecurity/ase-mcp`](https://github.com/logiksecurity/ase-mcp) | — | Ships as one Aseprite extension that carries the bridge and server. Best installation UX. |
| [`ilhamdoanggg/aseprite-mcp`](https://github.com/ilhamdoanggg/aseprite-mcp) | TypeScript | Smaller, code-first, Lua batch execution. |
| [`Dizzd/aseprite_mcp`](https://github.com/Dizzd/aseprite_mcp) | Rust | 44 tools, native build. |
| [`tien226anh/aseprite-mcp-python`](https://github.com/tien226anh/aseprite-mcp-python) | Python | `uvx` zero-install, CLI + realtime modes, multi-client. |
| [`willibrandon/pixel-plugin`](https://github.com/willibrandon/pixel-plugin) + [`pixel-mcp`](https://github.com/willibrandon/pixel-mcp) | — | The best-known Claude-specific UX layer. |

The archived brief's conclusion was that these cover the proposed product. On
the product as originally proposed — "a maintained Aseprite MCP plus a Claude
plugin" — that is simply true.

## What was taken from them

Directly, and gratefully. These are good ideas and it would be silly to
rediscover them:

- **A decoupled singleton bridge.** `bachhoang0606`'s ADR-0002 documents exactly
  why an in-process listener fails: the host restarts the MCP server, the
  Aseprite link dies with it, and duplicate processes fight over the port. That
  analysis shaped [our ADR-0002](adr/0002-standalone-bridge.md).
- **Vision-legible previews.** Upscaling a 32px sprite to ~1024px before showing
  it to a vision model, because raw 1× previews are below the resolution a model
  can read.
- **Text grids for exact verification.** One glyph per pixel with a colour
  legend beats an image when the question is "is this pixel at (12,7)".
- **Filmstrips for animation review**, because a vision model reads only the
  first frame of a GIF.
- **Frame diffs**, so an agent can confirm what its edit actually touched.
- **CIELAB ΔE for palette snapping**, not RGB distance.
- **Capability negotiation with loud `unsupported_command`**, so an old
  extension degrades visibly instead of mysteriously.
- **`doNotFallBackToDisk`** on connection failures — the single most important
  detail in this whole category of tool, and it is theirs.

## What is different here, and why

Three things, all of which are consequences of taking the archived verdict
seriously rather than ignoring it.

### 1. Cross-agent parity, not Claude-first

The existing Claude-focused projects put their craft knowledge in a Claude Code
plugin: `skills/`, `agents/`, `hooks/`. Claude Code reads those. Codex, Gemini
CLI and Cursor cannot — they get the raw tools and none of the discipline, which
is most of what makes the tools produce decent sprites rather than coloured
noise.

Here the rules and workflows live in `rules/` and `skills/` as one source of
truth, and are served **three ways**: as plugin files for Claude Code, as
`rules://` and `skill://` MCP resources for everyone else, and as MCP prompts
for clients that render them. `install --agents` additionally writes an
`AGENTS.md` section for the clients that read one.

This tracks the MCP Skills-over-MCP working group's direction (SEP-2640,
resources-based). When that extension lands in the SDK, the transport becomes
the standard one and the on-disk format does not change.

### 2. Eighteen tools instead of ninety

Every tool schema is resident in the model's context on every turn, whether or
not anyone is drawing. Ninety to a hundred and twenty tool definitions is a
large per-turn cost paid by users who asked about something else. One existing
project has spent releases trimming its own tool descriptions to claw some of it
back — which is treating the symptom.

Grouping by noun with an `op` enum, plus batch arrays, covers the same ground at
roughly a sixth of the schema. A test fails if the count creeps past 24.

The batching has a second, better effect: `draw` applies all its operations in
one Aseprite transaction, so the user's Ctrl+Z undoes *the agent's edit* rather
than one stray pixel out of forty.

### 3. Zero-install, one config line everywhere

The Rust implementations have the best runtime and the worst install: the config
must name a per-OS binary path, so the line a user copies from a README is wrong
for half of them. `npx` with no native dependencies gives one line that is
identical on macOS, Windows and Linux, in every client. That is why previews are
upscaled inside Aseprite rather than with `sharp` — see
[ADR-0001](adr/0001-typescript-and-npx.md).

## Honest assessment

`bachhoang0606/aseprite-mcp` is more complete than this project. It has more raw
API coverage, an eval harness, three-OS CI and a year of hardening. If you use
Claude Code exclusively and want the broadest Aseprite surface, use it.

This project is worth choosing if you use more than one agent, or care about
per-turn token cost, or want an install that is the same everywhere.

Those are narrow advantages. They are, however, real ones, and they were not
addressable by contributing upstream: they are consequences of the tool-surface
shape and the implementation language, which are the two things a project cannot
change after it ships.

## The rule that produced this document

From the original brief, and still good advice:

> Before reviving this idea or proposing an Aseprite-related OSS project,
> compare the proposed gap against at least the first three repositories above
> plus `pixel-plugin`/`pixel-mcp`. Prefer upstream contribution or a narrow
> extension when an incumbent already solves 80–90% of the problem.
