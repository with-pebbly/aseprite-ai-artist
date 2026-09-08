# ADR-0002 — The WebSocket bridge is a separate, singleton process

**Status:** accepted · 2026-09-08

## Context

Aseprite's Lua `WebSocket` is a client only. Something must listen for it.

The obvious place is inside the MCP server. That fails in practice for two
reasons, both caused by the fact that the agent host — not us — owns the MCP
server's lifecycle:

1. The host restarts the server (config reload, plugin toggle, crash recovery).
   Every restart tears down the listening socket, dropping Aseprite's
   connection. The user sees their assistant "lose" Aseprite for no visible
   reason.
2. The host may run several instances — a second project window, a subagent.
   The second one cannot bind the port, so it either crashes or silently has no
   Aseprite link.

## Decision

Run the bridge as its own detached process that owns both ports. It is a dumb
relay with no Aseprite knowledge.

- **Singleton by port ownership.** Whoever binds the control port is the bridge.
  A loser of the race exits 0 silently, so "start the bridge if needed" is safe
  to call unconditionally from any MCP server on startup.
- **N control clients, one Aseprite.** Replies are routed back by namespacing
  the request id per client (`c3::r42`).
- **Last Aseprite connection wins**, so restarting Aseprite is never locked out
  by a half-open previous socket.
- **Same binary, different subcommand** (`bridge` vs `serve`), so there is
  nothing extra to install.

## Consequences

**Good.** Aseprite stays attached across MCP restarts. Two agent windows can
work against one Aseprite session.

**Good.** The bridge can answer `not_connected` on Aseprite's behalf
immediately, instead of letting a call hang until timeout — which is what stops
an agent from "recovering" by editing files on disk.

**Bad.** A second process the user did not ask for. Mitigated by: it is
spawned automatically, it is tiny, it exits when its ports are taken, and
`doctor` reports it.

**Bad.** A stale bridge from an older version could serve a newer server.
Mitigated by the protocol version in `hello` and by feature flags rather than
version bumps.
