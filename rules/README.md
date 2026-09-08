# Rules

The pixel-art craft this project encodes. One source of truth, consumed three
ways:

- **Claude Code** reads these files directly from the plugin.
- **Every other MCP client** reads them as `rules://` resources served by the
  MCP server, so Codex, Gemini CLI and Cursor get the same discipline.
- **The tools themselves** implement the mechanical parts — palette snapping,
  hue-shifted shading, the validation checks — so an agent that never reads a
  word of this still cannot casually break the palette.

Read `rules://index` for the list, or start at `00-core-principles.md`.

Changing a rule here changes behaviour everywhere. Skills reference rules by
name rather than restating them, so a rule has exactly one place to be wrong.
