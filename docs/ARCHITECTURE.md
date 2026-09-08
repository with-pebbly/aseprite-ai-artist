# Architecture

## The constraint everything follows from

Aseprite's Lua API provides a WebSocket **client**. It cannot listen. So
something outside Aseprite has to hold a listening socket, and the extension
dials out to it.

That single fact produces the three-process shape below.

```
   Agent host (Claude Code / Codex / Gemini CLI / Cursor / VS Code)
   ┌──────────────────────────────────────────────────────────────┐
   │  skills (skill://…)   rules (rules://…)   18 tools           │
   └───────────────────────────┬──────────────────────────────────┘
                               │ stdio, MCP JSON-RPC
                               ▼
   ┌──────────────────────────────────────────────┐   one per agent window;
   │  aseprite-ai-artist serve   (src/server.ts)  │   the host owns its
   │  LiveClient  =  control client               │   lifecycle and may
   └───────────────────────────┬──────────────────┘   restart or duplicate it
                               │ WebSocket  ws://127.0.0.1:9932
                               │ • spawns the bridge if nothing owns the port
                               │ • reconnects with backoff
                               │ • reads bridge_state → pluginConnected
                               ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  aseprite-ai-artist bridge   (src/bridge/bridge.ts)          │
   │  SINGLETON by port ownership · owns :9931 and :9932          │
   │  dumb relay; outlives every MCP server restart               │
   └───────────────────────────┬──────────────────────────────────┘
                               │ WebSocket  ws://127.0.0.1:9931
                               ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Aseprite 1.3 + extension/ai-artist.lua  (client-only WS)     │
   │  executes named commands, draws into the OPEN window          │
   └──────────────────────────────────────────────────────────────┘
```

## Why the bridge is its own process

The agent host starts, stops and duplicates the MCP server as it pleases. When
the listening socket lives inside that process:

- every restart drops Aseprite's connection, and
- a second agent window fights the first over the listen port.

As a standalone singleton, the bridge keeps Aseprite attached across MCP
restarts, and a second MCP server simply becomes a second control client. The
loser of the port-bind race exits 0 without complaint, so "spawn the bridge if
it is missing" is safe to run unconditionally.

See [ADR-0002](adr/0002-standalone-bridge.md).

## Request routing

The bridge accepts **N control clients** but **at most one Aseprite** (last
connection wins, so restarting Aseprite is never locked out by a half-open
socket). Replies therefore have to be routed back to the client that asked,
which is what the id namespacing is for:

```
 MCP server                bridge                       Aseprite
 ──────────                ──────                       ────────
 {id:"r42", …}   ────────▶ rewrite id → "c3::r42" ────▶ {id:"c3::r42"}
                                                          (draws)
 {id:"r42", …}   ◀──────── split "c3::r42" →      ◀──── {id:"c3::r42",
                           client 3, orig "r42"            ok:true, …}
```

`hello` and other id-less frames from Aseprite update bridge state and are
**broadcast** to every client as `bridge_state`, which is how `preflight` can
answer truthfully without a round trip.

## Failing loudly

When Aseprite is not attached, the bridge answers the client itself with
`not_connected` and `doNotFallBackToDisk: true`, rather than letting the call
hang until it times out.

This matters more than it looks. A timeout reads to an agent as "slow, try
something else", and the something else is editing the `.aseprite` file on disk
— which the user does not see in their open editor and which their next save
silently overwrites. A fast, structured, explicit refusal is the only failure
mode that does not quietly destroy work.

## Ports

| Port | Owner | Purpose | Environment override |
|------|-------|---------|---------------------|
| 9931 | bridge | The Aseprite extension dials here | `ASEPRITE_AI_PLUGIN_PORT` |
| 9932 | bridge | MCP servers dial here as control clients | `ASEPRITE_AI_CONTROL_PORT` |

Both bind `127.0.0.1` only. Nothing listens on a public interface, and there is
no authentication because there is no remote surface to authenticate.

## Where work happens

| Concern | Lives in | Why there |
|---------|----------|-----------|
| Tool schemas, validation, batching | `src/tools/` | Where the agent's contract is |
| CIELAB colour maths | Both sides | Server for reports, Lua for per-pixel passes |
| Image upscaling | Aseprite | Keeps the npm package free of native deps |
| ASCII grids and diffs | `src/lib/render.ts` | Text formatting is cheap and testable in Node |
| Pixel loops | Lua | Sending a 64×64 image over the wire per op would not scale |

The colour maths is deliberately duplicated (`src/lib/color.ts` and the CIELAB
block in `extension/ai-artist.lua`). Both are covered by tests that pin the same
expectations, because a palette snap that disagrees between the report and the
pixels is worse than either being wrong alone.

## Known limits

- **Reconnect may wait for focus.** A live connection keeps working while
  Aseprite is unfocused, but the extension's reconnect timer is driven by the UI
  loop, so re-establishing a *dropped* connection can wait until the window is
  focused once.
- **Text grids are capped at 64×64.** Above that, `look` op `ascii` refuses and
  asks for a region. A wall of text is worse than no answer.
- **blob47 export assumes canonical ordering.** The wangset it writes maps
  atlas slot *n* to the *n*-th canonical blob mask in ascending order. A tileset
  authored in a different order exports a wangset that autotiles wrongly, so
  the export refuses unless the set has all 47 tiles. `tileset` op `export` with
  `format: "json"` reports the index-to-mask mapping if you need to check.
- **Godot export targets Godot 4.** It writes a `TileSet` with a single
  `TileSetAtlasSource`; Godot 3's format is different and is not emitted.
