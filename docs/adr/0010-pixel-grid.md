# ADR-0010 — PixelGrid: the text grid is writable

**Status:** accepted · 2026-10-01

## Context

`look op="ascii"` already turns pixels into text, one glyph per pixel, and it is
the most exact view an agent has of its own work. The opposite direction did not
exist: to put pixels down, a model composed `ellipse`, `rect`, `line` and
`pixels` ops and found out afterwards what they added up to. That translation —
from "the head goes here" to a list of shape calls — is where silhouettes come
out lopsided, limbs change length between frames and local edits spill.

Models lay out character grids well enough to draw with, and badly enough that
the format has to be strict about it. Two findings shaped the decision:

- 2-D grids serialised row-major are hard for LLMs, and get harder as they grow
  and as objects stop being contiguous in the text
  ([Xu et al., 2023](https://arxiv.org/abs/2305.18354)); recognition of ASCII
  art falls from ~25% to ~3% from short to long samples
  ([ArtPrompt](https://arxiv.org/html/2402.11753v4)).
- Tokenisation does not respect cells: a run like `........` is not eight
  decisions to a BPE model, and delimiting cells changed ARC results
  substantially ([Mirchandani et al., 2023](https://arxiv.org/html/2307.04721v2);
  [Xu et al., Table 1](https://arxiv.org/html/2305.18354v2#S2.T1)).

## Decision

- **`draw` kind `grid`**: `x`, `y`, `legend` (one character → `#rrggbb`/`#rrggbbaa` or
  `null`), `rows`, `transparent` (`erase` | `skip`). An op on `draw`, not a new
  tool — ADR-0003's budget holds.
- **Same shape as `look op="ascii"`.** `.` is transparent in both. `look`
  returns `gridRows`, `legend` and `origin`, and `rulers: false` prints the
  bare rows, so read → edit → write needs no reformatting. One raster format,
  not two.
- **Compiled in TypeScript**, like `text` (ADR-0005): transparent cells become
  `clear` rectangles (runs merged across rows), painted cells one `pixels` op
  per colour. The Lua side learns nothing new; live and headless share it.
  `selectionOnly` had to become real for every op in the same change — it
  clipped only `pixels`, so a grid's erase would have ignored the selection its
  paint respected.
- **Strict, located errors.** A ragged row or an undeclared character is
  refused with its row, column and sprite coordinates. Padding or truncating
  would shift every pixel right of the mistake and report success.
- **`erase` is the default**: the grid's rectangle ends up exactly as written,
  which is what an edit of a region read from `look` means. `skip` stamps.

## Consequences

**Good.** The model sees the whole shape while writing it, and edits are local
by construction: rows it did not change land exactly where they were. Frame N+1
can start as frame N's rows, which keeps volume from drifting across a cycle.

**Good.** The compiler is pure and unit-tested; the round trip is tested against
a real headless Aseprite.

**Bad.** Large grids reintroduce the counting problem the research describes. The
skills steer to grids up to ~32 wide and one grid per part beyond that. The
hard cap is the canvas: `look ascii` reads it whole and `draw` kind `grid`
takes up to its size, so the read and write halves bound the same thing.

**Amended (0.6.0): glyphs follow the palette.** Glyph *n* is palette entry *n*
on every read, so pieces of one sprite share a legend and the rows of one piece
draw back correctly with another's. Assigning glyphs per read made the same
letter two colours in neighbouring regions — a paste that recoloured art and
reported success. Colours outside the palette take the slots after it and are
listed in `offPalette`; only those can change between reads. The alphabet is
ASCII first, then Latin-1 and Latin Extended-A letters, 261 in all, so a full
256-colour palette fits.

**Amended (0.8.4): one copy per read.** `look ascii` no longer returns the ruled
`text` and `gridRows` together — clients that hand `structuredContent` to the
model paid for the grid twice. With rulers (the default) it returns `text`;
`rulers: false` returns `gridRows`, which is what the read → edit → write loop
uses. `draw` kind `grid` also takes the rows from a `file`, and op `image` takes
a 1× PNG, so rows a script produced need not be retyped.

**Deferred, on purpose.** Cell separators (`O O S S`) have evidence for reading
ARC grids but double the tokens, and nothing shows they help a model *write*
pixel art. Run-length encoding and row labels in the writable form have no
evidence either way. Each would be a schema field paid for on every turn, so
they wait for a benchmark run (ADR-0006) that compares compact rows against
them.

## Revisit when

Benchmark runs show grid-drawn sprites losing to shape-drawn ones, or a
separator/RLE variant beating compact rows on the same prompts.
