"""Minimal PNG reader (8-bit RGB / RGBA / indexed, filters 0-4) so the model
can be diffed against Aseprite's CLI export without Pillow."""
import zlib, struct

def read_png(path):
    """Return (w, h, rows) where rows[y][x] = (r, g, b, a)."""
    with open(path, "rb") as f:
        data = f.read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", path
    pos = 8
    idat = b""; plte = None; trns = None
    while pos < len(data):
        n = struct.unpack(">I", data[pos:pos+4])[0]
        tag = data[pos+4:pos+8]; body = data[pos+8:pos+8+n]
        if tag == b"IHDR":
            w, h, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", body)
            assert depth == 8 and interlace == 0, (depth, interlace)
        elif tag == b"PLTE": plte = [tuple(body[i:i+3]) for i in range(0, len(body), 3)]
        elif tag == b"tRNS": trns = body
        elif tag == b"IDAT": idat += body
        elif tag == b"IEND": break
        pos += 12 + n
    raw = zlib.decompress(idat)
    bpp = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    stride = w * bpp
    rows = []; prev = bytearray(stride); p = 0
    for y in range(h):
        ft = raw[p]; p += 1
        cur = bytearray(raw[p:p+stride]); p += stride
        for i in range(stride):
            a = cur[i-bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i-bpp] if i >= bpp else 0
            if ft == 1: cur[i] = (cur[i] + a) & 255
            elif ft == 2: cur[i] = (cur[i] + b) & 255
            elif ft == 3: cur[i] = (cur[i] + ((a + b) >> 1)) & 255
            elif ft == 4:
                pa = abs(b - c); pb = abs(a - c); pc = abs(a + b - 2*c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                cur[i] = (cur[i] + pr) & 255
        out = []
        for x in range(w):
            px = cur[x*bpp:(x+1)*bpp]
            if ctype == 2: out.append((px[0], px[1], px[2], 255))
            elif ctype == 6: out.append((px[0], px[1], px[2], px[3]))
            elif ctype == 3:
                r, g, b_ = plte[px[0]]
                a_ = trns[px[0]] if trns and px[0] < len(trns) else 255
                out.append((r, g, b_, a_))
            elif ctype == 0: out.append((px[0], px[0], px[0], 255))
            elif ctype == 4: out.append((px[0], px[0], px[0], px[1]))
        rows.append(out); prev = cur
    return w, h, rows
