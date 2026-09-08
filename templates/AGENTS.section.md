## Pixel art in Aseprite

This project has `aseprite-ai-artist` wired in as an MCP server. It draws into
the Aseprite window that is open on this machine — not into files on disk.

**Before any pixel-art work:**

1. Call `preflight`. If `ready` is false, stop and tell the person. Do **not**
   fall back to editing `.aseprite` or `.png` files directly: they would not see
   the change in their open editor, and their next save would overwrite it.
2. Call `sprite_info`. Layer names, frame count and palette come from the
   document, never from assumption.
3. Read the workflow that matches the task. The server exposes them as MCP
   resources — `skill://pixel-draw`, `skill://pixel-animate`,
   `skill://pixel-review` and others — and the craft rules as `rules://index`.
   Start with `rules://00-core-principles`.

**While working:**

- **Batch.** One `draw` call carrying every operation is correct; forty calls
  carrying one each is wrong. Every call is one undo step for the person.
- **Look at your work.** After drawing, call `look` — op `preview` for the
  overall read, op `ascii` for exact pixel positions, op `filmstrip` to review
  an animation. A tool result saying "412 pixels changed" is not evidence that
  the sprite is right.
- **Keep the palette.** `draw` and `recolor` snap colours to the sprite's
  palette by perceptual distance. If a colour you want is far from every palette
  entry, say so and ask before widening the palette.
- **Do not change what was not asked about.** No resizing, re-indexing,
  flattening or overwriting without a request.

**Before saying anything is finished:** call `validate`, fix every error, and
report the warnings you chose not to fix along with the reason.
