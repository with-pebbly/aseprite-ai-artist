# Security

## Threat model

This is a local developer tool. It assumes you already trust the coding agent
you are running with your filesystem and with the application holding your
unsaved work. Within that assumption, here is exactly what it does and what it
does not do.

## The local network surface

The bridge binds **`127.0.0.1` only**, on two ports (9931 and 9932 by default).
Nothing listens on a public interface and there is no remote transport, so there
is nothing to authenticate against.

The consequence worth stating plainly: **any process on your machine can connect
to the bridge and drive Aseprite** — draw, save, export, close documents. That is
the same trust boundary as any other localhost developer service, but it is a
real one. If you share a machine with untrusted local users, do not run the
bridge.

Stop it when you are not using it:

```bash
pkill -f "aseprite-ai-artist bridge"     # macOS / Linux
taskkill /F /FI "WINDOWTITLE eq aseprite-ai-artist*"   # Windows, or use Task Manager
```

## Filesystem access

Tools that take a `path` — `export`, `sprite_manage` (`open` / `save_as`),
`reference` (`import`), `tileset` (`export`) — write wherever the model asks.
There is no sandbox root. Paths are passed to Aseprite as given; nothing is
interpolated into a shell.

`draw` reads files in the server process itself: a grid's `file` and an
`image` op's `path`, resolved against the server's working directory, any
location, up to 16 MiB. Neither is executed or forwarded anywhere, but a grid
error names the offending row, column and glyph, so a text file's characters
can surface in a tool result. The PNG decoder refuses images over 4096×4096
and image data that inflates past what the header declares, so a crafted file
cannot exhaust the server's memory.

`look` writes temporary PNGs into the OS temp directory and deletes them after
reading.

In short: these tools read and write files wherever you point them, with the
same reach you have yourself. That is deliberate for a local tool, and it is the
same reach `run_lua` grants — but it is worth knowing before you hand a path to
an agent.

## Editing your agent configuration

`install` modifies files that belong to your agent:
`~/.claude.json`, `~/.codex/config.toml`, `~/.gemini/settings.json`,
`~/.cursor/mcp.json`, `.vscode/mcp.json`, `~/.codeium/windsurf/mcp_config.json`,
`~/.config/opencode/opencode.json`.

Two protections:

- **A timestamped backup** (`<file>.bak-<iso>`) is written before every change.
- **Writes are atomic** — a temp file in the same directory, renamed over the
  target. `~/.claude.json` in particular holds Claude Code's own project list and
  session state and can be over 100KB; a partial write would break your whole
  setup, and a rename cannot produce one.

Rewriting is also surgical where it can be: the Codex TOML editor replaces only
its own `[mcp_servers.aseprite-ai-artist]` table, matched at the start of a
line so the same text inside a comment or a string cannot misdirect the splice.

There is no file lock. If your agent writes its own config at the same moment,
one side's change can still be lost. Run `install` while the agent is closed, or
use `--dry-run` first to see exactly what would change.

`install-extension` copies the Lua extension into Aseprite's config directory.
Nothing else is touched.

## `run_lua`

`run_lua` executes arbitrary Lua inside the Aseprite process holding your
unsaved work. It has full Aseprite API access, which includes the filesystem.

It is **off by default, and gated twice**:

- The server hides the tool unless `--allowLua` on the CLI, or
  `ASEPRITE_AI_ALLOW_LUA=1` in the server's environment, is set. The agent
  cannot see or call it.
- The extension itself refuses `lua.run` unless the Aseprite process was
  started with `ASEPRITE_AI_ALLOW_LUA=1`. The capability is absent, not just
  the tool entry.

A live session therefore needs the variable in the environment that started
**Aseprite**, not in the agent's — the extension cannot see the agent's
environment. Headless mode has nothing extra to do: when the server runs with
`--allowLua`, it passes the variable to the batch Aseprite it starts.

**What the gate does not cover.** The rest of the bridge stays open: while it
runs, any local process that connects to the control port can drive the
ordinary tools — draw, save, export, close documents — no matter how this
server was started. That is the same trust boundary as any other localhost
developer service, and it is a real one. If it matters on your machine, stop
the bridge when you are not using it.

## Instructions served to the agent

The server serves `skill://` and `rules://` resources read from `skills/` and
`rules/` on disk, plus an `instructions` string. Anything that can write into
those directories controls what your agent is told to do. Treat them as you
would any other executable content in a repository you have installed.

## What is never sent anywhere

Nothing leaves the machine. There is no telemetry, no network egress, and no
credential handling anywhere in this codebase.

## Resource limits

The bridge refuses WebSocket frames over 16 MiB and more than 64 simultaneous
control clients. Both exist because the socket is unauthenticated: without them,
any local process could exhaust memory with one connection.

## Reporting a vulnerability

Open a security advisory on the repository rather than a public issue:
https://github.com/with-pebbly/aseprite-ai-artist/security/advisories/new
