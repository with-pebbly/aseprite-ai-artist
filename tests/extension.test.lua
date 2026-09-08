--------------------------------------------------------------------------------
-- Headless test harness for the Aseprite extension.
--
--   aseprite -b --script-param root=<repo> --script tests/extension.test.lua
--
-- Runs the real command handlers against a real sprite in batch mode, which is
-- the only way to prove the Lua side works without a human clicking in the UI.
--------------------------------------------------------------------------------

local root = app.params["root"] or "."
dofile(root .. "/extension/ai-artist.lua")

local A = _G.AI_ARTIST
assert(A, "extension did not expose its command table")

local passed, failed = 0, 0
local failures = {}

local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then
    passed = passed + 1
    print("  ok   " .. name)
  else
    failed = failed + 1
    local message = type(err) == "table" and (err.message or err.code) or tostring(err)
    failures[#failures + 1] = name .. ": " .. message
    print("  FAIL " .. name .. " — " .. message)
  end
end

local function call(cmd, args)
  local reply = A.handleCommand({ id = "t", cmd = cmd, args = args or {} })
  if not reply.ok then
    error((reply.error and reply.error.code or "?") .. ": " ..
          (reply.error and reply.error.message or "?"), 0)
  end
  return reply.data
end

local function assertEq(actual, expected, what)
  if actual ~= expected then
    error(what .. " expected " .. tostring(expected) .. ", got " .. tostring(actual), 0)
  end
end

print("aseprite-ai-artist extension tests (" .. A.version .. ")")

-- A sprite to work on. 16x16 keeps the pixel loops fast in CI.
local sprite = Sprite(16, 16, ColorMode.RGB)
app.sprite = sprite
sprite.palettes[1]:resize(4)
sprite.palettes[1]:setColor(0, Color{ r = 0, g = 0, b = 0, a = 0 })
sprite.palettes[1]:setColor(1, Color{ r = 255, g = 0, b = 77 })   -- pico8 red
sprite.palettes[1]:setColor(2, Color{ r = 41, g = 173, b = 255 }) -- pico8 blue
sprite.palettes[1]:setColor(3, Color{ r = 255, g = 241, b = 232 }) -- pico8 white

check("session.site reports the active sprite", function()
  local site = call("session.site")
  assert(site.sprite, "no active sprite reported")
  assertEq(site.sprite.width, 16, "width")
  assertEq(site.sprite.colorMode, "rgb", "colorMode")
end)

check("sprite.info returns layers, frames and palette", function()
  local info = call("sprite.info", { includePalette = true })
  assertEq(info.width, 16, "width")
  assertEq(info.frameCount, 1, "frameCount")
  assertEq(#info.layers, 1, "layer count")
  assertEq(#info.palette, 4, "palette size")
end)

check("unknown command fails loudly, not silently", function()
  local reply = A.handleCommand({ id = "t", cmd = "does.not.exist", args = {} })
  assert(reply.ok == false, "unknown command reported success")
  assertEq(reply.error.code, "unsupported_command", "error code")
end)

check("draw.batch writes pixels and reports the count", function()
  local result = call("draw.batch", {
    ops = { { kind = "rect", color = "#ff004d", rect = { x = 2, y = 2, width = 6, height = 6 },
              fill = "#29adff" } },
    paletteLock = true,
  })
  assert(result.pixelsChanged > 0, "nothing was drawn")
  assertEq(result.opsApplied, 1, "opsApplied")
end)

check("drawn pixels read back at the right coordinates", function()
  local region = call("pixels.read", { region = { x = 0, y = 0, width = 16, height = 16 } })
  assertEq(region.width, 16, "region width")
  assertEq(#region.grid, 256, "grid length")
  -- (2,2) is the rect's top-left outline pixel.
  local idx = region.grid[2 * 16 + 2 + 1]
  assert(idx ~= 0, "expected an opaque pixel at (2,2)")
  assertEq(region.colors[idx + 1], "#ff004d", "outline colour at (2,2)")
  -- (4,4) is inside the fill.
  local inner = region.grid[4 * 16 + 4 + 1]
  assertEq(region.colors[inner + 1], "#29adff", "fill colour at (4,4)")
end)

check("palette lock snaps an off-palette colour and reports the move", function()
  local result = call("draw.batch", {
    ops = { { kind = "pixels", color = "#fe0150", points = { { x = 12, y = 12 } } } },
    paletteLock = true,
  })
  assertEq(#result.colorsSnapped, 1, "snap report length")
  assertEq(result.colorsSnapped[1].to, "#ff004d", "snapped target")
end)

check("palette lock can be turned off", function()
  call("draw.batch", {
    ops = { { kind = "pixels", color = "#123456", points = { { x = 14, y = 14 } } } },
    paletteLock = false,
  })
  local region = call("pixels.read", { region = { x = 14, y = 14, width = 1, height = 1 } })
  assertEq(region.colors[region.grid[1] + 1], "#123456", "unsnapped colour")
end)

check("layers can be created and listed in one batch", function()
  local result = call("layer.apply", {
    batch = {
      { op = "create", name = "outline" },
      { op = "create", name = "shading" },
      { op = "set", name = "shading", opacity = 200 },
    },
  })
  assertEq(result.applied, 3, "applied count")
  local names = {}
  for _, l in ipairs(result.layers) do names[l.name] = l end
  assert(names["outline"], "outline layer missing")
  assertEq(names["shading"].opacity, 200, "shading opacity")
end)

check("frames and tags round-trip", function()
  call("frame.apply", { op = "add", count = 3 })
  local frames = call("frame.apply", { op = "set_duration", durations = { 200, 80, 80, 200 } })
  assertEq(frames.frameCount, 4, "frame count")
  assertEq(frames.frames[1].durationMs, 200, "frame 1 duration")
  assertEq(frames.totalDurationMs, 560, "total duration")

  local tags = call("tag.apply", { op = "create", name = "idle", from = 1, to = 4,
                                   direction = "pingpong" })
  assertEq(#tags.tags, 1, "tag count")
  assertEq(tags.tags[1].name, "idle", "tag name")
  assertEq(tags.tags[1].frames, 4, "tag frame span")
end)

check("selection reports its pixel count", function()
  local sel = call("select.apply", { op = "rect", rect = { x = 0, y = 0, width = 4, height = 4 } })
  assertEq(sel.empty, false, "selection empty")
  assertEq(sel.pixelCount, 16, "selected pixels")
  call("select.apply", { op = "none" })
end)

check("recolor shade moves colours and reports the mapping", function()
  local result = call("recolor.apply", { op = "shade", amount = -0.3,
                                         clampToPalette = false, layer = "Layer 1", frame = 1 })
  assert(result.pixelsChanged > 0, "nothing recoloured")
  assert(#result.mapping > 0, "no mapping reported")
  for _, m in ipairs(result.mapping) do
    assert(m.from ~= m.to, "mapping entry did not change anything")
  end
end)

check("palette.stats finds off-palette colours", function()
  local stats = call("palette.stats")
  local found = false
  for _, entry in ipairs(stats.offPalette) do
    if entry.pixels > 0 then found = true end
  end
  assert(found, "expected the shaded pixels to be reported as off-palette")
end)

check("validate finds an untagged-animation problem when tags are removed", function()
  call("tag.apply", { op = "delete", name = "idle" })
  local report = call("validate.run", { checks = { "animation" } })
  local hit = false
  for _, f in ipairs(report.findings) do
    if f.check == "animation" and f.severity == "error" then hit = true end
  end
  assert(hit, "expected an animation error for untagged frames")
end)

check("transform flip is its own inverse", function()
  local before = call("pixels.read", { region = { x = 0, y = 0, width = 16, height = 16 } })
  call("transform.apply", { op = "flip", axis = "horizontal", layer = "Layer 1", frame = 1 })
  call("transform.apply", { op = "flip", axis = "horizontal", layer = "Layer 1", frame = 1 })
  local after = call("pixels.read", { region = { x = 0, y = 0, width = 16, height = 16 } })
  for i = 1, #before.grid do
    local a = before.colors[before.grid[i] + 1]
    local b = after.colors[after.grid[i] + 1]
    if a ~= b then error("pixel " .. i .. " changed: " .. tostring(a) .. " -> " .. tostring(b), 0) end
  end
end)

check("decoded JSON normalises to plain Lua, arrays included", function()
  -- Aseprite's json.decode returns userdata whose arrays yield nothing from
  -- pairs and whose objects report a non-zero length. Getting this wrong is
  -- silent: a 40-op draw batch arrives as zero ops and reports success.
  local decoded = json.decode('{"id":"r1","ops":[{"kind":"pixels"},{"kind":"line"}],"n":3,"empty":[]}')
  local plain = A.toPlain(decoded)
  assertEq(type(plain), "table", "top level type")
  assertEq(plain.id, "r1", "scalar field")
  assertEq(type(plain.ops), "table", "array field type")
  assertEq(#plain.ops, 2, "array length")
  assertEq(plain.ops[1].kind, "pixels", "first element")
  assertEq(plain.ops[2].kind, "line", "second element")
  assertEq(plain.n, 3, "number field")
  assertEq(#plain.empty, 0, "empty array")
end)

check("a batch arriving as decoded JSON draws every op", function()
  -- End-to-end shape of the bug above: the command goes through handle_command
  -- exactly as it would from the wire.
  local raw = '{"id":"t","cmd":"draw.batch","args":{"paletteLock":false,"ops":[' ..
    '{"kind":"pixels","color":"#ff004d","points":[{"x":0,"y":0},{"x":1,"y":0}]},' ..
    '{"kind":"pixels","color":"#29adff","points":[{"x":0,"y":1}]}]}}'
  local reply = A.handleCommand(A.toPlain(json.decode(raw)))
  assert(reply.ok, "batch failed: " .. tostring(reply.error and reply.error.message))
  assertEq(reply.data.opsApplied, 2, "opsApplied")
  assertEq(reply.data.pixelsChanged, 3, "pixelsChanged")
end)

check("blob47 mask reduction yields exactly 47 canonical tiles", function()
  -- Computed, not hardcoded: if this ever stops being 47 the export refuses
  -- rather than writing a wangset that autotiles wrongly.
  local reply = A.handleCommand({ id = "t", cmd = "tileset.apply",
    args = { op = "list" } })
  assert(reply.ok, "tileset.list failed")
  assertEq(#A.blob47Masks(), 47, "canonical blob47 mask count")
  -- The all-empty and all-full masks must both be present.
  local masks = A.blob47Masks()
  assertEq(masks[1], 0, "first mask")
  assertEq(masks[#masks], 255, "last mask")
end)

check("tileset pack deduplicates a mockup and rebuilds it exactly", function()
  -- A 32x32 mockup of 8x8 cells: a 2x2 checker of two distinct tiles, so 16
  -- cells must collapse to 2 unique tiles.
  local mock = Sprite(32, 32, ColorMode.RGB)
  app.sprite = mock
  local painted = app.layer
  painted.name = "mockup"

  local drew = A.handleCommand({ id = "t", cmd = "draw.batch", args = {
    layer = "mockup", paletteLock = false,
    ops = (function()
      local ops = {}
      for row = 0, 3 do
        for col = 0, 3 do
          ops[#ops + 1] = {
            kind = "rect",
            rect = { x = col * 8, y = row * 8, width = 8, height = 8 },
            color = ((col + row) % 2 == 0) and "#ff004d" or "#29adff",
            fill  = ((col + row) % 2 == 0) and "#ff004d" or "#29adff",
          }
        end
      end
      return ops
    end)(),
  } })
  assert(drew.ok, "mockup draw failed: " .. tostring(drew.error and drew.error.message))

  local before = A.handleCommand({ id = "t", cmd = "pixels.read",
    args = { region = { x = 0, y = 0, width = 32, height = 32 } } })
  assert(before.ok, "read before failed")

  local packed = A.handleCommand({ id = "t", cmd = "tileset.apply", args = {
    op = "pack", layer = "mockup", name = "terrain", tileWidth = 8, tileHeight = 8,
  } })
  assert(packed.ok, "pack failed: " .. tostring(packed.error and packed.error.message))
  assertEq(packed.data.tileCount, 2, "unique tiles")
  assertEq(packed.data.cellCount, 16, "cells")
  assertEq(packed.data.reusedExact, 14, "exact reuse")
  assertEq(packed.data.columns, 4, "grid columns")

  -- The tilemap must reconstruct the mockup pixel for pixel, with the source
  -- layer hidden. That is the whole claim of `pack`.
  local after = A.handleCommand({ id = "t", cmd = "pixels.read",
    args = { region = { x = 0, y = 0, width = 32, height = 32 } } })
  assert(after.ok, "read after failed")
  for i = 1, #before.data.grid do
    local a = before.data.colors[before.data.grid[i] + 1]
    local b = after.data.colors[after.data.grid[i] + 1]
    if a ~= b then
      error("pixel " .. i .. " differs after packing: " .. tostring(a) .. " vs " .. tostring(b), 0)
    end
  end

  mock:close()
  app.sprite = sprite
end)

check("tileset pack refuses a canvas that is not a whole number of tiles", function()
  local odd = Sprite(30, 32, ColorMode.RGB)
  app.sprite = odd
  app.layer.name = "mockup"
  A.handleCommand({ id = "t", cmd = "draw.batch", args = { layer = "mockup", paletteLock = false,
    ops = { { kind = "rect", rect = { x = 0, y = 0, width = 10, height = 10 },
              color = "#ffffff", fill = "#ffffff" } } } })
  local reply = A.handleCommand({ id = "t", cmd = "tileset.apply",
    args = { op = "pack", layer = "mockup", tileWidth = 16, tileHeight = 16 } })
  assert(not reply.ok, "packing a 30px canvas into 16px tiles should refuse")
  assertEq(reply.error.code, "invalid_args", "error code")
  assert(reply.error.message:find("whole number"), "message should explain why")
  odd:close()
  app.sprite = sprite
end)

check("tileset export writes a Tiled tileset, map and packed png", function()
  local mock = Sprite(32, 32, ColorMode.RGB)
  app.sprite = mock
  app.layer.name = "mockup"
  A.handleCommand({ id = "t", cmd = "draw.batch", args = { layer = "mockup", paletteLock = false,
    ops = {
      { kind = "rect", rect = { x = 0, y = 0, width = 16, height = 16 }, color = "#ff004d", fill = "#ff004d" },
      { kind = "rect", rect = { x = 16, y = 16, width = 16, height = 16 }, color = "#29adff", fill = "#29adff" },
    } } })
  local packed = A.handleCommand({ id = "t", cmd = "tileset.apply",
    args = { op = "pack", layer = "mockup", name = "terrain", tileWidth = 16, tileHeight = 16 } })
  assert(packed.ok, "pack failed: " .. tostring(packed.error and packed.error.message))

  local out = app.fs.joinPath(app.fs.tempPath, "ai-artist-test-terrain.tsj")
  local reply = A.handleCommand({ id = "t", cmd = "tileset.apply",
    args = { op = "export", layer = "terrain", path = out, format = "tiled" } })
  assert(reply.ok, "export failed: " .. tostring(reply.error and reply.error.message))

  local base = app.fs.joinPath(app.fs.tempPath, "ai-artist-test-terrain")
  assert(app.fs.isFile(base .. ".png"), "packed png missing")
  assert(app.fs.isFile(base .. ".tsj"), "tileset json missing")
  assert(app.fs.isFile(base .. ".tmj"), "map json missing")

  local handle = io.open(base .. ".tsj", "r")
  local doc = json.decode(handle:read("a"))
  handle:close()
  assertEq(doc.type, "tileset", "tsj type")
  assertEq(doc.tilewidth, 16, "tile width")
  assertEq(doc.tilecount, reply.data.tileCount, "tile count")
  -- Aseprite's reserved empty tile must NOT occupy an atlas slot, or every
  -- real tile shifts by one and the map renders one tile off everywhere.
  assertEq(doc.tilecount, 2, "empty tile must be excluded from the atlas")
  assert(doc.image:find("%.png$"), "image reference should be the packed png")

  local mh = io.open(base .. ".tmj", "r")
  local map = json.decode(mh:read("a"))
  mh:close()
  assertEq(map.type, "map", "tmj type")
  assertEq(map.width, 2, "map width in tiles")
  assertEq(#map.layers[1].data, 4, "map data length")
  assertEq(map.tilesets[1].firstgid, 1, "firstgid")

  -- The mockup filled the top-left and bottom-right 16x16 cells and left the
  -- other two transparent, so the gids must be: tile, empty, empty, tile —
  -- with 0 meaning empty and every non-zero gid inside the tileset.
  local data = map.layers[1].data
  assertEq(data[2], 0, "transparent cell must be gid 0")
  assertEq(data[3], 0, "transparent cell must be gid 0")
  assert(data[1] > 0 and data[1] <= doc.tilecount, "gid " .. data[1] .. " out of range")
  assert(data[4] > 0 and data[4] <= doc.tilecount, "gid " .. data[4] .. " out of range")
  assert(data[1] ~= data[4], "two differently coloured cells must be different tiles")

  mock:close()
  app.sprite = sprite
end)

check("tileset export writes Godot and JSON targets", function()
  local mock = Sprite(32, 32, ColorMode.RGB)
  app.sprite = mock
  app.layer.name = "mockup"
  A.handleCommand({ id = "t", cmd = "draw.batch", args = { layer = "mockup", paletteLock = false,
    ops = {
      { kind = "rect", rect = { x = 0, y = 0, width = 16, height = 16 }, color = "#ff004d", fill = "#ff004d" },
      { kind = "rect", rect = { x = 16, y = 0, width = 16, height = 16 }, color = "#29adff", fill = "#29adff" },
      { kind = "rect", rect = { x = 0, y = 16, width = 16, height = 16 }, color = "#00e436", fill = "#00e436" },
    } } })
  A.handleCommand({ id = "t", cmd = "tileset.apply",
    args = { op = "pack", layer = "mockup", name = "terrain", tileWidth = 16, tileHeight = 16 } })

  local base = app.fs.joinPath(app.fs.tempPath, "ai-artist-test-godot")
  local godot = A.handleCommand({ id = "t", cmd = "tileset.apply", args = {
    op = "export", layer = "terrain", path = base .. ".tres", format = "godot" } })
  assert(godot.ok, "godot export failed: " .. tostring(godot.error and godot.error.message))
  assert(app.fs.isFile(base .. ".tres"), "tres missing")
  local gh = io.open(base .. ".tres", "r")
  local tres = gh:read("a")
  gh:close()
  assert(tres:find('%[gd_resource type="TileSet"'), "not a Godot TileSet resource")
  assert(tres:find('texture_region_size = Vector2i%(16, 16%)'), "missing region size")
  assert(tres:find('sources/0 = SubResource'), "atlas source not wired to the resource")
  -- Atlas coordinates start at 0:0; a stray entry for the dropped empty tile
  -- would push everything off by one slot.
  assert(tres:find('\n0:0/0 = 0'), "atlas must start at 0:0")

  local jbase = app.fs.joinPath(app.fs.tempPath, "ai-artist-test-tiles")
  local jsonx = A.handleCommand({ id = "t", cmd = "tileset.apply", args = {
    op = "export", layer = "terrain", path = jbase .. ".json", format = "json" } })
  assert(jsonx.ok, "json export failed: " .. tostring(jsonx.error and jsonx.error.message))
  local jh = io.open(jbase .. ".json", "r")
  local doc = json.decode(jh:read("a"))
  jh:close()
  assertEq(doc.tileWidth, 16, "tile width")
  assertEq(doc.map.width, 2, "map width")
  assertEq(#doc.map.tiles, 4, "map tile count")
  assertEq(doc.tileCount, 3, "three painted cells, three tiles, empty excluded")
  assert(doc.indexing:find("atlas slot"), "the index convention must be stated in the file")

  local bad = A.handleCommand({ id = "t", cmd = "tileset.apply", args = {
    op = "export", layer = "terrain", path = jbase .. ".xyz", format = "nonsense" } })
  assert(not bad.ok, "an unknown format must be refused")
  assertEq(bad.error.code, "invalid_args", "error code")

  mock:close()
  app.sprite = sprite
end)

check("tileset stamp reports placements it could not make", function()
  local mock = Sprite(32, 32, ColorMode.RGB)
  app.sprite = mock
  app.layer.name = "mockup"
  A.handleCommand({ id = "t", cmd = "draw.batch", args = { layer = "mockup", paletteLock = false,
    ops = { { kind = "rect", rect = { x = 0, y = 0, width = 16, height = 16 },
              color = "#ff004d", fill = "#ff004d" } } } })
  A.handleCommand({ id = "t", cmd = "tileset.apply",
    args = { op = "pack", layer = "mockup", name = "terrain", tileWidth = 16, tileHeight = 16 } })

  local reply = A.handleCommand({ id = "t", cmd = "tileset.apply", args = {
    op = "stamp", layer = "terrain",
    tiles = {
      { x = 0, y = 0, tile = 1 },   -- fine
      { x = 9, y = 9, tile = 1 },   -- outside the 2x2 grid
      { x = 1, y = 1, tile = 99 },  -- no such tile
    } } })
  assert(reply.ok, "stamp failed: " .. tostring(reply.error and reply.error.message))
  assertEq(reply.data.tileCount, 1, "placed")
  assertEq(reply.data.skipped, 2, "skipped")

  mock:close()
  app.sprite = sprite
end)

check("blob47 export writes a wangset whose ids are atlas slots", function()
  -- 48 tiles: the reserved empty one plus the 47 blob tiles. Built as a strip
  -- of 48 distinct 8px cells so packing yields exactly 47 unique tiles.
  local w = 48 * 8
  local mock = Sprite(w, 8, ColorMode.RGB)
  app.sprite = mock
  app.layer.name = "mockup"
  local ops = {}
  for i = 0, 46 do
    -- Distinct colour per cell so no two cells dedupe into one tile.
    local c = string.format("#%02x%02x%02x", (i * 5) % 256, (i * 11) % 256, (i * 23) % 256)
    ops[#ops + 1] = { kind = "rect", rect = { x = i * 8, y = 0, width = 8, height = 8 },
                      color = c, fill = c }
  end
  local drew = A.handleCommand({ id = "t", cmd = "draw.batch",
    args = { layer = "mockup", paletteLock = false, ops = ops } })
  assert(drew.ok, "strip draw failed: " .. tostring(drew.error and drew.error.message))

  local packed = A.handleCommand({ id = "t", cmd = "tileset.apply", args = {
    op = "pack", layer = "mockup", name = "blob", tileWidth = 8, tileHeight = 8 } })
  assert(packed.ok, "pack failed: " .. tostring(packed.error and packed.error.message))
  assertEq(packed.data.tileCount, 47, "47 unique blob tiles")

  local base = app.fs.joinPath(app.fs.tempPath, "ai-artist-test-blob47")
  local reply = A.handleCommand({ id = "t", cmd = "tileset.apply", args = {
    op = "export", layer = "blob", path = base .. ".tsj", format = "tiled", layout = "blob47" } })
  assert(reply.ok, "blob47 export failed: " .. tostring(reply.error and reply.error.message))

  local h = io.open(base .. ".tsj", "r")
  local doc = json.decode(h:read("a"))
  h:close()
  assertEq(#doc.wangsets, 1, "one wangset")
  local ws = doc.wangsets[1]
  assertEq(ws.name, "blob47", "wangset name")
  assertEq(#ws.wangtiles, 47, "wangtile count")
  assertEq(#ws.colors, 2, "terrain and empty must both be explicit")
  -- Ids are atlas slots, so they run 0..46 and every one must be in range.
  assertEq(ws.wangtiles[1].tileid, 0, "first wangtile id")
  assertEq(ws.wangtiles[47].tileid, 46, "last wangtile id")
  for _, wt in ipairs(ws.wangtiles) do
    assert(wt.tileid >= 0 and wt.tileid < doc.tilecount,
      "wangtile id " .. wt.tileid .. " outside the atlas (" .. doc.tilecount .. " tiles)")
    assertEq(#wt.wangid, 8, "wangid length")
    for _, v in ipairs(wt.wangid) do
      assert(v == 1 or v == 2, "wangid entries must name a colour, got " .. tostring(v))
    end
  end
  -- Mask 0 is all-empty and mask 255 is all-terrain; those bracket the set.
  assertEq(ws.wangtiles[1].wangid[1], 2, "first tile has no neighbours")
  assertEq(ws.wangtiles[47].wangid[1], 1, "last tile is fully surrounded")

  mock:close()
  app.sprite = sprite
end)

check("tileset export refuses blob47 without a full blob set", function()
  local mock = Sprite(32, 32, ColorMode.RGB)
  app.sprite = mock
  app.layer.name = "mockup"
  A.handleCommand({ id = "t", cmd = "draw.batch", args = { layer = "mockup", paletteLock = false,
    ops = { { kind = "rect", rect = { x = 0, y = 0, width = 16, height = 16 },
              color = "#ff004d", fill = "#ff004d" } } } })
  A.handleCommand({ id = "t", cmd = "tileset.apply",
    args = { op = "pack", layer = "mockup", name = "terrain", tileWidth = 16, tileHeight = 16 } })
  local reply = A.handleCommand({ id = "t", cmd = "tileset.apply", args = {
    op = "export", layer = "terrain", format = "tiled", layout = "blob47",
    path = app.fs.joinPath(app.fs.tempPath, "ai-artist-test-blob.tsj"),
  } })
  assert(not reply.ok, "a 1-tile set must not export as blob47")
  assert(reply.error.message:find("47"), "message should name the requirement")
  mock:close()
  app.sprite = sprite
end)

-- ── regressions from the 2026-09-08 multi-expert audit ──────────────────────

check("a closed polyline draws its closing edge", function()
  -- The outline loop stopped at #points - 1 while the fill loop wrapped, so a
  -- "closed" triangle shipped with one side missing and reported success.
  local tri = Sprite(16, 16, ColorMode.RGB)
  app.sprite = tri
  local ok = A.handleCommand({ id = "t", cmd = "draw.batch", args = { paletteLock = false, ops = {
    { kind = "polyline", closed = true, color = "#ff0000",
      points = { { x = 0, y = 0 }, { x = 10, y = 0 }, { x = 10, y = 10 } } } } } })
  assert(ok.ok, "draw failed: " .. tostring(ok.error and ok.error.message))
  local region = call("pixels.read", { region = { x = 0, y = 0, width = 16, height = 16 } })
  -- (5,5) sits on the closing diagonal (10,10) -> (0,0).
  local idx = region.grid[5 * 16 + 5 + 1]
  assert(idx ~= 0, "the closing edge is missing: (5,5) is transparent")
  assertEq(region.colors[idx + 1], "#ff0000", "colour on the closing edge")
  tri:close(); app.sprite = sprite
end)

check("a thick line paints its whole brush into a tight cel", function()
  -- op_bounds ignored thickness, so the cel was grown to the endpoints only and
  -- Draw.pixel silently clipped the rest of the stamp.
  local dot = Sprite(32, 32, ColorMode.RGB)
  app.sprite = dot
  A.handleCommand({ id = "t", cmd = "draw.batch", args = { paletteLock = false, ops = {
    { kind = "pixels", color = "#ffffff", points = { { x = 16, y = 16 } } } } } })
  local res = A.handleCommand({ id = "t", cmd = "draw.batch", args = { paletteLock = false, ops = {
    { kind = "line", color = "#ff0000", from = { x = 16, y = 16 }, to = { x = 16, y = 16 },
      thickness = 7 } } } })
  assert(res.ok, "draw failed: " .. tostring(res.error and res.error.message))
  assertEq(res.data.pixelsChanged, 49, "a 7x7 brush must land all 49 pixels")
  dot:close(); app.sprite = sprite
end)

check("fuzzy tile packing refuses a non-RGB sprite", function()
  -- cell_distance reads RGB channels; on an indexed sprite those are palette
  -- indices, and comparing them merged two maximally different tiles into one.
  local idx = Sprite(32, 16, ColorMode.INDEXED)
  app.sprite = idx
  local reply = A.handleCommand({ id = "t", cmd = "tileset.apply", args = {
    op = "pack", tileWidth = 16, tileHeight = 16, tolerance = 50 } })
  assert(not reply.ok, "tolerance on an indexed sprite must be refused")
  assertEq(reply.error.code, "invalid_args", "error code")
  assert(reply.error.message:find("RGB"), "message should name the requirement")
  idx:close(); app.sprite = sprite
end)

check("rotate by 0 reports that it changed nothing", function()
  -- `changed` was set after the branch chain, so a no-op claimed a full-canvas
  -- change and broke any agent using pixelsChanged to verify idempotency.
  local rot = Sprite(8, 8, ColorMode.RGB)
  app.sprite = rot
  A.handleCommand({ id = "t", cmd = "draw.batch", args = { paletteLock = false, ops = {
    { kind = "pixels", color = "#00ff00", points = { { x = 1, y = 1 } } } } } })
  local zero = A.handleCommand({ id = "t", cmd = "transform.apply", args = { op = "rotate", angle = 0 } })
  assert(zero.ok, "rotate 0 failed: " .. tostring(zero.error and zero.error.message))
  assertEq(zero.data.pixelsChanged, 0, "a 0-degree rotation changes nothing")
  local ninety = A.handleCommand({ id = "t", cmd = "transform.apply", args = { op = "rotate", angle = 90 } })
  assert(ninety.ok, "rotate 90 failed: " .. tostring(ninety.error and ninety.error.message))
  assert(ninety.data.pixelsChanged > 0, "a 90-degree rotation does change something")
  rot:close(); app.sprite = sprite
end)

check("validate actually runs its outline and banding checks", function()
  -- Both were advertised in the schema AND in the handler's own default set,
  -- but no branch read them: validate answered "Clean." without running either.
  local v = Sprite(24, 24, ColorMode.RGB)
  app.sprite = v
  -- A filled block with a deliberately broken outline: one edge pixel recoloured.
  A.handleCommand({ id = "t", cmd = "draw.batch", args = { paletteLock = false, ops = {
    { kind = "rect", rect = { x = 4, y = 4, width = 16, height = 16 },
      color = "#000000", fill = "#ff004d" },
    { kind = "pixels", color = "#29adff", points = { { x = 10, y = 4 } } } } } })
  local report = call("validate.run", { checks = { "outline" } })
  local hit = false
  for _, f in ipairs(report.findings) do
    if f.check == "outline" then hit = true end
  end
  assert(hit, "expected an outline finding for a broken outline")

  local banding = call("validate.run", { checks = { "banding" } })
  local band = false
  for _, f in ipairs(banding.findings) do
    if f.check == "banding" then band = true end
  end
  assert(band, "expected a banding finding for a 16px straight colour boundary")
  v:close(); app.sprite = sprite
end)

check("cel list reports linked cels as linked", function()
  -- `linked = c.image ~= nil and false or false` collapsed to a constant false,
  -- so the tool always answered "nothing is linked".
  local anim = Sprite(8, 8, ColorMode.RGB)
  app.sprite = anim
  A.handleCommand({ id = "t", cmd = "draw.batch", args = { paletteLock = false, ops = {
    { kind = "pixels", color = "#ffffff", points = { { x = 0, y = 0 } } } } } })
  local before = call("cel.apply", { op = "list" })
  for _, c in ipairs(before.cels) do assertEq(c.linked, false, "a lone cel is not linked") end

  local dup = A.handleCommand({ id = "t", cmd = "frame.apply", args = { op = "duplicate", frame = 1, linkCels = true } })
  assert(dup.ok, "duplicate failed: " .. tostring(dup.error and dup.error.message))
  assertEq(dup.data.frameCount, 2, "frame added")
  local after = call("cel.apply", { op = "list" })
  local linked = 0
  for _, c in ipairs(after.cels) do if c.linked then linked = linked + 1 end end
  assert(linked >= 2, "expected the duplicated linked cels to report linked=true, got " .. linked)
  anim:close(); app.sprite = sprite
end)

check("gradient honours dither and every declared direction", function()
  -- `dither` was declared in the schema and never read, and `diagonal`/`radial`
  -- both silently fell through to the vertical branch.
  local g = Sprite(16, 16, ColorMode.RGB)
  app.sprite = g
  local function grid(direction, dither)
    A.handleCommand({ id = "t", cmd = "draw.batch", args = { paletteLock = false, ops = {
      { kind = "clear" },
      { kind = "gradient", rect = { x = 0, y = 0, width = 16, height = 16 },
        from = "#000000", to = "#ffffff", steps = 4,
        direction = direction, dither = dither } } } })
    local r = call("pixels.read", { region = { x = 0, y = 0, width = 16, height = 16 } })
    local out = {}
    for i, idx in ipairs(r.grid) do out[i] = r.colors[idx + 1] end
    return out
  end

  local vertical = grid("vertical", false)
  local horizontal = grid("horizontal", false)
  local diagonal = grid("diagonal", false)
  local radial = grid("radial", false)

  local function differs(a, b)
    for i = 1, #a do if a[i] ~= b[i] then return true end end
    return false
  end
  assert(differs(vertical, horizontal), "horizontal must differ from vertical")
  assert(differs(vertical, diagonal), "diagonal must differ from vertical")
  assert(differs(vertical, radial), "radial must differ from vertical")

  local hard = grid("vertical", false)
  local dithered = grid("vertical", true)
  assert(differs(hard, dithered), "dither=true must change the result")
  -- A dithered band boundary mixes two colours within one row; a hard one does not.
  local function rowColours(cells, row)
    local seen = {}
    for x = 0, 15 do seen[cells[row * 16 + x + 1]] = true end
    local n = 0
    for _ in pairs(seen) do n = n + 1 end
    return n
  end
  local mixed = false
  for row = 0, 15 do if rowColours(dithered, row) > 1 then mixed = true end end
  assert(mixed, "a dithered vertical gradient must mix colours within a row")
  g:close(); app.sprite = sprite
end)

check("a new sprite reports an identifier that resolves", function()
  -- op=new answered "untitled", which find_sprite could not resolve, so feeding
  -- a tool's own returned identifier into the next call failed immediately.
  local made = call("sprite.manage", { op = "new", width = 8, height = 8, colorMode = "rgb" })
  assert(made.id, "op=new must report a stable id")
  local info = call("sprite.info", { sprite = "#" .. tostring(made.id), includePalette = false })
  assertEq(info.width, 8, "the reported id must resolve back to the same sprite")
  assertEq(info.id, made.id, "ids must round-trip")
  -- The display name must resolve too, when it is unambiguous.
  local byName = A.handleCommand({ id = "t", cmd = "sprite.info",
    args = { sprite = made.sprite, includePalette = false } })
  assert(byName.ok or byName.error.message:find("matches"),
    "a name lookup must either resolve or say the name is ambiguous, not 'no match'")
  call("sprite.manage", { op = "close", sprite = "#" .. tostring(made.id) })
  app.sprite = sprite
end)

check("selectionOnly refuses rather than widening to the whole cel", function()
  local sel = Sprite(16, 16, ColorMode.RGB)
  app.sprite = sel
  A.handleCommand({ id = "t", cmd = "select.apply", args = { op = "none" } })
  local reply = A.handleCommand({ id = "t", cmd = "draw.batch", args = {
    selectionOnly = true, paletteLock = false,
    ops = { { kind = "rect", rect = { x = 0, y = 0, width = 16, height = 16 },
              color = "#ff0000", fill = "#ff0000" } } } })
  assert(not reply.ok, "selectionOnly with no selection must refuse, not repaint everything")
  assertEq(reply.error.code, "invalid_args", "error code")
  sel:close(); app.sprite = sprite
end)

check("stamping onto a brand-new tilemap layer creates a TILEMAP cel", function()
  -- The known-bug regression test only ever stamped onto a layer that `pack`
  -- had already given a cel, so it never took the branch that was the fix.
  local t = Sprite(32, 32, ColorMode.RGB)
  app.sprite = t
  local made = A.handleCommand({ id = "t", cmd = "tileset.apply", args = {
    op = "create_layer", name = "terrain", tileWidth = 16, tileHeight = 16 } })
  assert(made.ok, "create_layer failed: " .. tostring(made.error and made.error.message))

  local layer = nil
  for _, l in ipairs(t.layers) do if l.name == "terrain" then layer = l end end
  assert(layer, "tilemap layer not found")
  assert(layer:cel(1) == nil, "precondition: the new tilemap layer has no cel yet")

  -- Give the tileset one real tile to stamp.
  local ts = layer.tileset
  local tile = t:newTile(ts)
  local img = Image(16, 16, ColorMode.RGB)
  img:clear(app.pixelColor.rgba(255, 0, 77, 255))
  tile.image = img

  local stamped = A.handleCommand({ id = "t", cmd = "tileset.apply", args = {
    op = "stamp", layer = "terrain", tiles = { { x = 0, y = 0, tile = tile.index } } } })
  assert(stamped.ok, "stamp failed: " .. tostring(stamped.error and stamped.error.message))
  assertEq(stamped.data.tileCount, 1, "one tile placed")

  local cel = layer:cel(1)
  assert(cel, "stamp must have created a cel")
  assertEq(tostring(cel.image.colorMode), tostring(ColorMode.TILEMAP), "cel must be a TILEMAP image")
  assertEq(app.pixelColor.tileI(cel.image:getPixel(0, 0)), tile.index, "the stamped tile index")
  t:close(); app.sprite = sprite
end)

check("json encoder emits arrays for empty tables", function()
  assertEq(A.encodeJson({}), "[]", "empty table")
  assertEq(A.encodeJson({ 1, 2 }), "[1,2]", "array")
  assertEq(A.encodeJson({ a = 1 }), '{"a":1}', "object")
  assertEq(A.encodeJson("a\"b"), '"a\\"b"', "escaped string")
end)

check("look.preview writes an upscaled png", function()
  local out = app.fs.joinPath(app.fs.tempPath, "ai-artist-test-preview.png")
  local meta = call("look.preview", { path = out, frame = 1 })
  assertEq(meta.sourceWidth, 16, "source width")
  assert(meta.scale > 1, "expected an upscale for a 16px sprite")
  assert(app.fs.isFile(out), "preview file was not written")
  assertEq(meta.width, 16 * meta.scale, "output width")
end)

check("look.filmstrip composites every frame", function()
  local out = app.fs.joinPath(app.fs.tempPath, "ai-artist-test-strip.png")
  local meta = call("look.filmstrip", { path = out })
  assertEq(meta.frames, 4, "frame count")
  assert(app.fs.isFile(out), "filmstrip file was not written")
end)

sprite:close()

print("")
print(passed .. " passed, " .. failed .. " failed")
for _, f in ipairs(failures) do print("  " .. f) end
-- Aseprite's Lua sandbox has no os.exit, so the runner greps for this line.
print(failed == 0 and "RESULT: PASS" or "RESULT: FAIL")
