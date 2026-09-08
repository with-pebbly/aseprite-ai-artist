# Skills

Workflows an agent follows, in the order that catches mistakes while they are
still cheap. Each one is a procedure, not a description.

They are served three ways from this one directory:

- **Claude Code** loads them as plugin skills (`/aseprite-ai-artist:pixel-draw`).
- **Any MCP client** reads them as `skill://` resources and can invoke them as
  MCP prompts — so Codex, Gemini CLI and Cursor get the same workflows.
- **The server instructions** list them, so an agent knows they exist without
  being told.

| Skill | Use when |
|-------|----------|
| `pixel-brief` | The request is open-ended and needs decisions before drawing |
| `pixel-new` | Starting a fresh document |
| `pixel-palette` | Choosing, building or repairing colours |
| `pixel-draw` | The main drawing work |
| `pixel-shade` | Flat art needs volume |
| `pixel-rig` | A character needs to be animatable |
| `pixel-animate` | Building a cycle |
| `pixel-tileset` | Level art and anything that repeats |
| `pixel-review` | Before saying anything is finished |
| `pixel-fix` | Editing art that already exists |
| `pixel-export` | Handing files to a game engine |

Skills reference `rules://` rather than restating craft, so a rule has exactly
one place to be wrong.
