# Layers and rigging

## Split before you animate, not after

Pixels baked into one layer cannot be animated without redrawing them. Separating
a finished sprite into limbs later is more work than building it separated. If
the sprite will ever move, rig it first.

## The standard character rig

Bottom to top in the layer stack, so nearer parts draw over farther ones:

```
  arm-near          ← the arm on the camera side
  leg-near
  head
  torso
  arm-far           ← partly hidden by the torso; this is what sells depth
  leg-far
  shadow            ← ground contact, if the style has one
```

Add `weapon`, `cape`, `hair-back` and `hair-front` as the design needs. Keep the
names stable — every later tool call refers to them by name.

Build the whole rig in one `layer` call with a `batch` array; that is one undo
step for the user and one round trip for you.

## Groups

Group related layers (`arms`, `legs`) once the count passes about eight. Groups
hold no pixels themselves — target their children when drawing.

## Cels

A **cel** is one layer's image on one frame. Cels are only as big as their
content, which is why moving a limb between frames is `cel` op `move` (cheap,
lossless) rather than redrawing it.

**Linked cels** share one image across several frames: edit once, every linked
frame updates. Use them for parts that genuinely do not move in a cycle — a
static torso under moving arms. Do not link something you will later want to
differ; unlinking after the fact loses the shared history.

## Non-destructive habits

- Keep a `reference` layer locked and semi-transparent while tracing; delete it
  before export.
- Keep sketch/blockout on its own layer until the clean pass is done.
- Never merge layers to "simplify" unless the user asked. The layer split is the
  sprite's editability.
- Hide layers rather than deleting them when trying an alternative.
