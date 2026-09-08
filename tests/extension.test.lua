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
