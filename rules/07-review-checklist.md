# Review checklist

Run this before telling anyone a sprite is finished. `validate` covers the
mechanical half; the rest needs you to actually look.

## Mechanical — run `validate`

- [ ] No off-palette colours
- [ ] No semi-transparent pixels
- [ ] No isolated single pixels
- [ ] Animation frames are tagged
- [ ] Frame timing is not uniform across a whole cycle
- [ ] Sprite has been saved

## By eye — run `look` op `preview`

- [ ] **Silhouette reads.** Recognisable as one flat shape.
- [ ] **Value contrast carries it.** Still readable desaturated.
- [ ] **Light is consistent.** One direction, everywhere.
- [ ] **Ramps are ramps.** Shading hue-shifts; nothing is just "darker".
- [ ] **Lines are clean.** Even runs, no doubled pixels, no accidental jaggies.
- [ ] **Outline style is consistent.** One choice, applied throughout.
- [ ] **No banding.** No long parallel stripes of adjacent ramp steps.
- [ ] **Detail is where it matters.** The face, the weapon — not the boots.

## By eye — run `look` op `ascii` when something looks subtly off

The text grid is where you find the pixel that is one row too low, the run of
3 in a line of 2s, the stray colour that survived a snap.

## For animation — run `look` op `filmstrip`

- [ ] Volume is consistent frame to frame
- [ ] Height is consistent (except deliberate squash)
- [ ] The cycle loops cleanly
- [ ] Contact poses hold longer than pass poses
- [ ] There is anticipation before any strong action

## Before handing over

- [ ] Tags named the way the engine expects (`idle`, `walk`, `attack`)
- [ ] Exported at the size and layout the user asked for
- [ ] Spritesheet has its JSON atlas if the engine needs one
- [ ] Working `.aseprite` saved, not just the export

## Reporting

Say what you checked and what you found, not "done". If something is a
compromise — a colour that had to move a long way, a pose you could not fit in
the pixel budget — say that too. A user can fix a stated compromise; they cannot
fix one you hid.
