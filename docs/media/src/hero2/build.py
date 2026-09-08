from scene import *
import math

# ---------------------------------------------------------------- layout
FLOOR_Y = 64
CANVAS = (92, 33, 40, 32)          # interior x, y, w, h
CX, CY, CW, CH = CANVAS
FRAME = (90, 31, 133, 66)          # outer frame x0,y0,x1,y1
SHOULDER = (72, 58)
LAMP_X = 111
ROBOT_DX = -3
EASEL_DX = 3
STOOL_DX = -3

def shifted(g, dx, dy=0):
    out = grid()
    for y in range(H):
        for x in range(W):
            v = g[y][x]
            if v >= 0: put(out, x+dx, y+dy, v)
    return out

# ---------------------------------------------------------------- backdrop
def backdrop():
    g = grid()
    rect(g, 0, 0, W-1, FLOOR_Y-1, NAVY0)
    rect(g, 0, FLOOR_Y, W-1, H-1, TEAL0)
    hline(g, 0, W-1, FLOOR_Y-1, NAVY1)                 # baseboard shadow line
    # lamp cone on the wall
    bx, by = LAMP_X + 0.5, 15.0  # bulb centre
    for y in range(14, FLOOR_Y-1):
        w = 6 + (y-14)*0.55
        for x in range(W):
            d = abs(x+0.5-bx)
            if d <= w:
                edge = w - d
                r = math.hypot(x+0.5-bx, y+0.5-by)
                if r <= 6:
                    put(g, x, y, SLATE0)
                elif edge < 2.5:
                    if bayer(x, y) < edge/2.5: put(g, x, y, NAVY1)
                else:
                    put(g, x, y, NAVY1)
    # floorboards
    for yy in (70, 77, 84, 91):
        hline(g, 0, W-1, yy, NAVY1)
    joints = {65:(30,110,170), 71:(60,140), 78:(20,95,150), 85:(50,120,180), 92:(80,160)}
    for y0, xs in joints.items():
        for x in xs:
            vline(g, x, y0, y0+3 if y0+3 < H else H-1, NAVY1)
    # lamp light pool on the floor
    for y in range(FLOOR_Y, H):
        for x in range(W):
            nx = (x+0.5-(LAMP_X+0.5))/31.0; ny = (y+0.5-80.0)/13.5
            r = nx*nx + ny*ny
            if r <= 1.0:
                if r > 0.72:
                    if bayer(x, y) < (1.0-r)/0.28: 
                        if g[y][x] == TEAL0: put(g, x, y, TEAL1)
                elif g[y][x] == TEAL0:
                    put(g, x, y, TEAL1)
    # pendant lamp
    vline(g, LAMP_X, 0, 7, SLATE0)
    L = LAMP_X - 108
    shade = [(8,106,111),(9,105,112),(10,104,113),(11,103,114),(12,102,115),(13,102,115)]
    for y, x0, x1 in shade:
        hline(g, x0+L, x1+L, y, MAROON)
        put(g, x1+L, y, BROWN)
    hline(g, 103+L, 114+L, 13, BROWN)         # lit inner rim
    rect(g, 108+L, 14, 109+L, 15, CREAM)      # bulb
    for (x,y) in ((107,14),(107,15),(110,14),(110,15),(108,16),(109,16)):
        put(g, x+L, y, AMBER)
    for (x,y) in ((106,15),(111,15),(107,16),(110,16),(108,17),(109,17),(106,14),(111,14)):
        put(g, x+L, y, ORANGE)
    # stool with jars (left)
    g_main = g; g = grid()
    hline(g, 14, 38, 68, ORANGE); rect(g, 14, 69, 38, 70, BROWN); hline(g, 15, 37, 71, MAROON)
    for lx in (16, 34):
        rect(g, lx, 72, lx+2, 83, BROWN); vline(g, lx, 72, 83, MAROON)
    rect(g, 19, 78, 33, 79, MAROON)
    # brush pot
    rect(g, 17, 58, 26, 67, INK); rect(g, 18, 59, 25, 67, SLATE1); rect(g, 19, 60, 20, 66, SLATE2); hline(g, 18, 25, 59, SLATE2)
    for x, y0, hc, tc in ((20, 52, ORANGE, TEAL2), (22, 49, BROWN, AMBER), (24, 53, ORANGE, TEAL3)):
        vline(g, x, y0, 58, hc); put(g, x, y0-1, PALE); put(g, x, y0-2, tc)
    # paint can
    rect(g, 27, 60, 36, 67, INK); rect(g, 28, 61, 35, 67, AMBER); vline(g, 29, 62, 67, CREAM); vline(g, 35, 62, 67, ORANGE); hline(g, 28, 35, 61, MAROON)
    # can label
    rect(g, 30, 64, 33, 66, PALE); hline(g, 30, 33, 65, ORANGE)
    for x0, x1 in ((15, 19), (33, 37)):
        hline(g, x0, x1, 84, NAVY1)
    stool = shifted(g, STOOL_DX); g = g_main
    for y in range(H):
        for x in range(W):
            if stool[y][x] >= 0: g[y][x] = stool[y][x]
    # potted plant in the right corner
    def leaf(cx, cy, rx, ry, hl=True):
        for y in range(cy-ry, cy+ry+1):
            for x in range(cx-rx, cx+rx+1):
                nx = (x-cx)/rx; ny = (y-cy)/ry
                if nx*nx+ny*ny <= 1.0:
                    put(g, x, y, TEAL1)
        if hl:
            for y in range(cy-ry, cy+1):
                for x in range(cx, cx+rx+1):
                    nx = (x-cx)/rx; ny = (y-cy)/ry
                    if 0.45 <= nx*nx+ny*ny <= 1.0 and g[y][x] == TEAL1 and (x+1 >= W or g[y][x+1] != TEAL1 or g[y-1][x] != TEAL1):
                        put(g, x, y, TEAL2)
    rect(g, 168, 60, 169, 75, BROWN); rect(g, 171, 56, 172, 75, BROWN); rect(g, 165, 64, 166, 75, BROWN)
    leaf(160, 60, 7, 4); leaf(178, 55, 8, 5); leaf(170, 48, 7, 5); leaf(158, 51, 6, 4); leaf(181, 64, 6, 4); leaf(168, 66, 8, 4, False)
    rect(g, 162, 74, 178, 76, BROWN); hline(g, 162, 178, 74, ORANGE)
    rect(g, 163, 77, 177, 83, MAROON); rect(g, 164, 77, 176, 83, BROWN); vline(g, 164, 77, 83, MAROON); vline(g, 176, 77, 83, MAROON)
    hline(g, 162, 178, 84, NAVY1)
    # contact shadows (robot / easel)
    hline(g, 43+ROBOT_DX, 72+ROBOT_DX, 84, NAVY1); hline(g, 45+ROBOT_DX, 70+ROBOT_DX, 85, NAVY1)
    for x0, x1 in ((83, 88), (129, 134), (106, 111)):
        hline(g, x0+EASEL_DX, x1+EASEL_DX, 84, NAVY1)
    return g

# ---------------------------------------------------------------- easel
def easel():
    g = grid()
    x0, y0, x1, y1 = (FRAME[0]-EASEL_DX, FRAME[1], FRAME[2]-EASEL_DX, FRAME[3])
    CX_, CY_, CW_, CH_ = CX-EASEL_DX, CY, CW, CH
    # mast + clamp
    rect(g, 108, 20, 110, 30, BROWN); vline(g, 108, 20, 30, MAROON); hline(g, 108, 110, 20, ORANGE)
    rect(g, 105, 28, 113, 30, MAROON); hline(g, 105, 113, 28, BROWN)
    # frame
    rect(g, x0, y0, x1, y1, BROWN)
    rect(g, x0, y0, x1, y0+1, ORANGE)      # lit top
    vline(g, x0, y0, y1, BROWN); vline(g, x0+1, y0+2, y1-2, BROWN)
    rect(g, x0, y1-1, x1, y1, MAROON)      # shadow bottom
    vline(g, x1, y0+2, y1, MAROON); vline(g, x1-1, y0+2, y1-2, MAROON)
    rect(g, CX_, CY_, CX_+CW_-1, CY_+CH_-1, CREAM)
    # tray
    rect(g, 85, 67, 132, 69, BROWN); hline(g, 85, 132, 67, ORANGE); hline(g, 85, 132, 69, MAROON)
    # legs (2px wide stair-steps) and back leg
    def leg(xa, ya, xb, yb, light):
        pts = set(); stamp_line(pts, xa, ya, xb, yb, 2)
        for (x,y) in pts: put(g, x, y, BROWN)
        # shadow side
        for (x,y) in pts:
            if (x-1,y) not in pts and not light: put(g, x, y, MAROON)
            if (x+1,y) not in pts and light: put(g, x, y, MAROON)
    rect(g, 108, 70, 109, 83, MAROON)
    rect(g, 89, 78, 128, 79, MAROON); hline(g, 89, 128, 78, BROWN)
    leg(92, 70, 85, 83, False)
    leg(125, 70, 132, 83, True)
    return shifted(g, EASEL_DX)

# ---------------------------------------------------------------- robot
def rrect(g, x0, y0, x1, y1, fill, outline):
    rect(g, x0, y0, x1, y1, outline)
    rect(g, x0+1, y0+1, x1-1, y1-1, fill)
    for (x,y) in ((x0,y0),(x1,y0),(x0,y1),(x1,y1)): put(g, x, y, -1)

def robot_body():
    g = grid()
    # feet
    for fx in (44, 61):
        rrect(g, fx, 80, fx+10, 83, SLATE1, INK); hline(g, fx+1, fx+9, 81, SLATE2)
    # legs
    for lx in (47, 64):
        rect(g, lx-1, 77, lx+5, 79, INK); rect(g, lx, 77, lx+4, 79, SLATE0)
    # torso
    rrect(g, 41, 54, 74, 76, SLATE1, INK)
    hline(g, 43, 72, 55, SLATE2); vline(g, 73, 56, 73, SLATE2)
    vline(g, 42, 56, 73, SLATE0); rect(g, 43, 74, 72, 75, SLATE0); put(g, 42, 74, SLATE0); put(g, 73, 74, SLATE0)
    # chest panel
    rect(g, 47, 59, 60, 69, SLATE0); hline(g, 47, 60, 59, INK); vline(g, 47, 59, 69, INK)
    rect(g, 50, 62, 51, 63, TEAL2); rect(g, 50, 66, 51, 67, ORANGE)
    for yy in (62, 64, 66): hline(g, 54, 58, yy, INK)
    hline(g, 43, 72, 72, SLATE0)
    # neck
    rect(g, 54, 51, 61, 53, INK); rect(g, 55, 51, 60, 53, SLATE0)
    return shifted(g, ROBOT_DX)

def robot_head(face="focus", ox=0, oy=0):
    g = grid()
    ox += ROBOT_DX
    def P(x, y, c): put(g, x+ox, y+oy, c)
    def R(x0, y0, x1, y1, c):
        for y in range(y0, y1+1):
            for x in range(x0, x1+1): P(x, y, c)
    # antenna
    R(56, 25, 59, 30, INK); R(57, 25, 58, 30, SLATE0)
    R(55, 20, 60, 25, INK); R(56, 21, 59, 24, ORANGE); P(55,20,-1); P(60,20,-1); P(55,25,-1); P(60,25,-1)
    # ears
    R(41, 36, 44, 44, INK); R(42, 37, 43, 43, SLATE0)
    R(71, 36, 74, 44, INK); R(72, 37, 73, 43, SLATE2)
    # head box
    R(45, 31, 70, 50, INK); R(46, 32, 69, 49, SLATE1)
    for (x,y) in ((45,31),(70,31),(45,50),(70,50)): P(x, y, -1)
    R(47, 32, 68, 32, SLATE2); R(69, 33, 69, 48, SLATE2)
    R(46, 33, 46, 48, SLATE0); R(47, 49, 68, 49, SLATE0); P(46,49,SLATE0); P(69,49,SLATE0)
    # screen
    R(48, 35, 67, 45, INK); R(49, 36, 66, 44, TEAL0); R(49, 36, 66, 36, TEAL1)
    if face in ("focus", "focus_up", "focus_down"):
        ey = {"focus_up": 38, "focus": 39, "focus_down": 40}[face]
        R(54, ey, 56, ey+1, TEAL3); R(61, ey, 63, ey+1, TEAL3)
        R(57, 43, 60, 43, TEAL2)
    elif face == "blink":
        R(54, 40, 56, 40, TEAL3); R(61, 40, 63, 40, TEAL3)
        R(57, 43, 60, 43, TEAL2)
    elif face == "lidded":
        R(54, 40, 56, 40, TEAL2); R(61, 40, 63, 40, TEAL2)     # lids
        R(54, 41, 56, 41, TEAL3); R(61, 41, 63, 41, TEAL3)
        R(57, 44, 60, 44, TEAL2)                               # mouth one row lower
    elif face == "happy":
        R(53, 38, 55, 38, TEAL3); R(52, 39, 53, 39, TEAL3); R(55, 39, 56, 39, TEAL3)
        R(60, 38, 62, 38, TEAL3); R(59, 39, 60, 39, TEAL3); R(62, 39, 63, 39, TEAL3)
        R(54, 42, 55, 42, TEAL3); R(61, 42, 62, 42, TEAL3); R(55, 43, 61, 43, TEAL3)
    return g

# ---------------------------------------------------------------- arm
L1 = 18
L2MIN = 9
BEND = math.radians(25)
BRUSH = (8, -6)   # hand -> tip vector, length 10

PAD_W = 8          # eraser pad that slides out of the fist: PAD_W wide, 8 tall
PAD_TOP = -6       # pad rows Hy+PAD_TOP .. Hy+PAD_TOP+7 (fist centre row is Hy)
PAD_SMUDGE = [(3,2,TEAL2),(4,3,TEAL2),(5,1,AMBER),(2,4,TEAL1),(6,3,TEAL1),(4,5,TEAL2)]

def arm(tip, tipcolor):
    """Painting pose: brush tip at `tip`, hand 10 px behind it along BRUSH."""
    Tx, Ty = tip
    return arm_draw((Tx - BRUSH[0], Ty - BRUSH[1]), BRUSH, tipcolor)

def arm_draw(hand, bvec, tipcolor, pad=0, smudge=0):
    """hand = fist centre (sprite px); bvec = direction the brush stick points from
    the fist; pad = how many px of the eraser pad are out of the fist (0..PAD_W);
    smudge = 0..3 paint picked up by the pad."""
    g = grid()
    Sx, Sy = SHOULDER
    Hx, Hy = hand
    dx, dy = Hx - Sx, Hy - Sy
    d = math.hypot(dx, dy)
    phi = math.atan2(dy, dx)
    a = BEND
    c = (L1*L1 + d*d - L2MIN*L2MIN) / (2*L1*d)
    if c < 1:
        a = max(a, math.acos(max(-1, min(1, c))))
    Ex, Ey = Sx + L1*math.cos(phi+a), Sy + L1*math.sin(phi+a)
    L2 = math.hypot(Hx-Ex, Hy-Ey)
    upper, sleeve, rod, brush_h, ferrule, tipp = set(), set(), set(), set(), set(), set()
    stamp_line(upper, Sx, Sy, Ex, Ey, 5)
    sl = min(9.0, max(4.0, L2-3))
    ux, uy = (Hx-Ex)/L2, (Hy-Ey)/L2
    stamp_line(sleeve, Ex, Ey, Ex+ux*sl, Ey+uy*sl, 4)
    stamp_line(rod, Ex+ux*sl, Ey+uy*sl, Hx, Hy, 3)
    # brush: a 14px stick through the fist; hand sits 10px behind the tip
    bl = math.hypot(*bvec)
    bux, buy = bvec[0]/bl, bvec[1]/bl
    n = 28
    for i in range(n+1):
        s = -3.5 + 13.5*i/n          # distance from the hand centre along the stick
        px, py = Hx + bux*s, Hy + buy*s
        bx, by = int(math.floor(px)), int(math.floor(py))
        cells = {(bx,by),(bx+1,by),(bx,by+1),(bx+1,by+1)}
        if s <= 6.8: brush_h |= cells
        elif s <= 8.6: ferrule |= cells
        else: tipp |= cells
    hand = set((Hx+dx_, Hy+dy_) for dx_ in range(-2,3) for dy_ in range(-2,3)) - {(Hx-2,Hy-2),(Hx+2,Hy-2),(Hx-2,Hy+2),(Hx+2,Hy+2)}
    joint_s = disc(Sx, Sy, 2.3)
    joint_e = disc(round(Ex), round(Ey), 2.3)
    padc = set()
    if pad > 0:
        padc = {(x, y) for x in range(Hx+2, Hx+2+pad) for y in range(Hy+PAD_TOP, Hy+PAD_TOP+8)}
    solid = upper | sleeve | rod | hand | joint_s | joint_e | brush_h | ferrule | padc
    tipp -= solid
    for (x,y) in dilate(solid) - solid - tipp: put(g, x, y, INK)
    for (x,y) in upper: put(g, x, y, SLATE1)
    for (x,y) in upper:
        if (x,y-1) not in upper: put(g, x, y, SLATE2)
        elif (x,y+1) not in upper: put(g, x, y, SLATE0)
    for (x,y) in sleeve: put(g, x, y, SLATE1)
    for (x,y) in sleeve:
        if (x,y-1) not in sleeve: put(g, x, y, SLATE2)
        elif (x,y+1) not in sleeve: put(g, x, y, SLATE0)
    for (x,y) in rod: put(g, x, y, SLATE2)
    for (x,y) in joint_s: put(g, x, y, SLATE2)
    for (x,y) in joint_e: put(g, x, y, SLATE2)
    put(g, Sx, Sy-1, PALE); put(g, round(Ex), round(Ey)-1, PALE)
    for (x,y) in brush_h: put(g, x, y, ORANGE)
    for (x,y) in ferrule: put(g, x, y, PALE)
    if padc:
        py0 = Hy+PAD_TOP
        for (x,y) in padc:
            if y == py0: c = CREAM            # lit top
            elif y == py0+7 or x == Hx+2: c = SLATE2   # shadow bottom + bracket on the fist
            else: c = PALE
            put(g, x, y, c)
        for (dx, dy, c) in PAD_SMUDGE[:smudge*2]:
            if (Hx+2+dx, py0+dy) in padc: put(g, Hx+2+dx, py0+dy, c)
    for (x,y) in hand: put(g, x, y, SLATE2)
    for (x,y) in hand:
        if (x,y-1) not in hand: put(g, x, y, PALE)
    for (x,y) in tipp: put(g, x, y, tipcolor)
    return g, (Ex, Ey, L2)

# ---------------------------------------------------------------- painting
def sky1():  return {(x,y):TEAL1 for x in range(CW) for y in range(0,6)}
def sky2():
    t = {(x,y):TEAL2 for x in range(CW) for y in range(6,12)}
    for x in range(CW):
        if bayer(x,5) < 0.5: t[(x,5)] = TEAL2
    return t
def sky3():
    t = {(x,y):TEAL3 for x in range(CW) for y in range(12,24)}
    for x in range(CW):
        if bayer(x,11) < 0.5: t[(x,11)] = TEAL3
    return t
def sun():
    t = {}
    cx, cy = 30, 7
    for y in range(0, 16):
        for x in range(22, 40):
            r2 = (x-cx)**2 + (y-cy)**2
            if r2 <= 2.3**2: t[(x,y)] = CREAM
            elif r2 <= 4.3**2: t[(x,y)] = AMBER
            elif r2 <= 5.7**2: t[(x,y)] = ORANGE
    return t
def cloud2(): 
    t = {(x,8):CREAM for x in range(14,21)}
    t.update({(x,9):AMBER for x in range(16,22)})
    return t
def cloud1():
    t = {(x,3):CREAM for x in range(4,12)}
    t.update({(x,4):AMBER for x in range(6,14)})
    return t
def far_top(x):  return 20 - round(6*math.sin(math.pi*(x-10)/34))
def near_top(x): return 25 - round(5*math.sin(math.pi*(x+8)/56))
def far_hill():
    t = {}
    for x in range(10, CW):
        for y in range(far_top(x), 24): t[(x,y)] = TEAL1
    return t
def near_hill():
    t = {}
    for x in range(CW):
        for y in range(near_top(x), CH): t[(x,y)] = TEAL0
    return t
def crest():
    t = {}
    for x in range(14, CW):
        t[(x, near_top(x))] = TEAL2
        t[(x, near_top(x)+1)] = TEAL1
    return t
def signature():
    return {(35,28):AMBER, (34,29):AMBER, (35,29):AMBER, (36,29):AMBER}

# pass name, target, colour, list of (frame, tip(canvas), dab x0,x1,y0,y1)
def dabs(frames, xs, y0, y1, ty, w=8):
    return [(f, (x+w//2, ty), (x, x+w-1, y0, y1)) for f, x in zip(frames, xs)]
PASSES = [
    ("sky1", sky1(), TEAL1, dabs(range(1,6),  [0,8,16,24,32], 0, 5, 3)),
    ("sky2", sky2(), TEAL2, dabs(range(6,11), [32,24,16,8,0], 5, 11, 8)),
    ("sky3", sky3(), TEAL3, dabs(range(11,16),[0,8,16,24,32], 11, 23, 17)),
    ("sun",  sun(),  AMBER, [(16,(30,5),(23,37,0,7)), (17,(30,9),(23,37,8,14))]),
    ("cloud2", cloud2(), CREAM, [(18,(17,8),(13,22,7,10))]),
    ("cloud1", cloud1(), CREAM, [(19,(11,3),(9,14,2,5)), (20,(5,3),(3,8,2,5))]),
    ("far",  far_hill(), TEAL1, [(21,(13,17),(10,16,12,23)), (22,(20,16),(17,23,12,23)), (23,(27,15),(24,31,12,23)), (24,(35,17),(32,39,12,23))]),
    ("near", near_hill(), TEAL0, [(25,(36,26),(32,39,19,31)), (26,(28,25),(24,31,19,31)), (27,(20,24),(16,23,19,31)), (28,(12,25),(8,15,19,31)), (29,(4,26),(0,7,19,31))]),
    ("crest", crest(), TEAL2, [(30,(16,near_top(16)+1),(14,19,18,26)), (31,(24,near_top(24)+1),(20,28,18,26)), (32,(34,near_top(34)+1),(29,39,18,26))]),
    ("sig",  signature(), AMBER, [(33,(35,29),(33,37,27,30))]),
]

def tip_for_frame(f):
    """Tip in sprite coords and current paint colour for frame f (1-based)."""
    last = None
    for name, tgt, col, lst in PASSES:
        for (fr, tip, dab) in lst:
            if fr <= f: last = (tip, col)
    tip, col = last
    return (CX+tip[0], CY+tip[1]), col

def painting(f):
    g = grid()
    for name, tgt, col, lst in PASSES:
        mask = [d for (fr, tip, d) in lst if fr <= f]
        if not mask: continue
        for (x,y), c in tgt.items():
            if any(x0 <= x <= x1 and y0 <= y <= y1 for (x0,x1,y0,y1) in mask):
                put(g, CX+x, CY+y, c)
    return g

# ---------------------------------------------------------------- glow / fx
# ---------------------------------------------------------------- erase phase (frames 37..54)
NPAINT = 36                     # frames 1..36 are the painting + hold, untouched
# frame -> (hand, brush vector, pad px out, smudge, face)
#   hand y for a pad row y0 on the canvas is CY + y0 - PAD_TOP; hand x is CX + x0 - 2
def _hand(x0, y0): return (CX + x0 - 2, CY + y0 - PAD_TOP)
ERASE = {
    37: ((119, 68), (8, -6),  0, 0, "focus"),     # smile fades, still at the signature
    38: ((107, 58), (5, -9),  0, 0, "focus_up"),  # lifts off, brush starts turning
    39: ((95, 48),  (1, -10), 4, 0, "focus_up"),  # pad slides out on the way up
    40: (_hand(-6, 0),  (-3, -10), 8, 0, "focus"),  # pad at the canvas edge: hesitation
    41: (_hand(16, 0),  (-3, -10), 8, 1, "lidded"),
    42: (_hand(32, 0),  (-3, -10), 8, 2, "lidded"),
    43: (_hand(32, 8),  (-3, -10), 8, 2, "lidded"),
    44: (_hand(16, 8),  (-3, -10), 8, 2, "lidded"),
    45: (_hand(0, 8),   (-3, -10), 8, 2, "lidded"),
    46: (_hand(0, 16),  (-3, -10), 8, 3, "lidded"),
    47: (_hand(16, 16), (-3, -10), 8, 3, "lidded"),
    48: (_hand(32, 16), (-3, -10), 8, 3, "lidded"),
    49: (_hand(32, 24), (-3, -10), 8, 3, "lidded"),
    50: (_hand(16, 24), (-3, -10), 8, 3, "lidded"),
    51: (_hand(0, 24),  (-3, -10), 8, 3, "lidded"),
    52: (_hand(-6, 22), (-3, -10), 8, 3, "focus"),  # lifts off the clean canvas
    53: ((86, 51),  (3, -9),  0, 0, "focus_up"),  # pad back in, brush swinging round
    54: ((88, 42),  (8, -6),  0, 0, "focus_up"),  # = frame 1 pose, canvas blank
}
NF = NPAINT + len(ERASE)
# pad footprint on the canvas per frame (canvas coords), None = pad not on the canvas
PAD_AT = {40: (-6, 0), 41: (16, 0), 42: (32, 0), 43: (32, 8), 44: (16, 8), 45: (0, 8),
          46: (0, 16), 47: (16, 16), 48: (32, 16), 49: (32, 24), 50: (16, 24), 51: (0, 24), 52: (-6, 22)}
ERASE_TIP = {f: (TEAL1 if f == 54 else AMBER) for f in ERASE}
ERASE_GLOW = {37: 3, 38: 3, 39: 4, 40: 4, 41: 4, 42: 2, 43: 2, 44: 1, 45: 1}   # else 0
ERASE_ANTENNA = {37, 43, 44, 49, 50}
ERASE_DUR = {37: 280, 38: 150, 39: 150, 40: 420, 52: 330, 53: 160, 54: 170}    # wipes: 85

def cleared_rects(f):
    """Canvas-space rects (x0,x1,y0,y1) wiped clean by frame f, cumulative.
    The pad clears its own footprint plus the band it swept since the previous frame."""
    rects = []
    prev = None
    for k in sorted(PAD_AT):
        if k > f: break
        x0, y0 = PAD_AT[k]
        if prev is None or prev[1] != y0:
            r = (x0, x0+PAD_W-1, y0, y0+7)
        else:
            r = (min(prev[0], x0), max(prev[0], x0)+PAD_W-1, y0, y0+7)
        rects.append((max(r[0], 0), min(r[1], CW-1), max(r[2], 0), min(r[3], CH-1)))
        prev = (x0, y0)
    return [r for r in rects if r[0] <= r[1] and r[2] <= r[3]]

def painting_at(f):
    if f <= NPAINT: return painting(f)
    g = painting(NPAINT)
    for (x0, x1, y0, y1) in cleared_rects(f):
        for y in range(y0, y1+1):
            for x in range(x0, x1+1):
                g[CY+y][CX+x] = -1
    return g

def glow_level(f):
    if f > NPAINT: return ERASE_GLOW.get(f, 0)
    if f < 16: return 0
    if f == 16: return 1
    if f == 17: return 2
    return 3 if ((f-18)//3) % 2 == 0 else 4   # 3 / 4 alternate = breathing

def glow(level):
    g = grid()
    if level == 0: return g
    x0, y0, x1, y1 = FRAME
    rings = {1:[MAROON], 2:[BROWN, MAROON], 3:[BROWN, MAROON, None], 4:[BROWN, MAROON, MAROON]}[level]
    for i, c in enumerate(rings):
        k = i+1
        ring = set()
        for x in range(x0-k, x1+k+1):
            ring.add((x, y0-k)); ring.add((x, y1+k))
        for y in range(y0-k, y1+k+1):
            ring.add((x0-k, y)); ring.add((x1+k, y))
        # round the corners
        ring -= {(x0-k,y0-k),(x1+k,y0-k),(x0-k,y1+k),(x1+k,y1+k)}
        for (x,y) in ring:
            if c is None:
                if bayer(x,y) < 0.5: put(g, x, y, MAROON)
            else:
                put(g, x, y, c)
    if level >= 2:
        # spill widening the floor pool toward the robot
        rx = 38.0 if level == 2 else 46.0
        for y in range(FLOOR_Y, H):
            for x in range(56, 150):
                nx = (x+0.5-104)/rx; ny = (y+0.5-80)/13.5
                r = nx*nx+ny*ny
                if r <= 1.0 and (r < 0.7 or bayer(x,y) < (1-r)/0.3):
                    put(g, x, y, TEAL1)
    return g

MOTES = [(80,24,0),(96,12,3),(122,22,6),(138,38,1),(84,48,4),(146,56,7),(66,18,2),(130,12,5),(70,46,8)]
def fx(f, robot_layers, level):
    g = grid()
    # antenna blink, period 7 while painting; explicit beats in the erase phase so the
    # gap before frame 1 stays even
    if (f in ERASE_ANTENNA) if f > NPAINT else ((f-1) % 7 in (0,1)):
        D = ROBOT_DX
        rect(g, 56+D, 21, 59+D, 24, AMBER); rect(g, 57+D, 22, 58+D, 23, CREAM)
        for (x,y) in ((55,21),(55,24),(60,21),(60,24),(56,20),(59,20)): put(g, x+D, y, ORANGE)
    # rim light from the picture on the robot's right-facing edges
    if level >= 2:
        col = AMBER if level >= 3 else ORANGE
        solid = set()
        for lg in robot_layers:
            for y in range(H):
                for x in range(W):
                    if lg[y][x] >= 0: solid.add((x,y))
        for (x,y) in solid:
            if (x+1,y) not in solid and 30 <= y <= 79 and x > 60:
                put(g, x, y, col)
    # dust motes, period 9
    for (bx, by, ph) in MOTES:
        t = (f-1+ph) % 9
        b = [0,1,2,3,3,2,1,0,0][t]
        if b == 0: continue
        x = bx + t//2; y = by - t//3
        c = {1:SLATE0, 2:SLATE2, 3:PALE}[b]
        if CX-2 <= x <= CX+CW+1 and CY-2 <= y <= CY+CH+1: continue
        put(g, x, y, c)
    return g

# ---------------------------------------------------------------- assemble
def head_state(f):
    if f > NPAINT: return (ERASE[f][4], 0, 0)
    if f in (10, 24): return ("blink", 0, 0)
    if f == 33: return ("focus_down", 1, 0)
    if f >= 34: return ("happy", 2, 1)
    ty = tip_for_frame(f)[0][1]
    if ty <= 44: return ("focus_up", 0, 0)
    if ty >= 54: return ("focus_down", 0, 0)
    return ("focus", 0, 0)

DUR = [200,120,120,120,120, 130,120,120,120,120, 130,120,120,120,120, 150,150, 130,120,120, 130,120,120,120, 130,120,120,120,120, 130,120,120, 170, 220,260,1100]
DUR += [ERASE_DUR.get(f, 85) for f in range(NPAINT+1, NF+1)]
TAGS = [("paint", 1, 33), ("hold", 34, 37), ("erase", 38, 52), ("reset", 53, 54)]

def build_frame(f, cache={}):
    if "bd" not in cache:
        cache["bd"] = backdrop(); cache["ea"] = easel(); cache["body"] = robot_body()
    face, ox, oy = head_state(f)
    head = robot_head(face, ox, oy)
    if f <= NPAINT:
        tip, col = tip_for_frame(f)
        armg, info = arm(tip, col)
    else:
        hand, bvec, pad, smudge, _ = ERASE[f]
        armg, info = arm_draw(hand, bvec, ERASE_TIP[f], pad, smudge)
    lvl = glow_level(f)
    layers = {
        "Backdrop": cache["bd"],
        "Light Glow": glow(lvl),
        "Easel": cache["ea"],
        "Painting": painting_at(f),
        "Robot Body": cache["body"],
        "Robot Head": head,
        "Robot Arm": armg,
        "Sparkle": fx(f, [cache["body"], head], lvl),
    }
    return layers, info

ORDER = ["Backdrop","Light Glow","Easel","Painting","Robot Body","Robot Head","Robot Arm","Sparkle"]

if __name__ == "__main__":
    import sys
    out = "out"; os.makedirs(out, exist_ok=True)
    frames = []
    for f in range(1, NF+1):
        layers, info = build_frame(f)
        comp = composite([layers[k] for k in ORDER])
        frames.append(comp)
        print(f, "elbow", (round(info[0]), round(info[1])), "L2", round(info[2],1), head_state(f)[0], "glow", glow_level(f))
    for f in (1, 5, 9, 16, 21, 27, 31, 36) + tuple(range(NPAINT+1, NF+1)):
        write_png(f"{out}/f{f:02d}.png", frames[f-1], 5)
    # seam check: last frame beside frame 1, full size
    seam = [[INK]*(W*2+4) for _ in range(H)]
    for y in range(H):
        for x in range(W):
            seam[y][x] = frames[-1][y][x]; seam[y][W+4+x] = frames[0][y][x]
    write_png(f"{out}/seam.png", seam, 5)
    write_png(f"{out}/strip.png", filmstrip(frames), 1)
    if "--ops" in sys.argv:      # full per-layer op dumps: ~25 MB, only needed for a from-scratch push
        os.makedirs("ops", exist_ok=True)
        stats = {}
        for f in range(1, NF+1):
            layers, info = build_frame(f)
            for name in ORDER:
                ops = emit_ops(layers[name])
                key = name.replace(" ", "_")
                with open(f"ops/{key}_{f:02d}.json", "w") as fh:
                    json.dump(ops, fh, separators=(",", ":"))
                stats.setdefault(name, []).append(len(ops))
        for k, v in stats.items():
            print(k, "ops per frame: max", max(v), "min", min(v), "total", sum(v))
    print("head states:", [head_state(f) for f in range(1, NF+1)])
    print("glow levels:", [glow_level(f) for f in range(1, NF+1)])
    print("durations:", DUR, sum(DUR))
    print("done")
