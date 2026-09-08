# Working on this repository

Guidance for agents and humans changing this code. For using the tool, see the
[README](README.md).

## Shape

| Path | What |
|------|------|
| `src/` | The MCP server, bridge, control client and CLI (TypeScript) |
| `extension/ai-artist.lua` | Everything that runs inside Aseprite |
| `rules/` | Pixel-art craft, served as `rules://` resources |
| `skills/` | Workflows, served as `skill://` resources and MCP prompts |
| `agents/`, `hooks/` | Claude Code plugin surface |
| `tests/` | Node tests, plus a Lua harness that runs inside `aseprite -b` |
| `docs/adr/` | Why things are the way they are. Read these before arguing with them. |

## The rules that are not negotiable

**Nothing may be declared and not implemented.** A schema field, an `op` value
or a check name that the Lua side never reads is worse than a missing feature:
the call validates, succeeds, and does nothing. A 2026-09-08 audit found six of
these at once — `transform.scope`, `gradient.dither`, `validate`'s `outline` and
`banding` checks, `tag`'s `repeat`, and a `linked` flag hardcoded to false. If
you add a field, add the branch that reads it in the same change, and a test
that fails without it.

**The tool count stays at or under 24.** A test enforces it. The whole design is
in [ADR-0003](docs/adr/0003-compact-tool-surface.md): every tool schema costs
context on every turn of every conversation, including the ones that never touch
Aseprite. If you need new behaviour, add an `op` to an existing noun.

**Never let a failure become a disk edit.** When Aseprite is not attached, tools
refuse with `not_connected` and `doNotFallBackToDisk`. An agent that "recovers"
by editing the `.aseprite` file makes changes the user cannot see and their next
save destroys. This is the single most important behaviour in the project.

**Every mutation goes inside `app.transaction`.** One agent action must be one
Ctrl+Z for the user.

**Never leave the user's active sprite, layer or frame changed** as a side
effect. Use `preserving_site`.

**Unsupported means unsupported.** An unknown command returns
`unsupported_command`. Never no-op silently.

## Lua gotchas that have already cost a day

Aseprite's Lua environment is not plain Lua, and its deviations fail silently:

- **`json.decode` returns `userdata`, not a table.** Everything from the wire
  goes through `to_plain()` at the boundary. Do not skip it.
- **A decoded JSON array yields nothing from `pairs`** but answers `#` and
  `ipairs`. A decoded JSON *object* also answers `#` — with its key count. Only
  `value[1] ~= nil` distinguishes them. Getting this wrong turns a 40-op draw
  batch into zero ops that report success.
- **`print()` inside a WebSocket callback does not reach stdout.** Trace through
  the status file instead.
- **`function t["key"]()` is not valid Lua.** Use `t["key"] = function()`.
- **A Lua table cannot hold a `nil` value**, so an absent field is a missing key
  and never an explicit null. Output schemas use `.nullish()`, not `.nullable()`.
- **Assigning `cel.image` invalidates the old handle.** Read `img.width`/`height`
  into locals before the swap or the next line raises "Tried to access a deleted
  'ImageObj'".
- **`cel.image` returns a fresh wrapper each read**, so `rawequal` never matches.
  Compare `cel.image.id` to tell whether two cels share one image.
- **`Sprite:newFrame()` bypasses the command machinery**, and `LinkCels` will not
  link a frame made that way. Create through `app.command.NewFrame` when the
  frame has to be linkable. `NewFrameLink` does not exist in 1.3.
- **A scratch `Sprite` must be created inside `preserving_site`**, not before it.
- **Global `print` must be restored on every path** — `lua.run` hijacks it to
  capture output, and a throw that skips the restore leaves every other script's
  output swallowed for the rest of the session.
- **A tilemap cel needs a `ColorMode.TILEMAP` image**, built from an `ImageSpec`.
  The generic cel helper hands back an RGB image and every stamp is silently
  lost.
- **Tile index 0 is Aseprite's reserved empty tile.** Engines index their atlas
  from 0, so leaving it in an exported atlas shifts every real tile by one and
  the map renders one tile off everywhere. The exporter drops it; `get` keeps it
  so atlas position still matches the index you pass to `stamp`.

## Testing

```bash
npm test              # colour, rendering, bridge transport, MCP surface
npm run test:extension # the real Lua handlers, headless, against a real sprite
npm run test:e2e      # the whole chain; needs a live Aseprite (see tests/e2e.mjs)
```

The unit tests will not catch an Aseprite API misunderstanding. Every one of the
gotchas above was found by `test:e2e` after the isolated tests were green. Run
it before claiming a change to the Lua side works.

Use an isolated Aseprite for e2e — `ASEPRITE_USER_FOLDER` pointed at a scratch
directory — so a test never touches someone's real documents.

## Style

Comments explain *why*, especially where the code looks wrong but is not. The
Lua gotchas above are all documented at their call sites for exactly that
reason. Do not add comments that restate the code.
