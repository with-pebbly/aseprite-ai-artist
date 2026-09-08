# Install

Two pieces: an **Aseprite extension** (so Aseprite can be driven) and an **MCP
server** (so your agent can drive it). The extension is the same in every case;
only the agent wiring differs.

## Requirements

- **Aseprite 1.3 or newer.** The Lua WebSocket API this depends on does not
  exist in 1.2.
- **Node 20.10 or newer.**
- Aseprite must have been **run at least once**, so its config directory exists.

## 1. Install the Aseprite extension

```bash
npx @with-pebbly/aseprite-ai-artist install-extension
```

Then **restart Aseprite**. It connects on startup.

If the config directory cannot be found, the command prints where it looked;
pass `--dir <path>` to override. On macOS it is
`~/Library/Application Support/Aseprite`, on Windows `%APPDATA%\Aseprite`, on
Linux `~/.config/aseprite`.

## 2. Wire up your agent

### Everything at once

```bash
npx @with-pebbly/aseprite-ai-artist install --all --agents
```

Writes config for Claude Code, Codex, Gemini CLI, Cursor, VS Code and Windsurf,
and adds an `AGENTS.md` section for the clients that read one. Existing config
files are backed up first (`.bak-<timestamp>`), and `--dry-run` prints the change
without making it.

### Claude Code

The plugin is the better route — it brings the `/pixel-*` skills, the specialist
subagents and the hooks, not just the tools:

```
/plugin marketplace add with-pebbly/aseprite-ai-artist
/plugin install aseprite-ai-artist
```

Or wire the server alone:

```bash
npx @with-pebbly/aseprite-ai-artist install claude
```

### Codex CLI

```bash
npx @with-pebbly/aseprite-ai-artist install codex
```

Writes `[mcp_servers.aseprite-ai-artist]` into `~/.codex/config.toml`. Codex uses
TOML — the JSON config from other clients will not work, which is a common
source of "it silently does nothing".

### Gemini CLI

```bash
npx @with-pebbly/aseprite-ai-artist install gemini
```

### Cursor

```bash
npx @with-pebbly/aseprite-ai-artist install cursor
```

### Project scope instead of user scope

```bash
npx @with-pebbly/aseprite-ai-artist install codex cursor --project
```

Writes into the current directory (`.codex/config.toml`, `.cursor/mcp.json`) so
the setup travels with the repository.

## 3. Check it

```bash
npx @with-pebbly/aseprite-ai-artist doctor
```

```
aseprite-ai-artist 0.1.0

✓ Aseprite config dir   /Users/you/Library/Application Support/Aseprite
✓ Bridge                 ws://127.0.0.1:9932
✓ Aseprite extension     0.1.0 on Aseprite 1.3.17-arm64
  features               draw_batch, recolor, validate, tileset, reference, filmstrip
✓ Active sprite          knight.aseprite
```

Then restart your agent so it picks up the new server, and ask it to call
`preflight`.

## Troubleshooting

**"Aseprite extension not connected"** — Aseprite is closed, or the extension is
not installed, or it was installed while Aseprite was running. Install, then
restart Aseprite. Check `Edit ▸ Preferences ▸ Extensions` for
`Aseprite AI Artist`.

To tell "never loaded" apart from "loaded but could not connect", look for the
marker the extension writes on startup:

```
<Aseprite config dir>/aseprite-ai-artist.status
```

No file at all means Aseprite never ran the script — the extension is not
installed or not enabled. `"state": "loaded"` means it ran but never reached the
bridge. `"state": "connected"` means the link is up and the problem is
elsewhere.

**A dialog is blocking startup** — Aseprite gates script access to the network
and filesystem, and a brand-new config directory also shows a first-run dialog.
Either will stop the extension from connecting until dismissed. If this is the
very first time Aseprite has run on this machine, open it once and dismiss
whatever it asks before installing.

**The agent draws nothing and reports success** — it is editing files on disk
instead of the live window. That should be impossible: every tool refuses with
`not_connected` and `doNotFallBackToDisk`. If you see it, please open an issue
with the transcript.

**Ports already in use** — something else owns 9931/9932. Move both:

```bash
npx @with-pebbly/aseprite-ai-artist install --all --plugin-port 9941 --control-port 9942
```

and set `ASEPRITE_AI_PLUGIN_PORT` in Aseprite's environment to match.

**A reconnect is not happening** — the extension's reconnect timer runs on
Aseprite's UI loop. Click the Aseprite window once. A connection that is already
live keeps working unfocused; only re-establishing a dropped one needs focus.

## Running from a checkout

```bash
git clone https://github.com/with-pebbly/aseprite-ai-artist
cd aseprite-ai-artist
npm install && npm run build
node dist/cli.js install --all
node dist/cli.js install-extension
```

## Uninstall

Delete the `aseprite-ai-artist` directory from Aseprite's `extensions` folder,
remove the server entry from your agent's config, and stop any running bridge
(`pkill -f "aseprite-ai-artist bridge"`).
