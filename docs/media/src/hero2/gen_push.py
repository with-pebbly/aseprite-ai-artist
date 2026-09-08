"""Ops to push frames NPAINT+1..NF into the live document, assuming those frames
were created as duplicates of frame NPAINT (so static layers are already right)."""
import json, os
import build
from build import *

FULL = {"x": 0, "y": 0, "width": W, "height": H}
def blit(src): return {"kind": "blit", "from": FULL, "fromFrame": src, "to": {"x": 0, "y": 0}}
CLEAR = {"kind": "clear"}
GLOW_SRC = {1: 16, 2: 17, 3: 18, 4: 21}
HEAD_SRC = {"focus_up": 1, "focus": 11, "focus_down": 25, "blink": 10, "happy": 34}

os.makedirs("push", exist_ok=True)
manifest = []
lidded_first = None
for f in range(NPAINT+1, NF+1):
    layers, _ = build.build_frame(f)
    plan = {}
    # arm
    if f == NF: plan["Robot Arm"] = [CLEAR, blit(1)]
    elif f != NPAINT+1: plan["Robot Arm"] = [CLEAR] + emit_ops(layers["Robot Arm"])
    # sparkle
    plan["Sparkle"] = [CLEAR] + emit_ops(layers["Sparkle"])
    # head
    face = head_state(f)[0]
    if face in HEAD_SRC: plan["Robot Head"] = [CLEAR, blit(HEAD_SRC[face])]
    elif lidded_first is None:
        lidded_first = f; plan["Robot Head"] = [CLEAR] + emit_ops(layers["Robot Head"])
    else: plan["Robot Head"] = [CLEAR, blit(lidded_first)]
    # painting
    rects = cleared_rects(f)
    if f >= 52: plan["Painting"] = [CLEAR]
    elif rects:
        plan["Painting"] = [{"kind": "clear", "region": {"x": CX+x0, "y": CY+y0, "width": x1-x0+1, "height": y1-y0+1}}
                            for (x0, x1, y0, y1) in rects]
    # glow
    lvl = glow_level(f)
    if lvl != glow_level(f-1) or f > NPAINT+2:
        plan["Light Glow"] = [CLEAR] + ([blit(GLOW_SRC[lvl])] if lvl else [])
    if lvl == glow_level(NPAINT) and f <= NPAINT+2: plan.pop("Light Glow", None)
    for layer, ops in plan.items():
        path = f"push/{f:02d}_{layer.replace(' ', '_')}.json"
        json.dump(ops, open(path, "w"), separators=(",", ":"))
        manifest.append((f, layer, len(ops), os.path.getsize(path)))
for m in manifest: print(*m)
print("files:", len(manifest), "bytes:", sum(m[3] for m in manifest))
