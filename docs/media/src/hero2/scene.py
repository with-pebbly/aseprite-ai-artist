"""hero2 scene model: every layer of every frame as a 192x96 grid of palette
indices (or -1 = transparent). Rendered locally for review, then pushed to
Aseprite through the MCP draw tool (see emit_ops)."""
import math, zlib, struct, json, os

W, H = 192, 96
NF = 36
PAL = ["#07111f","#102235","#173d4b","#275a62","#3b9c98","#8de2d1",
       "#111827","#263847","#45626c","#7899a2","#bcd7d4",
       "#442634","#7d3f31","#c96834","#f2a54b","#ffe0a3"]
RGB = [tuple(int(c[i:i+2],16) for i in (1,3,5)) for c in PAL]
(NAVY0, NAVY1, TEAL0, TEAL1, TEAL2, TEAL3,
 INK, SLATE0, SLATE1, SLATE2, PALE,
 MAROON, BROWN, ORANGE, AMBER, CREAM) = range(16)

def grid():
    return [[-1]*W for _ in range(H)]

def put(g, x, y, c):
    if 0 <= x < W and 0 <= y < H:
        g[y][x] = c

def rect(g, x0, y0, x1, y1, c):
    for y in range(y0, y1+1):
        for x in range(x0, x1+1):
            put(g, x, y, c)

def hline(g, x0, x1, y, c): rect(g, x0, y, x1, y, c)
def vline(g, x, y0, y1, c): rect(g, x, y0, x, y1, c)

def stamp_line(pts, x0, y0, x1, y1, size):
    """Collect pixels of a thick segment by stamping size×size squares along it."""
    n = max(abs(x1-x0), abs(y1-y0), 1)
    n = int(math.ceil(n))
    half = (size-1)/2.0
    for i in range(n+1):
        t = i/n
        cx = x0 + (x1-x0)*t
        cy = y0 + (y1-y0)*t
        bx = int(math.floor(cx - half + 0.5))
        by = int(math.floor(cy - half + 0.5))
        for dy in range(size):
            for dx in range(size):
                pts.add((bx+dx, by+dy))

def dilate(pts):
    out = set()
    for (x,y) in pts:
        for dx,dy in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
            out.add((x+dx,y+dy))
    return out

def disc(cx, cy, r):
    pts = set()
    for y in range(int(cy-r-1), int(cy+r+2)):
        for x in range(int(cx-r-1), int(cx+r+2)):
            if (x-cx)**2 + (y-cy)**2 <= r*r:
                pts.add((x,y))
    return pts

def bayer(x, y):
    m = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]]
    return m[y%4][x%4]/16.0

def composite(layers):
    out = [[0]*W for _ in range(H)]
    for g in layers:
        for y in range(H):
            row = g[y]; orow = out[y]
            for x in range(W):
                v = row[x]
                if v >= 0: orow[x] = v
    return out

def write_png(path, img, scale=4):
    h = len(img); w = len(img[0])
    raw = bytearray()
    for y in range(h):
        for _ in range(scale):
            raw.append(0)
            for x in range(w):
                raw += bytes(RGB[img[y][x]]) * scale
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag+data) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w*scale, h*scale, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f: f.write(png)

def filmstrip(frames, cols=6, scale=1, gap=2):
    rows = (len(frames)+cols-1)//cols
    img = [[INK]*((W+gap)*cols) for _ in range((H+gap)*rows)]
    for i, fr in enumerate(frames):
        ox = (i%cols)*(W+gap); oy = (i//cols)*(H+gap)
        for y in range(H):
            for x in range(W):
                img[oy+y][ox+x] = fr[y][x]
    return img

# ------------------------------------------------------------------ emit ops
def emit_ops(g):
    """Greedy run-length → rect ops (each row's runs merged vertically when identical)."""
    ops = []
    singles = {}
    used = [[False]*W for _ in range(H)]
    for y in range(H):
        x = 0
        while x < W:
            c = g[y][x]
            if c < 0 or used[y][x]:
                x += 1; continue
            x1 = x
            while x1+1 < W and g[y][x1+1] == c and not used[y][x1+1]:
                x1 += 1
            # extend downward while the same run exists
            y1 = y
            while y1+1 < H and all(g[y1+1][xx] == c and not used[y1+1][xx] for xx in range(x, x1+1)):
                y1 += 1
            for yy in range(y, y1+1):
                for xx in range(x, x1+1):
                    used[yy][xx] = True
            if x1 == x and y1 == y:
                singles.setdefault(c, []).append({"x":x,"y":y})
            else:
                ops.append({"kind":"rect","color":PAL[c],"fill":PAL[c],
                            "rect":{"x":x,"y":y,"width":x1-x+1,"height":y1-y+1}})
            x = x1+1
    for c, pts in singles.items():
        ops.append({"kind":"pixels","color":PAL[c],"points":pts})
    return ops
