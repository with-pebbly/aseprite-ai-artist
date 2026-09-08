--------------------------------------------------------------------------------
-- Extension logic that needs no Aseprite.
--
--   lua tests/pure.test.lua              (what CI runs — no Aseprite on runners)
--   aseprite -b --script tests/pure.test.lua   (same checks, real Aseprite types)
--
-- Why this file exists: tests/extension.test.lua can only run inside Aseprite,
-- which no CI runner has, so until now a regression in the Lua half could reach
-- users past a green pipeline. Everything below is arithmetic and table shape —
-- the parts that broke in practice — so it runs under stock Lua 5.4 against
-- stand-ins for the two Aseprite types it touches.
--
-- The stand-ins are the risk: a test that only ever meets a fake `Color` proves
-- nothing about the real one. So this file also runs unmodified inside Aseprite,
-- where the stubs step aside and the real types answer instead. If the two
-- disagree, the stub is wrong and one of the two runs fails.
--
-- tests/extension.test.lua stays the authority for anything touching sprites,
-- cels, layers or the command handlers.
--------------------------------------------------------------------------------

-- Only when absent: inside Aseprite the real ones must win.
if rawget(_G, "app") == nil then
  -- Gates the WebSocket transport at load; false is also what `aseprite -b` reports.
  _G.app = { isUIAvailable = false }
end

if rawget(_G, "Color") == nil then
  _G.Color = function(t)
    return { red = t.r or 0, green = t.g or 0, blue = t.b or 0, alpha = t.a or 255 }
  end
end

local root = (rawget(_G, "app") and app.params and app.params["root"])
  or os.getenv("AI_ARTIST_ROOT")
  or "."
dofile(root .. "/extension/ai-artist.lua")

local A = assert(_G.AI_ARTIST, "extension did not expose its table")

local passed, failed, failures = 0, 0, {}

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

local function near(actual, expected, tolerance, label)
  if math.abs(actual - expected) > tolerance then
    error((label or "value") .. ": expected ~" .. expected .. ", got " .. actual, 0)
  end
end

--------------------------------------------------------------------------------
-- to_plain — the shape discriminator that swallowed a 40-op batch
--------------------------------------------------------------------------------

check("to_plain keeps an array an array", function()
  local out = A.toPlain({ 10, 20, 30 })
  assert(#out == 3, "expected 3 elements, got " .. #out)
  assert(out[1] == 10 and out[3] == 30, "elements not preserved in order")
end)

check("to_plain keeps every key of an object", function()
  local out = A.toPlain({ kind = "line", x = 1, y = 2 })
  assert(out.kind == "line" and out.x == 1 and out.y == 2, "keys lost")
end)

check("to_plain recurses into nested arrays of objects", function()
  local out = A.toPlain({ { kind = "rect" }, { kind = "line" } })
  assert(#out == 2, "outer array collapsed to " .. #out)
  assert(out[1].kind == "rect" and out[2].kind == "line", "inner objects lost")
end)

check("to_plain passes scalars through untouched", function()
  assert(A.toPlain(7) == 7 and A.toPlain("s") == "s", "scalar mangled")
  assert(A.toPlain(nil) == nil, "nil mangled")
end)

check("to_plain does not read an empty table as an array", function()
  local out = A.toPlain({})
  assert(type(out) == "table" and next(out) == nil, "empty table changed shape")
end)

--------------------------------------------------------------------------------
-- blob47 — the autotile mask set
--------------------------------------------------------------------------------

check("blob47 reduces to exactly 47 distinct masks", function()
  local masks = A.blob47Masks()
  assert(#masks == 47, "expected 47 masks, got " .. #masks)

  local seen = {}
  for _, m in ipairs(masks) do
    assert(not seen[m], "duplicate mask " .. tostring(m))
    seen[m] = true
    assert(m >= 0 and m <= 255, "mask out of byte range: " .. tostring(m))
  end
end)

--------------------------------------------------------------------------------
-- CIELAB — must agree with src/lib/color.ts, which pins the same expectations
--------------------------------------------------------------------------------

check("white and black sit at the ends of L*", function()
  local wl = A.rgbToLab(255, 255, 255)
  local bl = A.rgbToLab(0, 0, 0)
  near(wl, 100, 0.5, "L* of white")
  near(bl, 0, 0.5, "L* of black")
end)

check("deltaE is zero for identical colours and large across the wheel", function()
  assert(A.deltaE(255, 0, 77, 255, 0, 77) == 0, "identical colours must be distance 0")
  assert(A.deltaE(255, 0, 77, 254, 2, 79) < 2, "near-identical colours must be close")
  assert(A.deltaE(255, 0, 77, 41, 173, 255) > 100, "red and blue must be far apart")
end)

check("grey maps to a neutral a*/b*", function()
  local l, a, b = A.rgbToLab(128, 128, 128)
  near(l, 53.6, 0.5, "L* of mid grey")
  near(a, 0, 0.01, "a* of grey")
  near(b, 0, 0.01, "b* of grey")
end)

--------------------------------------------------------------------------------
-- Hex parsing and formatting
--------------------------------------------------------------------------------

check("hex round-trips through Color", function()
  assert(A.colorToHex(A.hexToColor("#ff004d")) == "#ff004d", "rrggbb round trip failed")
  assert(A.colorToHex(A.hexToColor("ff004d"), true) == "#ff004d", "bare hex round trip failed")
  assert(A.colorToHex(A.hexToColor("#ff004d80"), true) == "#ff004d80", "alpha dropped")
  assert(A.colorToHex(A.hexToColor("#ff004d80"), false) == "#ff004d", "alpha not suppressed")
end)

check("a malformed colour faults rather than guessing", function()
  local ok, err = pcall(A.hexToColor, "#xyz")
  assert(not ok, "'#xyz' was accepted")
  assert(type(err) == "table" and err.code == "invalid_args", "wrong fault code")
end)

--------------------------------------------------------------------------------
-- Hue-shifted shading — the rule the rulebook makes agents follow
--------------------------------------------------------------------------------

check("shadows cool and highlights warm", function()
  local base = A.hexToColor("#c04030")       -- a warm mid red
  local shadow = A.shadeColor(base, -0.4)
  local light = A.shadeColor(base, 0.4)

  local bl = A.rgbToLab(base.red, base.green, base.blue)
  local sl = A.rgbToLab(shadow.red, shadow.green, shadow.blue)
  local hl = A.rgbToLab(light.red, light.green, light.blue)

  assert(sl < bl, "shadow must be darker than base")
  assert(hl > bl, "highlight must be lighter than base")

  -- The point of hue shifting: the shadow's blue channel must not simply fall
  -- with the others, or it is a plain multiply and the art looks muddy.
  local red_drop = base.red - shadow.red
  local blue_drop = base.blue - shadow.blue
  assert(red_drop > blue_drop, "shadow must lose red faster than blue")
end)

--------------------------------------------------------------------------------

print("")
print(string.format("%d passed, %d failed", passed, failed))
for _, f in ipairs(failures) do print("  - " .. f) end
if failed > 0 then os.exit(1) end
