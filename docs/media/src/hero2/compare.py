"""Diff the model's composite against Aseprite's CLI export, frame by frame."""
import sys, os
from pngio import read_png
import build
from scene import *

def compare(dirpath, frames, verbose=True):
    bad = 0
    for f in frames:
        w, h, rows = read_png(os.path.join(dirpath, f"f{f}.png"))
        layers, _ = build.build_frame(f)
        comp = composite([layers[k] for k in build.ORDER])
        diffs = []
        for y in range(H):
            for x in range(W):
                exp = RGB[comp[y][x]] + (255,)
                if rows[y][x] != exp:
                    diffs.append((x, y, rows[y][x], comp[y][x]))
        if diffs:
            bad += 1
            if verbose: print(f"frame {f}: {len(diffs)} px differ, first:", diffs[:6])
    print(f"{len(frames)} frames compared, {bad} differ")
    return bad

if __name__ == "__main__":
    d = sys.argv[1]; n = int(sys.argv[2])
    compare(d, range(1, n+1))
