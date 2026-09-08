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
- **A scratch `Sprite` must be created inside `preserving_site`**, not before
  it, or the restore targets a document you just closed and Aseprite is left
  with no active sprite.
- **A Lua table cannot hold a `nil` value**, so an absent field is a missing key
  and never an explicit null. Output schemas use `.nullish()`, not `.nullable()`.

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
