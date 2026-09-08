# Outlines and edges

## Choose one outline style and hold it

| Style | What it is | Use when |
|-------|-----------|----------|
| **None** | Shapes defined by colour alone | Backgrounds, high-colour art |
| **Full black** | Every edge outlined in one dark colour | Icons, high-contrast game art |
| **Selective** | Outline only where the shape meets the background | The usual choice for characters |
| **Coloured** | Outline is a dark version of the fill it borders | Soft, painterly look |

Selective outlining — outline on the outside, none between internal shapes — is
what most sprites want. It keeps the silhouette crisp without turning the
interior into a colouring book.

Pure black outlines on everything read as harsh and flatten the form. A very dark
version of the sprite's own colours nearly always looks better.

## Clean lines

A pixel line is clean when its segment lengths are consistent: 2,2,2,2 or
4,4,4,4 — not 3,2,4,1. Inconsistent runs produce the jagged look people call
"jaggies", and they are the difference between a hand-drawn-looking curve and a
computed one.

- A 45° line is one pixel per step.
- A shallow line is a run of N, then N, then N. Keep N the same.
- Never place a single pixel that breaks an otherwise even run.

`draw` op `line` uses Bresenham, which is even by construction. Hand-placed
`pixels` ops are where runs go wrong — check them with `look` op `ascii`.

## Doubles and corners

Avoid **doubled pixels** on a diagonal: two pixels side by side inside a line
that is otherwise single-width. They read as a lump.

At a corner, one pixel is a sharp corner and two is a rounded one. Pick
deliberately and be consistent across the sprite.

## Banding

Banding is when two ramp steps run parallel for a long stretch, creating a
visible stripe that reads as a contour line rather than a curved surface. Break
it by letting the boundary between steps wander, or by dithering a short section
of it.
