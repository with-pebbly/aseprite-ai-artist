# Animation

## Timing is the performance

Frame durations carry more of the life in a cycle than the drawings do. Uniform
timing reads mechanical no matter how good the poses are.

Rules of thumb, at 60fps-equivalent thinking but expressed in milliseconds:

| Cycle | Frames | Typical timing |
|-------|--------|----------------|
| Idle (breathing) | 2–4 | 200–400ms each, slow |
| Walk | 4–8 | 100–150ms; hold contact poses longer |
| Run | 6–8 | 60–100ms |
| Attack | 3–6 | Fast on the strike (40–60ms), long on the hold (150–250ms) |

Set a whole cycle at once: `frame` op `set_duration` with a `durations` array.

## Key poses first

Draw the extremes, then the in-betweens. Never animate by nudging pixels frame
to frame — drift accumulates and by frame six the character is a different size.

A walk cycle's canonical poses:

1. **Contact** — front foot lands, back foot pushing off. Widest stance.
2. **Down** — weight over the front leg, body at its **lowest**.
3. **Pass** — legs together, body at its **highest**. This is the frame people
   forget, and its absence is why a walk looks like sliding.
4. **Up** — pushing off, rising.

Then mirror all four for the other leg: 8 frames. A 4-frame walk uses contact
and pass for each leg.

## The principles that survive at 16 pixels

- **Anticipation** — a small movement opposite to the action before it. One
  frame of crouch before a jump. Skipping it makes everything feel weightless.
- **Follow-through** — hair, cloak and weapon keep moving after the body stops.
- **Squash and stretch** — sparingly, and only where a material would deform.
- **Arcs** — a hand travels along a curve, never a straight line.
- **Overlap** — parts do not all start and stop together.

Easing does not exist frame-by-frame; you get it from **spacing**. Poses close
together = slow; far apart = fast. That is the whole trick.

## Working method

1. `rig` the character onto separate layers first (see `rules://06-layers-and-rigging`).
2. Block in the key poses on their own frames. Look at them as a filmstrip.
3. Add in-betweens only once the keys read.
4. Set timing.
5. Tag the cycle. Untagged frames are unusable by a game engine.
6. Review with `look` op `filmstrip` — a vision model reads only the first
   frame of a GIF, so a filmstrip is the only way to actually see the motion.

## Cross-frame checks

- Does the character stay the same height? (Except deliberate squash.)
- Do limbs keep the same thickness?
- Does the light stay in the same place?
- Does the cycle loop — is frame N a plausible predecessor of frame 1?
