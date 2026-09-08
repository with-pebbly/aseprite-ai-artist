--------------------------------------------------------------------------------
-- Aseprite AI Artist — live link between a coding agent and this editor.
--
-- Aseprite's Lua WebSocket is a client only, so this dials out to a local bridge
-- rather than listening. Everything it accepts is a named command from a fixed
-- table; there is no eval path unless the operator explicitly enables `lua.run`
-- on the server side.
--
-- Design rules for anything added here:
--   * Never guess. An unknown command returns `unsupported_command` loudly so
--     the agent reports a missing feature instead of silently doing nothing.
--   * Every mutation runs inside app.transaction so the user's Ctrl+Z undoes
--     one agent action, not forty stray pixels.
--   * Never leave the user's active sprite/frame/layer changed as a side effect.
--------------------------------------------------------------------------------

local PROTOCOL_VERSION = 1
local EXTENSION_VERSION = "0.1.0"

-- Optional capabilities. The wire version stays 1 across builds; new command
-- families are gated on these flags plus the loud unsupported_command reply,
-- so an older extension degrades visibly rather than mysteriously.
local FEATURES = { "draw_batch", "recolor", "validate", "tileset", "reference", "filmstrip" }

local CONFIG = {
  host = "127.0.0.1",
  port = tonumber(os.getenv("ASEPRITE_AI_PLUGIN_PORT") or "") or 9931,
  reconnect_tick = 2,        -- seconds between reconnect bookkeeping ticks
  connect_max_ticks = 3,     -- give a handshake ~6s before forcing a reset
  debug = os.getenv("ASEPRITE_AI_DEBUG") == "1",
}

local ws = nil
local connected = false
local connecting = false
local connecting_ticks = 0
local reconnect_timer = nil
-- Bumped on every connect attempt; events carrying an older value are stale.
local ws_generation = 0
-- Assigned near the bottom, once encode_json exists; see "Load marker".
local status_writer = nil

local function log(msg)
  if CONFIG.debug then print("[ai-artist] " .. tostring(msg)) end
end

--------------------------------------------------------------------------------
-- Errors
--------------------------------------------------------------------------------

-- A structured failure the agent can branch on. Raised with error() and caught
-- by the dispatcher; plain Lua errors become `aseprite_error`.
local function fault(code, message, details)
  error({ __fault = true, code = code, message = message, details = details or {} }, 0)
end

local function need(value, name)
  if value == nil then fault("invalid_args", "Missing required argument '" .. name .. "'.") end
  return value
end

--------------------------------------------------------------------------------
-- Colour helpers
--------------------------------------------------------------------------------

local function hex_to_color(hex)
  if type(hex) ~= "string" then fault("invalid_args", "Colour must be a string.") end
  local s = hex:gsub("^#", "")
  if #s ~= 6 and #s ~= 8 then
    fault("invalid_args", "Colour '" .. hex .. "' must be #rrggbb or #rrggbbaa.")
  end
  return Color{
    r = tonumber(s:sub(1, 2), 16),
    g = tonumber(s:sub(3, 4), 16),
    b = tonumber(s:sub(5, 6), 16),
    a = #s == 8 and tonumber(s:sub(7, 8), 16) or 255,
  }
end

local function color_to_hex(c, with_alpha)
  if with_alpha and c.alpha ~= 255 then
    return string.format("#%02x%02x%02x%02x", c.red, c.green, c.blue, c.alpha)
  end
  return string.format("#%02x%02x%02x", c.red, c.green, c.blue)
end

local function pixel_to_hex(sprite, value)
  local pc = app.pixelColor
  if sprite.colorMode == ColorMode.INDEXED then
    if value == sprite.transparentColor then return nil end
    local pal = sprite.palettes[1]
    if value >= #pal then return nil end
    return color_to_hex(pal:getColor(value), false)
  elseif sprite.colorMode == ColorMode.GRAY then
    local v, a = pc.grayaV(value), pc.grayaA(value)
    if a == 0 then return nil end
    return string.format("#%02x%02x%02x", v, v, v)
  else
    local a = pc.rgbaA(value)
    if a == 0 then return nil end
    if a == 255 then
      return string.format("#%02x%02x%02x", pc.rgbaR(value), pc.rgbaG(value), pc.rgbaB(value))
    end
    return string.format("#%02x%02x%02x%02x", pc.rgbaR(value), pc.rgbaG(value), pc.rgbaB(value), a)
  end
end

-- Convert a Color into the raw pixel value this sprite's colour mode stores.
local function color_to_pixel(sprite, color)
  local pc = app.pixelColor
  if sprite.colorMode == ColorMode.INDEXED then
    local pal = sprite.palettes[1]
    local best, best_d = 0, math.huge
    for i = 0, #pal - 1 do
      local p = pal:getColor(i)
      local d = (p.red - color.red) ^ 2 + (p.green - color.green) ^ 2 + (p.blue - color.blue) ^ 2
      if d < best_d then best, best_d = i, d end
    end
    return best
  elseif sprite.colorMode == ColorMode.GRAY then
    local v = math.floor(0.299 * color.red + 0.587 * color.green + 0.114 * color.blue + 0.5)
    return pc.graya(v, color.alpha)
  end
  return pc.rgba(color.red, color.green, color.blue, color.alpha)
end

--------------------------------------------------------------------------------
-- CIELAB — palette snapping must be perceptual, not RGB-Euclidean.
-- Mirrors src/lib/color.ts so both sides agree on "nearest colour".
--------------------------------------------------------------------------------

local function srgb_to_linear(c)
  local v = c / 255
  if v <= 0.04045 then return v / 12.92 end
  return ((v + 0.055) / 1.055) ^ 2.4
end

local function rgb_to_lab(r, g, b)
  local lr, lg, lb = srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b)
  local x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047
  local y = (0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb) / 1.00000
  local z = (0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb) / 1.08883
  local function f(t)
    if t > 216 / 24389 then return t ^ (1 / 3) end
    return (24389 / 27) * t / 116 + 16 / 116
  end
  local fx, fy, fz = f(x), f(y), f(z)
  return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)
end

local function delta_e(r1, g1, b1, r2, g2, b2)
  local l1, a1, bb1 = rgb_to_lab(r1, g1, b1)
  local l2, a2, bb2 = rgb_to_lab(r2, g2, b2)
  return math.sqrt((l1 - l2) ^ 2 + (a1 - a2) ^ 2 + (bb1 - bb2) ^ 2)
end

local function snap_color_to_palette(sprite, color)
  local pal = sprite.palettes[1]
  if not pal or #pal == 0 then return color, 0 end
  local best, best_d = nil, math.huge
  for i = 0, #pal - 1 do
    local p = pal:getColor(i)
    if p.alpha > 0 then
      local d = delta_e(color.red, color.green, color.blue, p.red, p.green, p.blue)
      if d < best_d then best, best_d = p, d end
    end
  end
  if not best then return color, 0 end
  return Color{ r = best.red, g = best.green, b = best.blue, a = color.alpha }, best_d
end

--------------------------------------------------------------------------------
-- Site resolution — every command works against an explicit target, falling
-- back to whatever the user has focused, and restores focus when it is done.
--------------------------------------------------------------------------------

local function sprite_display_name(s)
  local base = app.fs.fileName(s.filename or "")
  return base ~= "" and base or "untitled"
end

--- Resolve a sprite from an id ("#7" or 7), a full path, or a display name.
--- Ids are what every result reports back, because two unsaved documents both
--- answer to "Sprite" and a name lookup silently picks whichever comes first.
local function find_sprite(name)
  if name == nil or name == "" then
    local s = app.sprite
    if not s then fault("no_active_sprite", "No sprite is open in Aseprite.") end
    return s
  end

  local wanted_id = tonumber(tostring(name):match("^#?(%d+)$"))
  if wanted_id then
    for _, s in ipairs(app.sprites) do
      if s.id == wanted_id then return s end
    end
  end

  local matches = {}
  for _, s in ipairs(app.sprites) do
    if s.filename == name or sprite_display_name(s) == name
       or sprite_display_name(s) == name then
      matches[#matches + 1] = s
    end
  end
  if #matches == 1 then return matches[1] end
  if #matches > 1 then
    local ids = {}
    for _, s in ipairs(matches) do ids[#ids + 1] = "#" .. tostring(s.id) end
    fault("invalid_args", "'" .. tostring(name) .. "' matches " .. #matches ..
      " open sprites (" .. table.concat(ids, ", ") .. "). Pass one of those ids instead.")
  end

  local open = {}
  for _, s in ipairs(app.sprites) do
    open[#open + 1] = sprite_display_name(s) .. " (#" .. tostring(s.id) .. ")"
  end
  fault("invalid_args", "No open sprite matches '" .. tostring(name) .. "'. Open: " ..
    (#open > 0 and table.concat(open, ", ") or "(none)") .. ".")
end

local function find_layer(sprite, name)
  if name == nil or name == "" then
    local l = app.layer
    if l and l.sprite == sprite then return l end
    if #sprite.layers == 0 then fault("invalid_args", "Sprite has no layers.") end
    return sprite.layers[#sprite.layers]
  end
  local function search(layers)
    for _, l in ipairs(layers) do
      if l.name == name then return l end
      if l.isGroup then
        local found = search(l.layers)
        if found then return found end
      end
    end
    return nil
  end
  local found = search(sprite.layers)
  if not found then fault("invalid_args", "No layer named '" .. tostring(name) .. "'.") end
  return found
end

local function find_frame(sprite, number)
  if number == nil then
    local f = app.frame
    if f and f.sprite == sprite then return f end
    return sprite.frames[1]
  end
  local n = math.floor(number)
  if n < 1 or n > #sprite.frames then
    fault("invalid_args", "Frame " .. n .. " is out of range (1.." .. #sprite.frames .. ").")
  end
  return sprite.frames[n]
end

-- Run fn with the user's active sprite/layer/frame restored afterwards.
local function preserving_site(fn)
  local sprite, layer, frame = app.sprite, app.layer, app.frame
  local ok, result = pcall(fn)
  if sprite then pcall(function() app.sprite = sprite end) end
  if layer then pcall(function() app.layer = layer end) end
  if frame then pcall(function() app.frame = frame end) end
  if not ok then error(result, 0) end
  return result
end

-- app.transaction gained a name argument in 1.3; fall back for older builds so
-- the extension still works, just with a less descriptive undo entry.
local function transact(name, fn)
  local ok, err = pcall(function() app.transaction(name, fn) end)
  if ok then return end
  local ok2, err2 = pcall(function() app.transaction(fn) end)
  if not ok2 then error(err2 or err, 0) end
end

--------------------------------------------------------------------------------
-- Cel access
--------------------------------------------------------------------------------

--- True when this cel shares its image with another frame's cel on the same
--- layer, which is what Aseprite's "linked cel" is.
local function is_linked_cel(layer, cel)
  local id = cel.image and cel.image.id
  if not id then return false end
  for _, other in ipairs(layer.cels) do
    if other.frameNumber ~= cel.frameNumber and other.image and other.image.id == id then
      return true
    end
  end
  return false
end

local function get_cel(sprite, layer, frame, create)
  local cel = layer:cel(frame)
  if cel then return cel end
  if not create then return nil end
  if layer.isGroup then fault("invalid_args", "'" .. layer.name .. "' is a group and cannot hold pixels.") end
  local image = Image(sprite.width, sprite.height, sprite.colorMode)
  return sprite:newCel(layer, frame, image, Point(0, 0))
end

-- Cels are only as large as their content, so a draw at canvas coordinates has
-- to grow the cel first. Growing means a new image the size of the union.
local function ensure_cel_covers(sprite, cel, bounds)
  local current = cel.bounds
  local minx = math.min(current.x, bounds.x)
  local miny = math.min(current.y, bounds.y)
  local maxx = math.max(current.x + current.width, bounds.x + bounds.width)
  local maxy = math.max(current.y + current.height, bounds.y + bounds.height)

  -- Clamp to the canvas; pixels outside it are invisible and Aseprite trims them.
  minx = math.max(0, minx); miny = math.max(0, miny)
  maxx = math.min(sprite.width, maxx); maxy = math.min(sprite.height, maxy)
  if maxx <= minx or maxy <= miny then return cel end

  if minx == current.x and miny == current.y
     and maxx == current.x + current.width and maxy == current.y + current.height then
    return cel
  end

  local grown = Image(maxx - minx, maxy - miny, sprite.colorMode)
  grown:drawImage(cel.image, Point(current.x - minx, current.y - miny))
  cel.image = grown
  cel.position = Point(minx, miny)
  return cel
end

--------------------------------------------------------------------------------
-- Region reading
--------------------------------------------------------------------------------

local function clamp_region(sprite, region)
  local r = region or {}
  local x = math.max(0, math.floor(r.x or 0))
  local y = math.max(0, math.floor(r.y or 0))
  local w = math.floor(r.width or (sprite.width - x))
  local h = math.floor(r.height or (sprite.height - y))
  w = math.min(w, sprite.width - x)
  h = math.min(h, sprite.height - y)
  if w <= 0 or h <= 0 then
    fault("invalid_args", "Region is empty after clamping to the " ..
      sprite.width .. "x" .. sprite.height .. " canvas.")
  end
  return { x = x, y = y, width = w, height = h }
end

-- Returns { colors = {...}, grid = {...} } where index 1 (wire index 0) is
-- always transparent. Sending distinct colours plus indices keeps a 64x64 read
-- at a few KB instead of a wall of hex strings.
local function read_region(sprite, layer, frame, region, composite)
  local r = clamp_region(sprite, region)
  local source

  if composite then
    source = Image(sprite.width, sprite.height, sprite.colorMode)
    source:drawSprite(sprite, frame)
  else
    local cel = get_cel(sprite, layer, frame, false)
    source = Image(sprite.width, sprite.height, sprite.colorMode)
    if cel then source:drawImage(cel.image, cel.position) end
  end

  local colors = { false } -- placeholder; index 1 == transparent
  local lookup = {}
  local grid = {}
  local n = 0

  for row = 0, r.height - 1 do
    for col = 0, r.width - 1 do
      local hex = pixel_to_hex(sprite, source:getPixel(r.x + col, r.y + row))
      local idx = 0
      if hex then
        idx = lookup[hex]
        if not idx then
          n = n + 1
          idx = n
          lookup[hex] = idx
          colors[idx + 1] = hex
        end
      end
      grid[#grid + 1] = idx
    end
  end

  colors[1] = "#00000000"
  return {
    sprite = app.fs.fileName(sprite.filename or "") ,
    x = r.x, y = r.y, width = r.width, height = r.height,
    colors = colors, grid = grid,
  }
end

--------------------------------------------------------------------------------
-- Drawing primitives, operating on a plain image at cel-local coordinates.
--------------------------------------------------------------------------------

local Draw = {}

function Draw.pixel(img, ox, oy, x, y, value)
  local lx, ly = x - ox, y - oy
  if lx >= 0 and ly >= 0 and lx < img.width and ly < img.height then
    img:drawPixel(lx, ly, value)
    return 1
  end
  return 0
end

function Draw.line(img, ox, oy, x0, y0, x1, y1, value, thickness)
  -- Bresenham. Aseprite has a line tool, but going through app.useTool changes
  -- the user's brush and active colour, which is rude in the middle of a batch.
  local count = 0
  local dx = math.abs(x1 - x0)
  local dy = -math.abs(y1 - y0)
  local sx = x0 < x1 and 1 or -1
  local sy = y0 < y1 and 1 or -1
  local err = dx + dy
  local half = math.floor((thickness or 1) / 2)

  while true do
    if (thickness or 1) <= 1 then
      count = count + Draw.pixel(img, ox, oy, x0, y0, value)
    else
      for ty = -half, half do
        for tx = -half, half do
          count = count + Draw.pixel(img, ox, oy, x0 + tx, y0 + ty, value)
        end
      end
    end
    if x0 == x1 and y0 == y1 then break end
    local e2 = 2 * err
    if e2 >= dy then err = err + dy; x0 = x0 + sx end
    if e2 <= dx then err = err + dx; y0 = y0 + sy end
  end
  return count
end

function Draw.rect(img, ox, oy, r, outline, fill)
  local count = 0
  if fill then
    for y = r.y, r.y + r.height - 1 do
      for x = r.x, r.x + r.width - 1 do
        count = count + Draw.pixel(img, ox, oy, x, y, fill)
      end
    end
  end
  if outline then
    local x1, y1 = r.x + r.width - 1, r.y + r.height - 1
    count = count + Draw.line(img, ox, oy, r.x, r.y, x1, r.y, outline, 1)
    count = count + Draw.line(img, ox, oy, r.x, y1, x1, y1, outline, 1)
    count = count + Draw.line(img, ox, oy, r.x, r.y, r.x, y1, outline, 1)
    count = count + Draw.line(img, ox, oy, x1, r.y, x1, y1, outline, 1)
  end
  return count
end

function Draw.ellipse(img, ox, oy, r, outline, fill)
  -- Midpoint ellipse over the bounding box, scan-filled row by row so an
  -- odd-width ellipse stays symmetric — asymmetry is very visible at 16px.
  local count = 0
  local cx = r.x + (r.width - 1) / 2
  local cy = r.y + (r.height - 1) / 2
  local rx = (r.width - 1) / 2
  local ry = (r.height - 1) / 2
  if rx < 0.5 or ry < 0.5 then
    return Draw.rect(img, ox, oy, r, outline, fill)
  end

  local function inside(x, y)
    local nx = (x - cx) / rx
    local ny = (y - cy) / ry
    return nx * nx + ny * ny <= 1.0
  end

  for y = r.y, r.y + r.height - 1 do
    for x = r.x, r.x + r.width - 1 do
      if inside(x, y) then
        local edge = not (inside(x - 1, y) and inside(x + 1, y) and inside(x, y - 1) and inside(x, y + 1))
        local value = edge and outline or fill
        if value then count = count + Draw.pixel(img, ox, oy, x, y, value) end
      end
    end
  end
  return count
end

function Draw.polygon(img, ox, oy, points, outline, fill, closed)
  local count = 0
  if fill and #points >= 3 then
    local miny, maxy = math.huge, -math.huge
    for _, p in ipairs(points) do
      miny = math.min(miny, p.y); maxy = math.max(maxy, p.y)
    end
    for y = math.floor(miny), math.floor(maxy) do
      local crossings = {}
      for i = 1, #points do
        local a = points[i]
        local b = points[i % #points + 1]
        if (a.y <= y and b.y > y) or (b.y <= y and a.y > y) then
          crossings[#crossings + 1] = a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x)
        end
      end
      table.sort(crossings)
      for i = 1, #crossings - 1, 2 do
        for x = math.floor(crossings[i] + 0.5), math.floor(crossings[i + 1] - 0.5) do
          count = count + Draw.pixel(img, ox, oy, x, y, fill)
        end
      end
    end
  end
  if outline then
    -- Wrap the same way the fill loop above does. Stopping at #points - 1 draws
    -- every edge except the one that closes the shape, so a "closed" triangle
    -- shipped with one side missing and the call still reported success.
    local last = closed and #points or (#points - 1)
    for i = 1, last do
      local a = points[i]
      local b = points[i % #points + 1]
      count = count + Draw.line(img, ox, oy, a.x, a.y, b.x, b.y, outline, 1)
    end
  end
  return count
end

function Draw.flood(img, ox, oy, sx, sy, value, tolerance, contiguous)
  local lx, ly = sx - ox, sy - oy
  if lx < 0 or ly < 0 or lx >= img.width or ly >= img.height then return 0 end
  local target = img:getPixel(lx, ly)
  if target == value then return 0 end

  local count = 0
  if not contiguous then
    for y = 0, img.height - 1 do
      for x = 0, img.width - 1 do
        if img:getPixel(x, y) == target then
          img:drawPixel(x, y, value); count = count + 1
        end
      end
    end
    return count
  end

  local stack = { { lx, ly } }
  local seen = {}
  while #stack > 0 do
    local p = table.remove(stack)
    local x, y = p[1], p[2]
    local key = y * img.width + x
    if not seen[key] and x >= 0 and y >= 0 and x < img.width and y < img.height then
      seen[key] = true
      if img:getPixel(x, y) == target then
        img:drawPixel(x, y, value)
        count = count + 1
        stack[#stack + 1] = { x + 1, y }
        stack[#stack + 1] = { x - 1, y }
        stack[#stack + 1] = { x, y + 1 }
        stack[#stack + 1] = { x, y - 1 }
      end
    end
  end
  return count
end

-- Ordered dither matrices. Bayer keeps texture even at low pixel counts, where
-- random noise just looks like dirt.
local BAYER = {
  checker = { size = 2, m = { { 0, 2 }, { 3, 1 } } },
  bayer2  = { size = 2, m = { { 0, 2 }, { 3, 1 } } },
  bayer4  = { size = 4, m = {
    { 0, 8, 2, 10 }, { 12, 4, 14, 6 }, { 3, 11, 1, 9 }, { 15, 7, 13, 5 } } },
  bayer8  = { size = 8, m = nil }, -- built below
}

do
  -- 8x8 Bayer generated from the 4x4 recurrence rather than typed out.
  local m4 = BAYER.bayer4.m
  local m8 = {}
  for y = 1, 8 do
    m8[y] = {}
    for x = 1, 8 do
      local q = m4[((y - 1) % 4) + 1][((x - 1) % 4) + 1]
      local quadrant = (y > 4 and 2 or 0) + (x > 4 and 1 or 0)
      m8[y][x] = q * 4 + ({ [0] = 0, [1] = 2, [2] = 3, [3] = 1 })[quadrant]
    end
  end
  BAYER.bayer8.m = m8
end

function Draw.dither(img, ox, oy, r, a, b, pattern, ratio)
  local spec = BAYER[pattern]
  local count = 0
  for y = r.y, r.y + r.height - 1 do
    for x = r.x, r.x + r.width - 1 do
      local pick
      if pattern == "noise" then
        pick = math.random() < ratio
      else
        local size = spec.size
        local threshold = (spec.m[(y % size) + 1][(x % size) + 1] + 0.5) / (size * size)
        pick = ratio > threshold
      end
      count = count + Draw.pixel(img, ox, oy, x, y, pick and b or a)
    end
  end
  return count
end

--------------------------------------------------------------------------------
-- JSON encoding
--
-- Aseprite ships json.decode/json.encode, but its encoder renders an empty Lua
-- table as `{}`, and this protocol has fields the server validates as arrays
-- (colorsSnapped, findings, files…). An empty result would fail schema
-- validation on the far side and turn a successful edit into an error the user
-- sees. Encoding here fixes the rule explicitly: a table is an array unless it
-- has a non-integer key.
--------------------------------------------------------------------------------

local function is_array(t)
  for k in pairs(t) do
    if type(k) ~= "number" then return false end
  end
  return true
end

local ESCAPES = {
  ['"'] = '\\"', ["\\"] = "\\\\", ["\b"] = "\\b", ["\f"] = "\\f",
  ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t",
}

local function encode_string(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    return ESCAPES[c] or string.format("\\u%04x", c:byte())
  end) .. '"'
end

local encode_value

local function encode_table(t, depth)
  if depth > 24 then return "null" end
  if is_array(t) then
    local parts = {}
    for i = 1, #t do parts[i] = encode_value(t[i], depth + 1) end
    return "[" .. table.concat(parts, ",") .. "]"
  end
  local parts = {}
  for k, v in pairs(t) do
    local encoded = encode_value(v, depth + 1)
    if encoded ~= nil then
      parts[#parts + 1] = encode_string(tostring(k)) .. ":" .. encoded
    end
  end
  return "{" .. table.concat(parts, ",") .. "}"
end

encode_value = function(v, depth)
  local t = type(v)
  if v == nil then return "null" end
  if t == "boolean" then return tostring(v) end
  if t == "string" then return encode_string(v) end
  if t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return "null" end
    if v == math.floor(v) and math.abs(v) < 2 ^ 53 then return string.format("%d", v) end
    return string.format("%.6g", v)
  end
  if t == "table" then return encode_table(v, depth or 0) end
  return encode_string(tostring(v))
end

local function encode_json(v) return encode_value(v, 0) end

--------------------------------------------------------------------------------
-- Command handlers
--------------------------------------------------------------------------------

local H = {}

local function sprite_summary(s)
  return {
    id = s.id,
    name = sprite_display_name(s),
    filename = s.filename ~= "" and s.filename or nil,
    width = s.width,
    height = s.height,
    colorMode = ({ [ColorMode.RGB] = "rgb", [ColorMode.GRAY] = "grayscale", [ColorMode.INDEXED] = "indexed" })[s.colorMode],
    frames = #s.frames,
    layers = #s.layers,
  }
end

H["session.site"] = function()
  return {
    sprite = app.sprite and sprite_summary(app.sprite) or nil,
    layer = app.layer and app.layer.name or nil,
    frame = app.frame and app.frame.frameNumber or nil,
    openSprites = #app.sprites,
  }
end

local function flatten_layers(layers, parent, out)
  for _, l in ipairs(layers) do
    local cels = {}
    if not l.isGroup then
      for _, c in ipairs(l.cels) do cels[#cels + 1] = c.frameNumber end
    end
    out[#out + 1] = {
      name = l.name,
      index = l.stackIndex,
      visible = l.isVisible,
      editable = l.isEditable,
      opacity = l.opacity or 255,
      blendMode = tostring(l.blendMode or "normal"),
      isGroup = l.isGroup or false,
      isTilemap = l.isTilemap or false,
      parent = parent,
      cels = cels,
    }
    if l.isGroup then flatten_layers(l.layers, l.name, out) end
  end
  return out
end

H["sprite.info"] = function(args)
  local s = find_sprite(args.sprite)
  local layers = flatten_layers(s.layers, nil, {})

  local frames = {}
  for i, f in ipairs(s.frames) do
    frames[i] = { number = i, durationMs = math.floor(f.duration * 1000 + 0.5) }
  end

  local tags = {}
  for i, t in ipairs(s.tags) do
    tags[i] = {
      name = t.name,
      from = t.fromFrame.frameNumber,
      to = t.toFrame.frameNumber,
      direction = tostring(t.aniDir),
      repeats = t.repeats,
    }
  end

  local result = {
    id = s.id,
    name = sprite_display_name(s),
    filename = s.filename ~= "" and s.filename or nil,
    width = s.width,
    height = s.height,
    colorMode = ({ [ColorMode.RGB] = "rgb", [ColorMode.GRAY] = "grayscale", [ColorMode.INDEXED] = "indexed" })[s.colorMode],
    transparentIndex = s.colorMode == ColorMode.INDEXED and s.transparentColor or nil,
    frameCount = #s.frames,
    layers = layers,
    frames = frames,
    tags = tags,
    modified = s.isModified,
    activeLayer = (app.layer and app.layer.sprite == s) and app.layer.name or nil,
    activeFrame = (app.frame and app.frame.sprite == s) and app.frame.frameNumber or nil,
  }

  if args.includePalette ~= false then
    local pal = s.palettes[1]
    local colors = {}
    for i = 0, #pal - 1 do colors[i + 1] = color_to_hex(pal:getColor(i), true) end
    result.palette = colors
  end

  if args.includeSlices then
    local slices = {}
    for i, sl in ipairs(s.slices) do
      slices[i] = { name = sl.name, bounds = {
        x = sl.bounds.x, y = sl.bounds.y, width = sl.bounds.width, height = sl.bounds.height } }
    end
    result.slices = slices
  end

  local sel = s.selection
  if sel and not sel.isEmpty then
    result.selection = { x = sel.bounds.x, y = sel.bounds.y, width = sel.bounds.width, height = sel.bounds.height }
  end

  return result
end

local ANCHORS = {
  top_left = { 0, 0 }, top = { 0.5, 0 }, top_right = { 1, 0 },
  left = { 0, 0.5 }, center = { 0.5, 0.5 }, right = { 1, 0.5 },
  bottom_left = { 0, 1 }, bottom = { 0.5, 1 }, bottom_right = { 1, 1 },
}

H["sprite.manage"] = function(args)
  local op = need(args.op, "op")

  if op == "list" then
    local out = {}
    for i, s in ipairs(app.sprites) do
      local sum = sprite_summary(s)
      sum.active = (s == app.sprite)
      sum.modified = s.isModified
      out[i] = sum
    end
    return { sprites = out }
  end

  if op == "new" then
    local mode = ({ rgb = ColorMode.RGB, grayscale = ColorMode.GRAY, indexed = ColorMode.INDEXED })[args.colorMode or "rgb"]
    local s = Sprite(need(args.width, "width"), need(args.height, "height"), mode)
    app.sprite = s
    return { sprite = sprite_display_name(s), id = s.id, width = s.width, height = s.height }
  end

  if op == "open" then
    local s = app.open(need(args.path, "path"))
    if not s then fault("aseprite_error", "Aseprite could not open '" .. args.path .. "'.") end
    app.sprite = s
    return { sprite = sprite_display_name(s), id = s.id, width = s.width, height = s.height }
  end

  local s = find_sprite(args.sprite)

  if op == "activate" then
    app.sprite = s
    return { sprite = sprite_display_name(s), id = s.id }
  end

  if op == "save" then
    if (s.filename or "") == "" then
      fault("invalid_args", "This sprite has never been saved. Use op 'save_as' with a path.")
    end
    preserving_site(function() app.sprite = s; app.command.SaveFile() end)
    return { sprite = sprite_display_name(s), id = s.id, path = s.filename }
  end

  if op == "save_as" then
    s:saveAs(need(args.path, "path"))
    return { sprite = sprite_display_name(s), id = s.id, path = s.filename }
  end

  if op == "close" then
    local name = sprite_display_name(s)
    local id = s.id
    s:close()
    return { sprite = name, id = id }
  end

  if op == "resize_canvas" then
    local w = args.width or s.width
    local h = args.height or s.height
    local anchor = ANCHORS[args.anchor or "center"] or ANCHORS.center
    local dx = math.floor((w - s.width) * anchor[1])
    local dy = math.floor((h - s.height) * anchor[2])
    transact("AI: resize canvas", function()
      s:crop(-dx, -dy, w, h)
    end)
    return { sprite = sprite_display_name(s), width = s.width, height = s.height }
  end

  if op == "set_properties" then
    transact("AI: sprite properties", function()
      if args.pixelAspect then
        local wx, wy = args.pixelAspect:match("^(%d+):(%d+)$")
        if wx then s.pixelRatio = Size(tonumber(wx), tonumber(wy)) end
      end
      if args.colorMode then
        local target = ({ rgb = ColorMode.RGB, grayscale = ColorMode.GRAY, indexed = ColorMode.INDEXED })[args.colorMode]
        if target and target ~= s.colorMode then
          preserving_site(function()
            app.sprite = s
            app.command.ChangePixelFormat{ format = args.colorMode == "grayscale" and "gray" or args.colorMode }
          end)
        end
      end
    end)
    return { sprite = sprite_display_name(s), width = s.width, height = s.height }
  end

  fault("unsupported_command", "sprite.manage does not support op '" .. tostring(op) .. "'.")
end

H["pixels.read"] = function(args)
  local s = find_sprite(args.sprite)
  local layer = args.composite and nil or find_layer(s, args.layer)
  local frame = find_frame(s, args.frame)
  return read_region(s, layer, frame, args.region, args.composite ~= false)
end

--------------------------------------------------------------------------------
-- Looking: previews and filmstrips.
--
-- Upscaling happens here rather than in the server so the package needs no
-- native image dependency; Aseprite already has a correct nearest-neighbour
-- resize. Both operate on a throwaway copy so the user's document is untouched.
--------------------------------------------------------------------------------

--- Integer upscale for a preview. Bounded by the OUTPUT edge, not by the
--- factor: capping the factor at 16 rendered a 16px sprite at 256px and an 8px
--- one at 128px, which are precisely the sizes a vision model cannot read.
local PREVIEW_TARGET_EDGE = 1024
local PREVIEW_MAX_EDGE = 2048

local function pick_scale(w, h, requested)
  local long = math.max(w, h, 1)
  local by_output = math.max(1, math.floor(PREVIEW_MAX_EDGE / long))
  if requested and requested > 0 then
    return math.max(1, math.min(math.floor(requested), by_output))
  end
  local wanted = math.max(1, math.floor(PREVIEW_TARGET_EDGE / long + 0.5))
  return math.min(wanted, by_output)
end

H["look.preview"] = function(args)
  local s = find_sprite(args.sprite)
  local frame = find_frame(s, args.frame)
  local path = need(args.path, "path")

  local region = args.region and clamp_region(s, args.region) or
    { x = 0, y = 0, width = s.width, height = s.height }

  local flat = Image(s.width, s.height, s.colorMode)
  if args.layer then
    local cel = get_cel(s, find_layer(s, args.layer), frame, false)
    if cel then flat:drawImage(cel.image, cel.position) end
  else
    flat:drawSprite(s, frame)
  end

  local cropped = Image(region.width, region.height, s.colorMode)
  cropped:drawImage(flat, Point(-region.x, -region.y))

  local scale = pick_scale(region.width, region.height, args.scale)
  -- The scratch sprite is created inside preserving_site so the user's active
  -- document is what gets restored, not the throwaway we just closed.
  preserving_site(function()
    local out = Sprite(region.width, region.height, s.colorMode)
    if s.colorMode == ColorMode.INDEXED then out:setPalette(s.palettes[1]) end
    out.cels[1].image = cropped
    if scale > 1 then out:resize(region.width * scale, region.height * scale) end
    out:saveCopyAs(path)
    out:close()
  end)

  return {
    sprite = sprite_display_name(s),
    sourceWidth = region.width, sourceHeight = region.height,
    width = region.width * scale, height = region.height * scale,
    scale = scale,
  }
end

H["look.filmstrip"] = function(args)
  local s = find_sprite(args.sprite)
  local path = need(args.path, "path")
  local count = #s.frames
  if count == 0 then fault("invalid_args", "Sprite has no frames.") end

  local cols = math.ceil(math.sqrt(count))
  local rows = math.ceil(count / cols)
  local gap = 1
  local cellW, cellH = s.width + gap, s.height + gap
  local stripW = cols * cellW - gap
  local stripH = rows * cellH - gap

  local strip = Image(stripW, stripH, ColorMode.RGB)
  -- Mid grey between cells, so frame boundaries are unambiguous even when the
  -- art itself runs to the edge of the canvas.
  strip:clear(app.pixelColor.rgba(64, 64, 72, 255))

  for i, frame in ipairs(s.frames) do
    local cell = Image(s.width, s.height, s.colorMode)
    cell:drawSprite(s, frame)
    local rgb = cell.colorMode == ColorMode.RGB and cell or Image(cell, nil)
    local col = (i - 1) % cols
    local row = math.floor((i - 1) / cols)
    strip:drawImage(rgb, Point(col * cellW, row * cellH))
  end

  local scale = pick_scale(stripW, stripH, args.scale)
  preserving_site(function()
    local out = Sprite(stripW, stripH, ColorMode.RGB)
    out.cels[1].image = strip
    if scale > 1 then out:resize(stripW * scale, stripH * scale) end
    out:saveCopyAs(path)
    out:close()
  end)

  return {
    sprite = sprite_display_name(s),
    frames = count, scale = scale,
    width = stripW * scale, height = stripH * scale,
  }
end

--------------------------------------------------------------------------------
-- draw.batch — the workhorse. Every op lands in one transaction.
--------------------------------------------------------------------------------

local function op_bounds(sprite, op)
  local function pts(list)
    local minx, miny, maxx, maxy = math.huge, math.huge, -math.huge, -math.huge
    for _, p in ipairs(list) do
      minx = math.min(minx, p.x); miny = math.min(miny, p.y)
      maxx = math.max(maxx, p.x); maxy = math.max(maxy, p.y)
    end
    return { x = minx, y = miny, width = maxx - minx + 1, height = maxy - miny + 1 }
  end

  -- A brush wider than 1px paints beyond its endpoints. Without this padding the
  -- cel is grown to the endpoints only, and Draw.pixel silently clips the rest
  -- of the stamp — reporting success and a bounding box that hides the loss.
  local function pad(box, amount)
    if amount <= 0 then return box end
    return {
      x = box.x - amount, y = box.y - amount,
      width = box.width + amount * 2, height = box.height + amount * 2,
    }
  end

  if op.kind == "pixels" then return pts(op.points) end
  if op.kind == "line" then
    return pad(pts({ op.from, op.to }), math.floor((op.thickness or 1) / 2))
  end
  if op.kind == "polyline" then return pts(op.points) end
  if op.kind == "rect" or op.kind == "ellipse" or op.kind == "dither" or op.kind == "gradient" then
    return op.rect
  end
  if op.kind == "fill" then return { x = 0, y = 0, width = sprite.width, height = sprite.height } end
  if op.kind == "replace" then
    return op.region or { x = 0, y = 0, width = sprite.width, height = sprite.height }
  end
  if op.kind == "clear" then
    return op.region or { x = 0, y = 0, width = sprite.width, height = sprite.height }
  end
  if op.kind == "blit" then
    return { x = op.to.x, y = op.to.y, width = op.from.width, height = op.from.height }
  end
  return { x = 0, y = 0, width = sprite.width, height = sprite.height }
end

H["draw.batch"] = function(args)
  local s = find_sprite(args.sprite)
  local layer = find_layer(s, args.layer)
  local frame = find_frame(s, args.frame)
  local ops = need(args.ops, "ops")
  if layer.isGroup then
    fault("invalid_args", "'" .. layer.name .. "' is a group layer and holds no pixels. Target a child layer.")
  end

  local snapped = {}
  local seen_snap = {}

  -- Resolve every colour up front: the palette lock has to be visible to the
  -- agent as a report, not applied invisibly mid-draw.
  local function resolve(hex)
    if hex == nil then return nil end
    local color = hex_to_color(hex)
    if args.paletteLock ~= false and s.colorMode ~= ColorMode.INDEXED then
      local snapped_color, distance = snap_color_to_palette(s, color)
      local to = color_to_hex(snapped_color, false)
      local from = color_to_hex(color, false)
      if to ~= from and not seen_snap[from] then
        seen_snap[from] = true
        snapped[#snapped + 1] = { from = from, to = to, deltaE = math.floor(distance * 100 + 0.5) / 100 }
      end
      color = snapped_color
    end
    return color_to_pixel(s, color)
  end

  local changed = 0
  local union = nil
  local function extend(b)
    if not b then return end
    if not union then union = { x = b.x, y = b.y, width = b.width, height = b.height }; return end
    local x1 = math.min(union.x, b.x)
    local y1 = math.min(union.y, b.y)
    local x2 = math.max(union.x + union.width, b.x + b.width)
    local y2 = math.max(union.y + union.height, b.y + b.height)
    union = { x = x1, y = y1, width = x2 - x1, height = y2 - y1 }
  end

  local selection = args.selectionOnly and s.selection or nil
  if args.selectionOnly and (not selection or selection.isEmpty) then
    fault("invalid_args",
      "selectionOnly was set but nothing is selected. Falling back to the whole cel would " ..
      "repaint far more than you asked for, so this refuses instead. Make a selection with " ..
      "the select tool first, or drop selectionOnly.")
  end

  transact(args.label and ("AI: " .. args.label) or "AI: draw", function()
    local cel = get_cel(s, layer, frame, args.createCel ~= false)
    if not cel then
      fault("invalid_args", "No cel on '" .. layer.name .. "' frame " .. frame.frameNumber ..
        " and createCel is false.")
    end

    -- Grow once for the whole batch rather than per op.
    local needed = nil
    for _, op in ipairs(ops) do
      local b = op_bounds(s, op)
      if b then
        if not needed then needed = { x = b.x, y = b.y, width = b.width, height = b.height }
        else
          local x1 = math.min(needed.x, b.x); local y1 = math.min(needed.y, b.y)
          local x2 = math.max(needed.x + needed.width, b.x + b.width)
          local y2 = math.max(needed.y + needed.height, b.y + b.height)
          needed = { x = x1, y = y1, width = x2 - x1, height = y2 - y1 }
        end
      end
    end
    if needed then cel = ensure_cel_covers(s, cel, needed) end

    local img = cel.image:clone()
    local ox, oy = cel.position.x, cel.position.y

    for _, op in ipairs(ops) do
      local kind = op.kind
      if kind == "pixels" then
        local fallback = resolve(op.color)
        for _, p in ipairs(op.points) do
          local value = p.color and resolve(p.color) or fallback
          if value == nil then fault("invalid_args", "A pixel has no colour and the op has no default `color`.") end
          if not selection or selection:contains(p.x, p.y) then
            changed = changed + Draw.pixel(img, ox, oy, p.x, p.y, value)
          end
        end
      elseif kind == "line" then
        changed = changed + Draw.line(img, ox, oy, op.from.x, op.from.y, op.to.x, op.to.y,
          resolve(op.color), op.thickness or 1)
      elseif kind == "polyline" then
        local points = op.points
        if op.closed then
          changed = changed + Draw.polygon(img, ox, oy, points, resolve(op.color),
            op.fill and resolve(op.fill) or nil, true)
        else
          for i = 1, #points - 1 do
            changed = changed + Draw.line(img, ox, oy,
              points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, resolve(op.color), 1)
          end
        end
      elseif kind == "rect" then
        changed = changed + Draw.rect(img, ox, oy, op.rect, resolve(op.color),
          op.fill and resolve(op.fill) or nil)
      elseif kind == "ellipse" then
        changed = changed + Draw.ellipse(img, ox, oy, op.rect, resolve(op.color),
          op.fill and resolve(op.fill) or nil)
      elseif kind == "fill" then
        changed = changed + Draw.flood(img, ox, oy, op.at.x, op.at.y, resolve(op.color),
          op.tolerance or 0, op.contiguous ~= false)
      elseif kind == "replace" then
        local from = resolve(op.from)
        local to = resolve(op.to)
        local r = op.region and clamp_region(s, op.region) or
          { x = ox, y = oy, width = img.width, height = img.height }
        for y = 0, img.height - 1 do
          for x = 0, img.width - 1 do
            local gx, gy = x + ox, y + oy
            if gx >= r.x and gy >= r.y and gx < r.x + r.width and gy < r.y + r.height
               and img:getPixel(x, y) == from then
              img:drawPixel(x, y, to)
              changed = changed + 1
            end
          end
        end
      elseif kind == "dither" then
        changed = changed + Draw.dither(img, ox, oy, op.rect, resolve(op.colorA), resolve(op.colorB),
          op.pattern or "bayer4", op.ratio or 0.5)
      elseif kind == "gradient" then
        local steps = op.steps or 4
        local from = hex_to_color(op.from)
        local to = hex_to_color(op.to)
        local r = op.rect
        local direction = op.direction or "vertical"

        -- One colour per band, resolved once: resolve() also reports palette
        -- snapping, and doing it per pixel would flood that report.
        local band = {}
        for i = 0, steps - 1 do
          local t = steps == 1 and 0 or i / (steps - 1)
          band[i] = resolve(color_to_hex(Color{
            r = math.floor(from.red   + (to.red   - from.red)   * t + 0.5),
            g = math.floor(from.green + (to.green - from.green) * t + 0.5),
            b = math.floor(from.blue  + (to.blue  - from.blue)  * t + 0.5),
            a = 255,
          }, false))
        end

        local cx = r.x + (r.width - 1) / 2
        local cy = r.y + (r.height - 1) / 2
        -- Centre to corner, so the outermost band lands on the rect's corners.
        local radius = math.max(1, math.sqrt((r.width / 2) ^ 2 + (r.height / 2) ^ 2))

        local function position(x, y)
          if direction == "horizontal" then
            return r.width  <= 1 and 0 or (x - r.x) / (r.width - 1)
          elseif direction == "diagonal" then
            local span = (r.width - 1) + (r.height - 1)
            return span <= 0 and 0 or ((x - r.x) + (y - r.y)) / span
          elseif direction == "radial" then
            return math.min(1, math.sqrt((x - cx) ^ 2 + (y - cy) ^ 2) / radius)
          end
          return r.height <= 1 and 0 or (y - r.y) / (r.height - 1)
        end

        local spec = BAYER.bayer4
        for y = r.y, r.y + r.height - 1 do
          for x = r.x, r.x + r.width - 1 do
            local f = position(x, y) * (steps - 1)
            local lo = math.max(0, math.min(steps - 1, math.floor(f)))
            local index = lo
            if op.dither and lo < steps - 1 then
              -- Ordered dither across the band boundary: the fractional part is
              -- the probability of taking the next band, thresholded by Bayer so
              -- the texture is stable rather than noisy.
              local threshold = (spec.m[(y % spec.size) + 1][(x % spec.size) + 1] + 0.5)
                / (spec.size * spec.size)
              if (f - lo) > threshold then index = lo + 1 end
            elseif not op.dither then
              index = math.max(0, math.min(steps - 1, math.floor(f + 0.5)))
            end
            changed = changed + Draw.pixel(img, ox, oy, x, y, band[index])
          end
        end
      elseif kind == "clear" then
        local r = op.region
        if r then
          for y = r.y, r.y + r.height - 1 do
            for x = r.x, r.x + r.width - 1 do
              changed = changed + Draw.pixel(img, ox, oy, x, y, 0)
            end
          end
        else
          img:clear()
          changed = changed + img.width * img.height
        end
      elseif kind == "blit" then
        local srcFrame = op.fromFrame and find_frame(s, op.fromFrame) or frame
        local srcLayer = op.fromLayer and find_layer(s, op.fromLayer) or layer
        local srcCel = get_cel(s, srcLayer, srcFrame, false)
        if srcCel then
          local r = op.from
          for y = 0, r.height - 1 do
            for x = 0, r.width - 1 do
              local sx = op.flipHorizontal and (r.x + r.width - 1 - x) or (r.x + x)
              local sy = op.flipVertical and (r.y + r.height - 1 - y) or (r.y + y)
              local lx, ly = sx - srcCel.position.x, sy - srcCel.position.y
              if lx >= 0 and ly >= 0 and lx < srcCel.image.width and ly < srcCel.image.height then
                local value = srcCel.image:getPixel(lx, ly)
                local transparent = pixel_to_hex(s, value) == nil
                if not (op.skipTransparent ~= false and transparent) then
                  changed = changed + Draw.pixel(img, ox, oy, op.to.x + x, op.to.y + y, value)
                end
              end
            end
          end
        end
      else
        fault("unsupported_command", "Unknown draw op '" .. tostring(kind) .. "'.")
      end
      extend(op_bounds(s, op))
    end

    cel.image = img
  end)

  return {
    sprite = sprite_display_name(s),
    layer = layer.name,
    frame = frame.frameNumber,
    opsApplied = #ops,
    pixelsChanged = changed,
    colorsSnapped = snapped,
    bounds = union,
  }
end

--------------------------------------------------------------------------------
-- Structure: layers, frames, tags, cels
--------------------------------------------------------------------------------

local BLEND = {
  normal = BlendMode.NORMAL, multiply = BlendMode.MULTIPLY, screen = BlendMode.SCREEN,
  overlay = BlendMode.OVERLAY, darken = BlendMode.DARKEN, lighten = BlendMode.LIGHTEN,
  color_dodge = BlendMode.COLOR_DODGE, color_burn = BlendMode.COLOR_BURN,
  hard_light = BlendMode.HARD_LIGHT, soft_light = BlendMode.SOFT_LIGHT,
  difference = BlendMode.DIFFERENCE, exclusion = BlendMode.EXCLUSION,
  hue = BlendMode.HSL_HUE, saturation = BlendMode.HSL_SATURATION,
  color = BlendMode.HSL_COLOR, luminosity = BlendMode.HSL_LUMINOSITY,
  addition = BlendMode.ADDITION, subtract = BlendMode.SUBTRACT, divide = BlendMode.DIVIDE,
}

local function apply_layer_op(s, op)
  local kind = op.op
  if kind == "create" then
    local layer = op.parent and (function()
      local group = find_layer(s, op.parent)
      if not group.isGroup then fault("invalid_args", "'" .. op.parent .. "' is not a group layer.") end
      local l = s:newLayer(); l.parent = group; return l
    end)() or s:newLayer()
    layer.name = op.name or layer.name
    if op.opacity then layer.opacity = op.opacity end
    if op.blendMode and BLEND[op.blendMode] then layer.blendMode = BLEND[op.blendMode] end
    if op.visible ~= nil then layer.isVisible = op.visible end
    if op.index then layer.stackIndex = op.index end
    return
  end
  if kind == "group" then
    local group = s:newGroupLayer()
    group.name = op.name or "group"
    for _, name in ipairs(op.names or {}) do find_layer(s, name).parent = group end
    return
  end

  local layer = find_layer(s, op.name)
  if kind == "rename" then layer.name = need(op.newName, "newName")
  elseif kind == "delete" then s:deleteLayer(layer)
  elseif kind == "reorder" then layer.stackIndex = need(op.index, "index")
  elseif kind == "activate" then app.layer = layer
  elseif kind == "duplicate" then
    preserving_site(function() app.layer = layer; app.command.DuplicateLayer() end)
  elseif kind == "merge" then
    preserving_site(function() app.layer = layer; app.command.MergeDownLayer() end)
  elseif kind == "ungroup" then
    if not layer.isGroup then fault("invalid_args", "'" .. layer.name .. "' is not a group.") end
    local parent = layer.parent
    for _, child in ipairs({ table.unpack(layer.layers) }) do child.parent = parent end
    s:deleteLayer(layer)
  elseif kind == "set" then
    if op.visible ~= nil then layer.isVisible = op.visible end
    if op.editable ~= nil then layer.isEditable = op.editable end
    if op.opacity ~= nil then layer.opacity = op.opacity end
    if op.blendMode and BLEND[op.blendMode] then layer.blendMode = BLEND[op.blendMode] end
    if op.newName then layer.name = op.newName end
  else
    fault("unsupported_command", "layer op '" .. tostring(kind) .. "' is not supported.")
  end
end

H["layer.apply"] = function(args)
  local s = find_sprite(args.sprite)
  local batch = args.batch

  if args.op == "list" and not batch then
    return {
      sprite = sprite_display_name(s),
      layers = flatten_layers(s.layers, nil, {}),
      activeLayer = app.layer and app.layer.name or nil,
    }
  end

  local ops = batch or { args }
  transact("AI: layers", function()
    for _, op in ipairs(ops) do apply_layer_op(s, op) end
  end)

  return {
    sprite = sprite_display_name(s),
    applied = #ops,
    layers = flatten_layers(s.layers, nil, {}),
    activeLayer = app.layer and app.layer.name or nil,
  }
end

--- The layer LinkCels should act on: the active one when it belongs to this
--- sprite, else the topmost non-group layer.
local function layer_for_link(s)
  if app.layer and app.layer.sprite == s and not app.layer.isGroup then return app.layer end
  for i = #s.layers, 1, -1 do
    if not s.layers[i].isGroup then return s.layers[i] end
  end
  return s.layers[1]
end

local function frame_list(s)
  local frames, total = {}, 0
  for i, f in ipairs(s.frames) do
    local ms = math.floor(f.duration * 1000 + 0.5)
    frames[i] = { number = i, durationMs = ms }
    total = total + ms
  end
  return frames, total
end

H["frame.apply"] = function(args)
  local s = find_sprite(args.sprite)
  local op = need(args.op, "op")

  if op ~= "list" then
    transact("AI: frames", function()
      if op == "add" then
        for _ = 1, (args.count or 1) do s:newEmptyFrame(args.afterFrame and (args.afterFrame + 1) or (#s.frames + 1)) end
      elseif op == "duplicate" then
        local src = find_frame(s, args.frame)
        for _ = 1, (args.count or 1) do
          if args.linkCels then
            -- LinkCels only links cels the command machinery created: a frame
            -- made with Sprite:newFrame() bypasses that and stays unlinked, and
            -- NewFrame's own "celLinked" content flag does not share the image
            -- either. Create through the command, then link the pair.
            preserving_site(function()
              app.sprite = s
              app.layer = layer_for_link(s)
              app.frame = src
              app.command.NewFrame{ content = "current" }
              local created = app.frame
              app.range.frames = { src.frameNumber, created.frameNumber }
              app.command.LinkCels()
            end)
          else
            s:newFrame(src)
          end
        end
      elseif op == "delete" then
        s:deleteFrame(find_frame(s, args.frame))
      elseif op == "set_duration" then
        if args.durations then
          for i, ms in ipairs(args.durations) do
            if s.frames[i] then s.frames[i].duration = ms / 1000 end
          end
        else
          local ms = need(args.durationMs, "durationMs")
          if args.frame then
            find_frame(s, args.frame).duration = ms / 1000
          else
            for _, f in ipairs(s.frames) do f.duration = ms / 1000 end
          end
        end
      elseif op == "activate" then
        app.frame = find_frame(s, args.frame)
      elseif op == "reorder" then
        preserving_site(function()
          app.frame = find_frame(s, args.frame)
          app.command.MoveFrame{ before = need(args.toIndex, "toIndex") }
        end)
      else
        fault("unsupported_command", "frame op '" .. tostring(op) .. "' is not supported.")
      end
    end)
  end

  local frames, total = frame_list(s)
  return {
    sprite = sprite_display_name(s),
    frameCount = #s.frames,
    frames = frames,
    totalDurationMs = total,
    activeFrame = app.frame and app.frame.frameNumber or nil,
  }
end

local ANIDIR = {
  forward = AniDir.FORWARD, reverse = AniDir.REVERSE,
  pingpong = AniDir.PING_PONG, pingpong_reverse = AniDir.PING_PONG_REVERSE,
}

H["tag.apply"] = function(args)
  local s = find_sprite(args.sprite)
  local op = need(args.op, "op")

  if op ~= "list" then
    transact("AI: tags", function()
      if op == "create" then
        local t = s:newTag(need(args.from, "from"), need(args.to, "to"))
        t.name = need(args.name, "name")
        if args.direction then t.aniDir = ANIDIR[args.direction] end
        if args.repeats then t.repeats = args.repeats end
        if args.color then t.color = hex_to_color(args.color) end
      else
        local target = nil
        for _, t in ipairs(s.tags) do if t.name == args.name then target = t end end
        if not target then fault("invalid_args", "No tag named '" .. tostring(args.name) .. "'.") end
        if op == "delete" then
          s:deleteTag(target)
        elseif op == "update" then
          if args.newName then target.name = args.newName end
          if args.from then target.fromFrame = args.from end
          if args.to then target.toFrame = args.to end
          if args.direction then target.aniDir = ANIDIR[args.direction] end
          if args.repeats then target.repeats = args.repeats end
          if args.color then target.color = hex_to_color(args.color) end
        else
          fault("unsupported_command", "tag op '" .. tostring(op) .. "' is not supported.")
        end
      end
    end)
  end

  local tags = {}
  for i, t in ipairs(s.tags) do
    local ms = 0
    for n = t.fromFrame.frameNumber, t.toFrame.frameNumber do
      ms = ms + math.floor(s.frames[n].duration * 1000 + 0.5)
    end
    tags[i] = {
      name = t.name, from = t.fromFrame.frameNumber, to = t.toFrame.frameNumber,
      direction = tostring(t.aniDir),
      frames = t.toFrame.frameNumber - t.fromFrame.frameNumber + 1,
      durationMs = ms,
    }
  end
  return { sprite = sprite_display_name(s), tags = tags }
end

H["cel.apply"] = function(args)
  local s = find_sprite(args.sprite)
  local op = need(args.op, "op")

  if op == "list" then
    local cels = {}
    for _, l in ipairs(flatten_layers(s.layers, nil, {})) do
      local layer = find_layer(s, l.name)
      if not layer.isGroup then
        for _, c in ipairs(layer.cels) do
          cels[#cels + 1] = {
            layer = layer.name, frame = c.frameNumber,
            x = c.bounds.x, y = c.bounds.y,
            width = c.bounds.width, height = c.bounds.height,
            -- A linked cel shares one Image object with the cels it is linked to,
            -- so identity — not existence — is what distinguishes it. The old
            -- expression collapsed to a constant false and always answered
            -- "nothing is linked", even right after cel op 'link'.
            opacity = c.opacity, linked = is_linked_cel(layer, c),
          }
        end
      end
    end
    return { sprite = sprite_display_name(s), cels = cels }
  end

  local layer = find_layer(s, args.layer)
  local frame = find_frame(s, args.frame)
  local applied = 0

  transact("AI: cels", function()
    if op == "create" then
      get_cel(s, layer, frame, true); applied = 1
    elseif op == "clear" then
      local cel = get_cel(s, layer, frame, false)
      if cel then local img = cel.image:clone(); img:clear(); cel.image = img; applied = 1 end
    elseif op == "delete" then
      local cel = get_cel(s, layer, frame, false)
      if cel then s:deleteCel(cel); applied = 1 end
    elseif op == "set" or op == "move" then
      local cel = get_cel(s, layer, frame, false)
      if not cel then fault("invalid_args", "No cel on '" .. layer.name .. "' frame " .. frame.frameNumber .. ".") end
      local x = args.x or (cel.position.x + (args.dx or 0))
      local y = args.y or (cel.position.y + (args.dy or 0))
      cel.position = Point(x, y)
      if args.opacity then cel.opacity = args.opacity end
      applied = 1
    elseif op == "copy" then
      local src = get_cel(s, layer, frame, false)
      if not src then fault("invalid_args", "Nothing to copy from.") end
      local dstLayer = args.toLayer and find_layer(s, args.toLayer) or layer
      local dstFrame = args.toFrame and find_frame(s, args.toFrame) or frame
      s:newCel(dstLayer, dstFrame, src.image:clone(), src.position)
      applied = 1
    elseif op == "link" then
      local frames = args.frames or {}
      preserving_site(function()
        app.layer = layer
        for _, n in ipairs(frames) do
          app.frame = find_frame(s, n)
          app.command.LinkCels()
          applied = applied + 1
        end
      end)
    elseif op == "unlink" then
      preserving_site(function()
        app.layer = layer; app.frame = frame; app.command.UnlinkCel(); applied = 1
      end)
    else
      fault("unsupported_command", "cel op '" .. tostring(op) .. "' is not supported.")
    end
  end)

  return { sprite = sprite_display_name(s), applied = applied }
end

--------------------------------------------------------------------------------
-- Palette
--------------------------------------------------------------------------------

local function palette_hexes(s)
  local pal = s.palettes[1]
  local out = {}
  for i = 0, #pal - 1 do out[i + 1] = color_to_hex(pal:getColor(i), true) end
  return out
end

H["palette.get"] = function(args)
  local s = find_sprite(args.sprite)
  local colors = palette_hexes(s)
  return { sprite = sprite_display_name(s), colors = colors, size = #colors }
end

H["palette.set"] = function(args)
  local s = find_sprite(args.sprite)
  local colors = need(args.colors, "colors")
  local before = args.remapArt and palette_hexes(s) or nil

  transact("AI: palette", function()
    local pal = s.palettes[1]
    if args.replace then
      pal:resize(#colors)
      for i, hex in ipairs(colors) do pal:setColor(i - 1, hex_to_color(hex)) end
    elseif args.append then
      local start = #pal
      pal:resize(start + #colors)
      for i, hex in ipairs(colors) do pal:setColor(start + i - 1, hex_to_color(hex)) end
    else
      local start = args.startIndex or 0
      if start + #colors > #pal then pal:resize(start + #colors) end
      for i, hex in ipairs(colors) do pal:setColor(start + i - 1, hex_to_color(hex)) end
    end
  end)

  -- Replacing a palette on an RGB sprite leaves the art unchanged and therefore
  -- off-palette. Repainting is opt-in because it is destructive.
  if args.remapArt and before and s.colorMode ~= ColorMode.INDEXED then
    transact("AI: remap art to new palette", function()
      for _, layer in ipairs(s.layers) do
        if not layer.isGroup then
          for _, cel in ipairs(layer.cels) do
            local img = cel.image:clone()
            local cache = {}
            for y = 0, img.height - 1 do
              for x = 0, img.width - 1 do
                local value = img:getPixel(x, y)
                local hex = pixel_to_hex(s, value)
                if hex then
                  local mapped = cache[hex]
                  if mapped == nil then
                    local snapped = snap_color_to_palette(s, hex_to_color(hex))
                    mapped = color_to_pixel(s, snapped)
                    cache[hex] = mapped
                  end
                  if mapped ~= value then img:drawPixel(x, y, mapped) end
                end
              end
            end
            cel.image = img
          end
        end
      end
    end)
  end

  local colors_after = palette_hexes(s)
  return { sprite = sprite_display_name(s), colors = colors_after, size = #colors_after }
end

H["palette.load"] = function(args)
  local s = find_sprite(args.sprite)
  local path = need(args.path, "path")
  transact("AI: load palette", function()
    local pal = Palette{ fromFile = path }
    if not pal then fault("aseprite_error", "Could not read a palette from '" .. path .. "'.") end
    s:setPalette(pal)
  end)
  local colors = palette_hexes(s)
  return { sprite = sprite_display_name(s), colors = colors, size = #colors, path = path }
end

H["palette.stats"] = function(args)
  local s = find_sprite(args.sprite)
  local colors = palette_hexes(s)
  local in_palette = {}
  for i, hex in ipairs(colors) do in_palette[hex:sub(1, 7)] = i - 1 end

  local counts = {}
  for _, layer in ipairs(s.layers) do
    if not layer.isGroup then
      for _, cel in ipairs(layer.cels) do
        local img = cel.image
        for y = 0, img.height - 1 do
          for x = 0, img.width - 1 do
            local hex = pixel_to_hex(s, img:getPixel(x, y))
            if hex then
              local key = hex:sub(1, 7)
              counts[key] = (counts[key] or 0) + 1
            end
          end
        end
      end
    end
  end

  local usage = {}
  for i, hex in ipairs(colors) do
    usage[i] = { index = i - 1, hex = hex, pixels = counts[hex:sub(1, 7)] or 0 }
  end

  local off = {}
  for hex, n in pairs(counts) do
    if in_palette[hex] == nil then off[#off + 1] = { hex = hex, pixels = n } end
  end
  table.sort(off, function(a, b) return a.pixels > b.pixels end)

  return { sprite = sprite_display_name(s), colors = colors, usage = usage, offPalette = off }
end

--------------------------------------------------------------------------------
-- Selection and transforms
--------------------------------------------------------------------------------

H["select.apply"] = function(args)
  local s = find_sprite(args.sprite)
  local op = need(args.op, "op")

  if op ~= "get" then
    transact("AI: selection", function()
      local current = s.selection
      local built

      if op == "none" then built = Selection()
      elseif op == "all" then built = Selection(Rectangle(0, 0, s.width, s.height))
      elseif op == "rect" then
        local r = clamp_region(s, need(args.rect, "rect"))
        built = Selection(Rectangle(r.x, r.y, r.width, r.height))
      elseif op == "ellipse" then
        local r = clamp_region(s, need(args.rect, "rect"))
        built = Selection()
        local cx, cy = r.x + (r.width - 1) / 2, r.y + (r.height - 1) / 2
        local rx, ry = (r.width - 1) / 2, (r.height - 1) / 2
        for y = r.y, r.y + r.height - 1 do
          local x0 = nil
          for x = r.x, r.x + r.width - 1 do
            local nx, ny = (x - cx) / math.max(rx, 0.5), (y - cy) / math.max(ry, 0.5)
            local inside = nx * nx + ny * ny <= 1.0
            if inside and x0 == nil then x0 = x end
            if (not inside or x == r.x + r.width - 1) and x0 ~= nil then
              local x1 = inside and x or x - 1
              built:add(Selection(Rectangle(x0, y, x1 - x0 + 1, 1)))
              x0 = nil
            end
          end
        end
      elseif op == "color" then
        local frame = find_frame(s, args.frame)
        local flat = Image(s.width, s.height, s.colorMode)
        flat:drawSprite(s, frame)
        local wanted = color_to_hex(hex_to_color(need(args.color, "color")), false)
        built = Selection()
        for y = 0, s.height - 1 do
          local x0 = nil
          for x = 0, s.width - 1 do
            local hex = pixel_to_hex(s, flat:getPixel(x, y))
            local match = hex ~= nil and hex:sub(1, 7) == wanted
            if match and x0 == nil then x0 = x end
            if (not match or x == s.width - 1) and x0 ~= nil then
              local x1 = match and x or x - 1
              built:add(Selection(Rectangle(x0, y, x1 - x0 + 1, 1)))
              x0 = nil
            end
          end
        end
      elseif op == "invert" then
        built = Selection(Rectangle(0, 0, s.width, s.height))
        built:subtract(current)
      elseif op == "grow" or op == "shrink" then
        local b = current.bounds
        local n = args.amount or 1
        local d = op == "grow" and n or -n
        built = Selection(Rectangle(b.x - d, b.y - d, math.max(1, b.width + 2 * d), math.max(1, b.height + 2 * d)))
      else
        fault("unsupported_command", "select op '" .. tostring(op) .. "' is not supported.")
      end

      local mode = args.mode or "replace"
      if mode == "replace" or op == "none" or op == "all" or op == "invert" then
        s.selection = built
      elseif mode == "add" then current:add(built); s.selection = current
      elseif mode == "subtract" then current:subtract(built); s.selection = current
      elseif mode == "intersect" then current:intersect(built); s.selection = current
      end
    end)
  end

  local sel = s.selection
  local empty = sel == nil or sel.isEmpty
  local count = 0
  if not empty then
    local b = sel.bounds
    for y = b.y, b.y + b.height - 1 do
      for x = b.x, b.x + b.width - 1 do
        if sel:contains(x, y) then count = count + 1 end
      end
    end
  end

  return {
    sprite = sprite_display_name(s),
    empty = empty,
    bounds = (not empty) and { x = sel.bounds.x, y = sel.bounds.y, width = sel.bounds.width, height = sel.bounds.height } or nil,
    pixelCount = count,
  }
end

H["transform.apply"] = function(args)
  local s = find_sprite(args.sprite)
  local op = need(args.op, "op")
  local layer = find_layer(s, args.layer)
  local frame = find_frame(s, args.frame)
  local changed = 0

  transact("AI: " .. op, function()
    if op == "crop_to_content" then
      preserving_site(function() app.sprite = s; app.command.CanvasSize{ ui = false, trimOutside = true } end)
      return
    end

    local cel = get_cel(s, layer, frame, false)
    if not cel then fault("invalid_args", "No cel on '" .. layer.name .. "' frame " .. frame.frameNumber .. ".") end

    if op == "translate" then
      cel.position = Point(cel.position.x + (args.dx or 0), cel.position.y + (args.dy or 0))
      changed = cel.bounds.width * cel.bounds.height
      return
    end

    local img = cel.image
    local img_w, img_h = img.width, img.height
    local out = Image(img.width, img.height, img.colorMode)

    if op == "flip" then
      local horizontal = (args.axis or "horizontal") == "horizontal"
      for y = 0, img.height - 1 do
        for x = 0, img.width - 1 do
          local sx = horizontal and (img.width - 1 - x) or x
          local sy = horizontal and y or (img.height - 1 - y)
          out:drawPixel(x, y, img:getPixel(sx, sy))
        end
      end
      changed = img_w * img_h
      cel.image = out
    elseif op == "rotate" then
      local angle = ((args.angle or 90) % 360 + 360) % 360
      if angle == 180 then
        for y = 0, img.height - 1 do
          for x = 0, img.width - 1 do
            out:drawPixel(x, y, img:getPixel(img.width - 1 - x, img.height - 1 - y))
          end
        end
        cel.image = out
        changed = img_w * img_h
      elseif angle == 90 or angle == 270 then
        local rot = Image(img.height, img.width, img.colorMode)
        for y = 0, img.height - 1 do
          for x = 0, img.width - 1 do
            if angle == 90 then rot:drawPixel(img.height - 1 - y, x, img:getPixel(x, y))
            else rot:drawPixel(y, img.width - 1 - x, img:getPixel(x, y)) end
          end
        end
        cel.image = rot
        changed = img_w * img_h
      elseif angle ~= 0 then
        fault("invalid_args", "Only 90/180/270 rotations are lossless. " ..
          "The server should have blocked this; pass allowLossy there if the user accepted the quality loss.")
      end
      -- angle == 0 falls through with changed still 0: reporting a full-canvas
      -- change for an operation that touched nothing breaks any agent using
      -- pixelsChanged to check whether its call did anything.
    elseif op == "scale" then
      local f = args.factor or 2
      local scaled = Image(img.width * f, img.height * f, img.colorMode)
      for y = 0, scaled.height - 1 do
        for x = 0, scaled.width - 1 do
          scaled:drawPixel(x, y, img:getPixel(math.floor(x / f), math.floor(y / f)))
        end
      end
      cel.image = scaled
      changed = scaled.width * scaled.height
    elseif op == "outline" then
      local value = color_to_pixel(s, hex_to_color(need(args.color, "color")))
      local grown = Image(img.width + 2, img.height + 2, img.colorMode)
      grown:drawImage(img, Point(1, 1))
      local result = grown:clone()
      for y = 0, grown.height - 1 do
        for x = 0, grown.width - 1 do
          if pixel_to_hex(s, grown:getPixel(x, y)) == nil then
            local touching = false
            for _, d in ipairs({ { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }) do
              local nx, ny = x + d[1], y + d[2]
              if nx >= 0 and ny >= 0 and nx < grown.width and ny < grown.height
                 and pixel_to_hex(s, grown:getPixel(nx, ny)) ~= nil then touching = true end
            end
            if touching then result:drawPixel(x, y, value); changed = changed + 1 end
          end
        end
      end
      cel.image = result
      cel.position = Point(cel.position.x - 1, cel.position.y - 1)
    else
      fault("unsupported_command", "transform op '" .. tostring(op) .. "' is not supported.")
    end
  end)

  local cel = get_cel(s, layer, frame, false)
  return {
    sprite = sprite_display_name(s),
    op = op, pixelsChanged = changed,
    bounds = cel and { x = cel.bounds.x, y = cel.bounds.y, width = cel.bounds.width, height = cel.bounds.height } or nil,
  }
end

--------------------------------------------------------------------------------
-- Recolor — shading by intent. Mirrors src/lib/color.ts hueShiftShade.
--------------------------------------------------------------------------------

local function rgb_to_hsl(c)
  local r, g, b = c.red / 255, c.green / 255, c.blue / 255
  local max, min = math.max(r, g, b), math.min(r, g, b)
  local l = (max + min) / 2
  local d = max - min
  if d == 0 then return 0, 0, l end
  local sat = l > 0.5 and d / (2 - max - min) or d / (max + min)
  local h
  if max == r then h = ((g - b) / d + (g < b and 6 or 0)) * 60
  elseif max == g then h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60 end
  return h, sat, l
end

local function hsl_to_rgb(h, s, l, a)
  if s == 0 then
    local v = math.floor(l * 255 + 0.5)
    return Color{ r = v, g = v, b = v, a = a }
  end
  local q = l < 0.5 and l * (1 + s) or l + s - l * s
  local p = 2 * l - q
  local hk = ((h % 360) + 360) % 360 / 360
  local function channel(t)
    if t < 0 then t = t + 1 end
    if t > 1 then t = t - 1 end
    if t < 1 / 6 then return p + (q - p) * 6 * t end
    if t < 1 / 2 then return q end
    if t < 2 / 3 then return p + (q - p) * (2 / 3 - t) * 6 end
    return p
  end
  return Color{
    r = math.floor(channel(hk + 1 / 3) * 255 + 0.5),
    g = math.floor(channel(hk) * 255 + 0.5),
    b = math.floor(channel(hk - 1 / 3) * 255 + 0.5),
    a = a,
  }
end

local function clamp01(v) return math.max(0, math.min(1, v)) end

-- Shadows rotate toward blue and desaturate slightly; highlights rotate toward
-- yellow-orange and saturate. A pure luminance change is the tell of art that
-- was made by moving a brightness slider.
local function shade_color(color, amount)
  local h, s, l = rgb_to_hsl(color)
  local sign = amount > 0 and 1 or -1
  local shift = -sign * 25 * math.abs(amount)
  local new_h = ((h + shift) % 360 + 360) % 360
  local new_l = clamp01(l + amount * 0.5)
  local new_s = clamp01(s + (amount > 0 and 0.06 or -0.04) * math.abs(amount) * 2)
  return hsl_to_rgb(new_h, new_s, new_l, color.alpha)
end

H["recolor.apply"] = function(args)
  local s = find_sprite(args.sprite)
  local layer = find_layer(s, args.layer)
  local frame = find_frame(s, args.frame)
  local op = need(args.op, "op")

  local cel = get_cel(s, layer, frame, false)
  if not cel then fault("invalid_args", "No cel on '" .. layer.name .. "' frame " .. frame.frameNumber .. ".") end

  local selection = args.selectionOnly and s.selection or nil
  if args.selectionOnly and (not selection or selection.isEmpty) then
    fault("invalid_args",
      "selectionOnly was set but nothing is selected. Recolouring the whole cel instead would " ..
      "change far more than you asked for, so this refuses. Select a region first, or pass a " ..
      "`region`, or drop selectionOnly.")
  end
  local region = args.region and clamp_region(s, args.region) or nil

  -- Map over distinct colours, not pixels: a 64x64 recolour becomes a handful
  -- of colour decisions plus one pass, instead of four thousand decisions.
  local mapping, counts, order = {}, {}, {}
  local img = cel.image
  local ox, oy = cel.position.x, cel.position.y

  local function in_scope(gx, gy)
    if region and (gx < region.x or gy < region.y
       or gx >= region.x + region.width or gy >= region.y + region.height) then return false end
    if selection and not selection:contains(gx, gy) then return false end
    return true
  end

  for y = 0, img.height - 1 do
    for x = 0, img.width - 1 do
      if in_scope(x + ox, y + oy) then
        local hex = pixel_to_hex(s, img:getPixel(x, y))
        if hex then
          if counts[hex] == nil then counts[hex] = 0; order[#order + 1] = hex end
          counts[hex] = counts[hex] + 1
        end
      end
    end
  end

  for _, hex in ipairs(order) do
    local color = hex_to_color(hex)
    local result
    if op == "shade" then
      result = shade_color(color, args.amount or -0.2)
    elseif op == "snap" then
      result = snap_color_to_palette(s, color)
    elseif op == "replace" then
      result = (hex:sub(1, 7) == color_to_hex(hex_to_color(need(args.from, "from")), false))
        and hex_to_color(need(args.to, "to")) or color
    elseif op == "hue_shift" then
      local h, sat, l = rgb_to_hsl(color)
      result = hsl_to_rgb(h + (args.degrees or 30), sat, l, color.alpha)
    elseif op == "desaturate" then
      local h, sat, l = rgb_to_hsl(color)
      result = hsl_to_rgb(h, sat * (1 - (args.strength or 1)), l, color.alpha)
    else
      fault("unsupported_command", "recolor op '" .. tostring(op) .. "' is not supported.")
    end

    if args.clampToPalette ~= false and op ~= "snap" and s.colorMode ~= ColorMode.INDEXED then
      result = snap_color_to_palette(s, result)
    end
    mapping[hex] = result
  end

  local changed = 0
  transact("AI: recolor " .. op, function()
    local out = img:clone()
    for y = 0, img.height - 1 do
      for x = 0, img.width - 1 do
        if in_scope(x + ox, y + oy) then
          local hex = pixel_to_hex(s, img:getPixel(x, y))
          if hex and mapping[hex] then
            local value = color_to_pixel(s, mapping[hex])
            if value ~= img:getPixel(x, y) then
              out:drawPixel(x, y, value)
              changed = changed + 1
            end
          end
        end
      end
    end
    cel.image = out
  end)

  local report = {}
  for _, hex in ipairs(order) do
    local to = color_to_hex(mapping[hex], false)
    if to ~= hex:sub(1, 7) then
      report[#report + 1] = { from = hex:sub(1, 7), to = to, pixels = counts[hex] }
    end
  end

  return {
    sprite = sprite_display_name(s),
    op = op, pixelsChanged = changed, mapping = report,
  }
end

--------------------------------------------------------------------------------
-- Reference images
--------------------------------------------------------------------------------

H["reference.apply"] = function(args)
  local s = find_sprite(args.sprite)
  local op = need(args.op, "op")

  if op == "list" then
    local refs = {}
    for _, l in ipairs(s.layers) do
      if l.name:match("^reference") then refs[#refs + 1] = l.name end
    end
    return { sprite = sprite_display_name(s), op = op, references = refs }
  end

  if op == "remove" then
    transact("AI: remove reference", function()
      s:deleteLayer(find_layer(s, args.name or "reference"))
    end)
    return { sprite = sprite_display_name(s), op = op }
  end

  local path = need(args.path, "path")
  local source = app.open(path)
  if not source then fault("aseprite_error", "Could not open '" .. path .. "'.") end

  local flat = Image(source.width, source.height, ColorMode.RGB)
  flat:drawSprite(source, source.frames[1])
  local sw, sh = source.width, source.height
  source:close()

  if op == "sample_palette" then
    local counts, total = {}, 0
    for y = 0, sh - 1 do
      for x = 0, sw - 1 do
        local hex = pixel_to_hex({ colorMode = ColorMode.RGB }, flat:getPixel(x, y))
        if hex then
          local key = hex:sub(1, 7)
          counts[key] = (counts[key] or 0) + 1
          total = total + 1
        end
      end
    end
    local list = {}
    for hex, n in pairs(counts) do list[#list + 1] = { hex = hex, share = n / math.max(total, 1) } end
    table.sort(list, function(a, b) return a.share > b.share end)
    local top = {}
    for i = 1, math.min(#list, args.colors or 16) do
      top[i] = { hex = list[i].hex, share = math.floor(list[i].share * 1000 + 0.5) / 1000 }
    end
    return { sprite = sprite_display_name(s), op = op, palette = top, width = sw, height = sh }
  end

  -- op == "import"
  local name = args.name or "reference"
  local fit = args.fit or "contain"
  local tw, th = sw, sh
  if fit ~= "none" then
    local ratio
    if fit == "contain" then ratio = math.min(s.width / sw, s.height / sh)
    elseif fit == "cover" then ratio = math.max(s.width / sw, s.height / sh)
    else ratio = nil end
    if ratio then tw, th = math.max(1, math.floor(sw * ratio)), math.max(1, math.floor(sh * ratio))
    else tw, th = s.width, s.height end
  end

  local scaled = Image(tw, th, ColorMode.RGB)
  for y = 0, th - 1 do
    for x = 0, tw - 1 do
      scaled:drawPixel(x, y, flat:getPixel(math.floor(x * sw / tw), math.floor(y * sh / th)))
    end
  end

  transact("AI: import reference", function()
    local layer = s:newLayer()
    layer.name = name
    layer.opacity = args.opacity or 128
    layer.isEditable = false   -- a reference the agent can accidentally paint on is a trap
    layer.stackIndex = #s.layers
    s:newCel(layer, find_frame(s, args.frame), scaled, Point(args.x or 0, args.y or 0))
  end)

  return { sprite = sprite_display_name(s), op = op, layer = name, width = tw, height = th }
end

--------------------------------------------------------------------------------
-- Export
--------------------------------------------------------------------------------

H["export.run"] = function(args)
  local s = find_sprite(args.sprite)
  local op = need(args.op, "op")
  local path = need(args.path, "path")
  local files = {}
  local exported_frame = nil

  preserving_site(function()
    app.sprite = s

    if op == "png" then
      local frame = find_frame(s, args.frame)
      exported_frame = frame.frameNumber
      local flat = Image(s.width, s.height, s.colorMode)
      flat:drawSprite(s, frame)
      local out = Sprite(s.width, s.height, s.colorMode)
      if s.colorMode == ColorMode.INDEXED then out:setPalette(s.palettes[1]) end
      out.cels[1].image = flat
      -- (export.run already runs inside preserving_site)
      if (args.scale or 1) > 1 then out:resize(s.width * args.scale, s.height * args.scale) end
      out:saveCopyAs(path)
      out:close()
      files[#files + 1] = path

    elseif op == "gif" or op == "aseprite" then
      s:saveCopyAs(path)
      files[#files + 1] = path

    elseif op == "frames" then
      -- Aseprite expands {frame} itself when the filename carries the token.
      s:saveCopyAs(path)
      files[#files + 1] = path

    elseif op == "spritesheet" then
      local params = {
        ui = false,
        type = SpriteSheetType[string.upper(args.sheetType or "horizontal")] or SpriteSheetType.HORIZONTAL,
        textureFilename = path,
        innerPadding = args.padding or 0,
        trim = args.trim or false,
        splitTags = args.byTag or false,
      }
      if args.includeJson ~= false then
        local json_path = path:gsub("%.%w+$", "") .. ".json"
        params.dataFilename = json_path
        params.dataFormat = SpriteSheetDataFormat.JSON_ARRAY
        params.listTags = true
        params.listLayers = true
        params.listSlices = true
        files[#files + 1] = json_path
      end
      app.command.ExportSpriteSheet(params)
      files[#files + 1] = path

    else
      fault("unsupported_command", "export op '" .. tostring(op) .. "' is not supported.")
    end
  end)

  return {
    sprite = sprite_display_name(s),
    op = op, files = files,
    width = s.width, height = s.height, frameCount = #s.frames,
    frame = exported_frame,
    atlas = (op == "spritesheet" and args.includeJson ~= false) and files[1] or nil,
  }
end

--------------------------------------------------------------------------------
-- Tilesets
--------------------------------------------------------------------------------

--------------------------------------------------------------------------------
-- Tileset helpers
--------------------------------------------------------------------------------

--- Copy one grid cell out of a canvas-sized image.
local function extract_cell(source, x0, y0, w, h, mode)
  local cell = Image(w, h, mode)
  for y = 0, h - 1 do
    for x = 0, w - 1 do
      local sx, sy = x0 + x, y0 + y
      if sx < source.width and sy < source.height then
        cell:drawPixel(x, y, source:getPixel(sx, sy))
      end
    end
  end
  return cell
end

--- Exact identity key for a cell. Used for the tolerance-0 fast path, where a
--- hash lookup turns an O(cells x tiles) scan into O(cells).
local function cell_key(cell)
  local parts = {}
  for y = 0, cell.height - 1 do
    for x = 0, cell.width - 1 do
      parts[#parts + 1] = cell:getPixel(x, y)
    end
  end
  return table.concat(parts, ",")
end

local function cell_is_empty(cell, sprite)
  for y = 0, cell.height - 1 do
    for x = 0, cell.width - 1 do
      if pixel_to_hex(sprite, cell:getPixel(x, y)) ~= nil then return false end
    end
  end
  return true
end

--- Per-channel max difference between two same-sized cells, 0-255.
--- RGB only: in indexed and grayscale modes the raw pixel value is a palette
--- index or a packed gray+alpha pair, and running that through rgbaR/G/B/A
--- extracts meaningless bit-fields — which merged two maximally different
--- tiles into one and called it a successful dedup.
local function cell_distance(a, b)
  local pc = app.pixelColor
  local worst = 0
  for y = 0, a.height - 1 do
    for x = 0, a.width - 1 do
      local pa, pb = a:getPixel(x, y), b:getPixel(x, y)
      if pa ~= pb then
        local d = math.max(
          math.abs(pc.rgbaR(pa) - pc.rgbaR(pb)),
          math.abs(pc.rgbaG(pa) - pc.rgbaG(pb)),
          math.abs(pc.rgbaB(pa) - pc.rgbaB(pb)),
          math.abs(pc.rgbaA(pa) - pc.rgbaA(pb)))
        if d > worst then
          worst = d
          if worst > 255 then return worst end
        end
      end
    end
  end
  return worst
end

--- Pack a tileset's tiles into one image, near-square, row-major.
---
--- `skip_empty` drops Aseprite's reserved index-0 empty tile. Engines index the
--- atlas from 0, so keeping the empty tile in the image shifts every real tile
--- by one and produces a map that renders one tile off everywhere. Dropping it
--- makes Aseprite index N land at atlas position N-1, which is exactly the
--- offset Tiled's `firstgid` of 1 undoes.
local function pack_tiles(tileset, mode, skip_empty)
  local first = skip_empty and 1 or 0
  local count = math.max(0, #tileset - first)
  local tw = tileset.grid.tileSize.width
  local th = tileset.grid.tileSize.height
  local cols = math.max(1, math.ceil(math.sqrt(math.max(count, 1))))
  local rows = math.max(1, math.ceil(count / cols))
  local packed = Image(cols * tw, rows * th, mode)
  for slot = 0, count - 1 do
    local tile = tileset:tile(slot + first)
    if tile and tile.image then
      packed:drawImage(tile.image, Point((slot % cols) * tw, math.floor(slot / cols) * th))
    end
  end
  return packed, cols, rows, tw, th, count
end

--- Write an image to disk as a PNG via a scratch sprite, optionally upscaled.
local function write_image(image, mode, palette, path, scale)
  preserving_site(function()
    local out = Sprite(image.width, image.height, mode)
    if mode == ColorMode.INDEXED and palette then out:setPalette(palette) end
    out.cels[1].image = image
    if scale and scale > 1 then out:resize(image.width * scale, image.height * scale) end
    out:saveCopyAs(path)
    out:close()
  end)
end

--------------------------------------------------------------------------------
-- blob47
--
-- The 47-tile "blob" set enumerates every distinct 8-neighbour configuration
-- once the meaningless ones are removed: a diagonal neighbour only affects the
-- shape when both edges beside it are also filled, so masks that differ only in
-- an orphaned corner bit describe the same tile. Reducing all 256 masks by that
-- rule leaves exactly 47 canonical values, and sorting them ascending is the
-- ordering nearly every blob47 tileset on the internet is authored in.
--
-- This is computed rather than hardcoded so it is checkable: if the reduction
-- does not yield 47 values, the export refuses instead of writing a wangset
-- that would autotile wrongly.
--------------------------------------------------------------------------------

-- Bit layout, matching the wangid order Tiled uses.
local N, NE, E, SE, S, SW, W, NW = 1, 2, 4, 8, 16, 32, 64, 128

local function reduce_blob_mask(mask)
  local out = mask
  -- A corner survives only when both of its adjacent edges are present.
  if (out & NE) ~= 0 and not ((out & N) ~= 0 and (out & E) ~= 0) then out = out & ~NE end
  if (out & SE) ~= 0 and not ((out & S) ~= 0 and (out & E) ~= 0) then out = out & ~SE end
  if (out & SW) ~= 0 and not ((out & S) ~= 0 and (out & W) ~= 0) then out = out & ~SW end
  if (out & NW) ~= 0 and not ((out & N) ~= 0 and (out & W) ~= 0) then out = out & ~NW end
  return out
end

local function blob47_masks()
  local seen, list = {}, {}
  for mask = 0, 255 do
    local reduced = reduce_blob_mask(mask)
    if not seen[reduced] then
      seen[reduced] = true
      list[#list + 1] = reduced
    end
  end
  table.sort(list)
  return list
end

H["tileset.apply"] = function(args)
  local s = find_sprite(args.sprite)
  local op = need(args.op, "op")

  if op == "list" then
    local out = {}
    for i, ts in ipairs(s.tilesets or {}) do
      out[i] = {
        name = ts.name ~= "" and ts.name or ("tileset " .. i),
        tileCount = #ts,
        tileWidth = ts.grid.tileSize.width,
        tileHeight = ts.grid.tileSize.height,
      }
    end
    return { sprite = sprite_display_name(s), op = op, tilesets = out }
  end

  if op == "create_layer" then
    local name = args.name or "tilemap"
    local tw = args.tileWidth or 16
    local th = args.tileHeight or 16
    transact("AI: new tilemap layer", function()
      preserving_site(function()
        app.sprite = s
        app.command.NewLayer{ tilemap = true, gridBounds = Rectangle(0, 0, tw, th) }
        if app.layer then app.layer.name = name end
      end)
    end)
    return {
      sprite = sprite_display_name(s), op = op, layer = name,
      tileWidth = tw, tileHeight = th,
    }
  end

  ------------------------------------------------------------------------------
  -- pack: a hand-painted mockup becomes a tileset plus a tilemap that rebuilds it
  ------------------------------------------------------------------------------
  if op == "pack" then
    local source = find_layer(s, args.layer)
    if source.isTilemap then
      fault("invalid_args", "'" .. source.name .. "' is already a tilemap. Pack a normal painted layer.")
    end
    local frame = find_frame(s, args.frame)
    local tw = args.tileWidth or 16
    local th = args.tileHeight or 16
    local tolerance = args.tolerance or 0
    if tolerance > 0 and s.colorMode ~= ColorMode.RGB then
      fault("invalid_args",
        "tolerance > 0 needs an RGB sprite — perceptual distance is not defined over palette " ..
        "indices or packed gray values, and comparing them merges unrelated tiles. " ..
        "Convert to RGB, or pack with tolerance 0 (exact matches only).")
    end

    if s.width % tw ~= 0 or s.height % th ~= 0 then
      fault("invalid_args", string.format(
        "Canvas is %dx%d, which is not a whole number of %dx%d tiles. " ..
        "Resize the canvas to a multiple of the tile size before packing — a partial " ..
        "edge tile would silently lose pixels.", s.width, s.height, tw, th))
    end

    -- Render just this layer, so packing a mockup is not polluted by a sketch
    -- or reference layer sitting above it.
    local canvas = Image(s.width, s.height, s.colorMode)
    local src_cel = get_cel(s, source, frame, false)
    if not src_cel then
      fault("invalid_args", "'" .. source.name .. "' has no cel on frame " .. frame.frameNumber .. ".")
    end
    canvas:drawImage(src_cel.image, src_cel.position)

    local cols = s.width // tw
    local rows = s.height // th

    -- Index 0 in an Aseprite tileset is the reserved empty tile, so a fully
    -- transparent cell maps to 0 and costs nothing.
    local cells = {}
    local unique = {}      -- ordered list of {image=, key=}
    local by_key = {}
    local exact_reuse, fuzzy_reuse = 0, 0

    for row = 0, rows - 1 do
      for col = 0, cols - 1 do
        local cell = extract_cell(canvas, col * tw, row * th, tw, th, s.colorMode)
        local index
        if cell_is_empty(cell, s) then
          index = 0
        else
          local key = cell_key(cell)
          local hit = by_key[key]
          if hit then
            index = hit
            exact_reuse = exact_reuse + 1
          elseif tolerance > 0 and s.colorMode == ColorMode.RGB then
            -- Only the slow path scans: exact matches are already resolved.
            for i, existing in ipairs(unique) do
              if cell_distance(cell, existing.image) <= tolerance then
                index = i
                fuzzy_reuse = fuzzy_reuse + 1
                break
              end
            end
          end
          if not index then
            unique[#unique + 1] = { image = cell, key = key }
            index = #unique
            by_key[key] = index
          end
        end
        cells[row * cols + col] = index
      end
    end

    local layer_name = args.name or (source.name .. "-tilemap")

    transact("AI: pack tileset", function()
      preserving_site(function()
        app.sprite = s
        app.command.NewLayer{ tilemap = true, gridBounds = Rectangle(0, 0, tw, th) }
        local tilemap = app.layer
        tilemap.name = layer_name

        local ts = tilemap.tileset
        for _, entry in ipairs(unique) do
          local tile = s:newTile(ts)
          tile.image = entry.image
        end

        local spec = ImageSpec{ width = cols, height = rows, colorMode = ColorMode.TILEMAP }
        local map = Image(spec)
        for row = 0, rows - 1 do
          for col = 0, cols - 1 do
            map:drawPixel(col, row, app.pixelColor.tile(cells[row * cols + col], 0))
          end
        end
        s:newCel(tilemap, frame, map, Point(0, 0))

        -- Keep the mockup, hidden: a wrong tile size is only obvious once you
        -- compare, and deleting the original makes that impossible.
        source.isVisible = false
      end)
    end)

    return {
      sprite = sprite_display_name(s),
      op = op,
      layer = layer_name,
      sourceLayer = source.name,
      tileWidth = tw, tileHeight = th,
      columns = cols, rows = rows,
      cellCount = cols * rows,
      tileCount = #unique,
      reusedExact = exact_reuse,
      reusedFuzzy = fuzzy_reuse,
    }
  end

  ------------------------------------------------------------------------------
  -- everything below needs an existing tilemap layer
  ------------------------------------------------------------------------------
  local layer = find_layer(s, args.layer)
  if not layer.isTilemap then
    fault("invalid_args", "'" .. layer.name .. "' is not a tilemap layer. Create one with op 'create_layer', or build one from a mockup with op 'pack'.")
  end
  local frame = find_frame(s, args.frame)
  local tileset = layer.tileset
  if not tileset then fault("invalid_args", "Layer '" .. layer.name .. "' has no tileset.") end

  if op == "stamp" then
    local tiles = need(args.tiles, "tiles")
    local tw = tileset.grid.tileSize.width
    local th = tileset.grid.tileSize.height
    local cols = math.max(1, s.width // tw)
    local rows = math.max(1, s.height // th)
    local placed, skipped = 0, 0

    transact("AI: stamp tiles", function()
      local cel = layer:cel(frame)
      local map
      if cel then
        map = cel.image:clone()
      else
        -- A tilemap cel must be created with a TILEMAP-mode image; the generic
        -- cel helper would hand back an RGB one and every stamp would be lost.
        map = Image(ImageSpec{ width = cols, height = rows, colorMode = ColorMode.TILEMAP })
      end

      for _, t in ipairs(tiles) do
        if t.x >= 0 and t.y >= 0 and t.x < map.width and t.y < map.height
           and t.tile >= 0 and t.tile < #tileset then
          map:drawPixel(t.x, t.y, app.pixelColor.tile(t.tile, 0))
          placed = placed + 1
        else
          skipped = skipped + 1
        end
      end

      if cel then cel.image = map else s:newCel(layer, frame, map, Point(0, 0)) end
    end)

    if skipped > 0 and placed == 0 then
      fault("invalid_args", string.format(
        "None of the %d tiles could be placed. The grid is %dx%d cells and the tileset has %d tiles (valid indices 0..%d).",
        #tiles, cols, rows, #tileset, #tileset - 1))
    end

    return {
      sprite = sprite_display_name(s), op = op,
      layer = layer.name, tileCount = placed, skipped = skipped,
      columns = cols, rows = rows,
    }
  end

  if op == "get" then
    local packed, cols, rows, tw, th = pack_tiles(tileset, s.colorMode, false)
    local files = {}
    if args.path then
      write_image(packed, s.colorMode, s.palettes[1], args.path, pick_scale(packed.width, packed.height, nil))
      files[#files + 1] = args.path
    end
    return {
      sprite = sprite_display_name(s), op = op,
      layer = layer.name, tileCount = #tileset,
      tileWidth = tw, tileHeight = th,
      columns = cols, rows = rows, files = files,
    }
  end

  ------------------------------------------------------------------------------
  -- export: packed PNG plus the file the target engine reads
  ------------------------------------------------------------------------------
  if op == "export" then
    local path = need(args.path, "path")
    local format = args.format or "tiled"
    local layout = args.layout or "grid"

    local packed, cols, rows, tw, th, count = pack_tiles(tileset, s.colorMode, true)
    if count == 0 then
      fault("invalid_args", "Tileset '" .. layer.name .. "' has no tiles beyond the empty one; there is nothing to export.")
    end
    local base = path:gsub("%.[%w]+$", "")
    local png_path = base .. ".png"
    write_image(packed, s.colorMode, s.palettes[1], png_path, 1)

    local name = app.fs.fileTitle(path)
    local png_name = app.fs.fileName(png_path)
    local files = { png_path }

    local wangset = nil
    if layout == "blob47" then
      local masks = blob47_masks()
      if #masks ~= 47 then
        fault("aseprite_error", "blob47 reduction produced " .. #masks .. " masks, not 47; refusing to write a wangset that would autotile wrongly.")
      end
      -- Tile 0 is Aseprite's reserved empty tile, so the 47 blob tiles are
      -- expected at indices 1..47.
      if #tileset < 48 then
        fault("invalid_args", string.format(
          "layout 'blob47' needs 47 tiles after the empty tile (48 total); this tileset has %d. " ..
          "Either author the full blob47 set in canonical order, or export with layout 'grid'.", #tileset))
      end
      local wangtiles = {}
      for i, mask in ipairs(masks) do
        -- Two explicit colours rather than 0-as-wildcard: a half-specified
        -- wangid makes Tiled pick tiles that only sometimes fit.
        local function bit(b) return (mask & b) ~= 0 and 1 or 2 end
        wangtiles[i] = {
          -- Tiled wangtile ids are atlas slots. Aseprite blob tiles live at
          -- indices 1..47 and the empty tile is dropped from the atlas, so
          -- slot = index - 1 = i - 1.
          tileid = i - 1,
          wangid = { bit(N), bit(NE), bit(E), bit(SE), bit(S), bit(SW), bit(W), bit(NW) },
        }
      end
      wangset = {
        name = "blob47",
        type = "mixed",
        tile = -1,
        colors = {
          { color = "#ff0000", name = "terrain", probability = 1, tile = -1 },
          { color = "#00ff00", name = "empty",   probability = 1, tile = -1 },
        },
        wangtiles = wangtiles,
      }
    end

    local function write_text(target, text)
      local handle = io.open(target, "w")
      if not handle then fault("aseprite_error", "Could not write '" .. target .. "'.") end
      handle:write(text)
      handle:close()
      files[#files + 1] = target
    end

    if format == "tiled" then
      local doc = {
        columns = cols,
        image = png_name,
        imagewidth = packed.width,
        imageheight = packed.height,
        margin = 0,
        spacing = 0,
        name = name,
        tilecount = count,
        tilewidth = tw,
        tileheight = th,
        type = "tileset",
        version = "1.10",
        tiledversion = "1.11.0",
      }
      if wangset then doc.wangsets = { wangset } end
      write_text(base .. ".tsj", encode_json(doc))

      -- The tileset alone is not loadable as a level; emit the map that uses it
      -- so the export actually round-trips into Tiled.
      local cel = layer:cel(frame)
      if cel then
        local data = {}
        local map = cel.image
        for y = 0, map.height - 1 do
          for x = 0, map.width - 1 do
            -- gid = firstgid + atlas slot = 1 + (asepriteIndex - 1) = the
            -- Aseprite index itself, and index 0 stays 0, which Tiled reads as
            -- an empty cell.
            data[#data + 1] = app.pixelColor.tileI(map:getPixel(x, y))
          end
        end
        write_text(base .. ".tmj", encode_json({
          type = "map",
          version = "1.10",
          tiledversion = "1.11.0",
          orientation = "orthogonal",
          renderorder = "right-down",
          infinite = false,
          width = map.width,
          height = map.height,
          tilewidth = tw,
          tileheight = th,
          nextlayerid = 2,
          nextobjectid = 1,
          tilesets = { { firstgid = 1, source = app.fs.fileName(base .. ".tsj") } },
          layers = { {
            id = 1, name = layer.name, type = "tilelayer", visible = true, opacity = 1,
            x = 0, y = 0, width = map.width, height = map.height, data = data,
          } },
        }))
      end

    elseif format == "godot" then
      -- Godot 4 TileSet with a single atlas source.
      local out = {
        '[gd_resource type="TileSet" load_steps=3 format=3]',
        '',
        string.format('[ext_resource type="Texture2D" path="res://%s" id="1_atlas"]', png_name),
        '',
        '[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_1"]',
        'texture = ExtResource("1_atlas")',
        string.format('texture_region_size = Vector2i(%d, %d)', tw, th),
      }
      for slot = 0, count - 1 do
        out[#out + 1] = string.format('%d:%d/0 = 0', slot % cols, slot // cols)
      end
      out[#out + 1] = ''
      out[#out + 1] = '[resource]'
      out[#out + 1] = string.format('tile_size = Vector2i(%d, %d)', tw, th)
      out[#out + 1] = 'sources/0 = SubResource("TileSetAtlasSource_1")'
      out[#out + 1] = ''
      write_text(base .. ".tres", table.concat(out, "\n"))

    elseif format == "json" then
      local doc = {
        name = name,
        image = png_name,
        imageWidth = packed.width,
        imageHeight = packed.height,
        tileWidth = tw,
        tileHeight = th,
        columns = cols,
        rows = rows,
        tileCount = count,
        indexing = "map.tiles holds Aseprite tile indices: 0 means empty, and index N is atlas slot N-1 in the packed image (row-major, `columns` per row).",
      }
      if wangset then
        local masks = blob47_masks()
        local mapping = {}
        for i, mask in ipairs(masks) do mapping[i] = { tile = i, mask = mask } end
        doc.blob47 = mapping
      end
      local cel = layer:cel(frame)
      if cel then
        local map = cel.image
        local grid = {}
        for y = 0, map.height - 1 do
          for x = 0, map.width - 1 do
            grid[#grid + 1] = app.pixelColor.tileI(map:getPixel(x, y))
          end
        end
        doc.map = { width = map.width, height = map.height, tiles = grid }
      end
      write_text(base .. ".json", encode_json(doc))

    else
      fault("invalid_args", "Unknown export format '" .. tostring(format) ..
        "'. Use 'tiled', 'godot' or 'json'.")
    end

    return {
      sprite = sprite_display_name(s), op = op,
      layer = layer.name, format = format, layout = layout,
      tileCount = count, tileWidth = tw, tileHeight = th,
      columns = cols, rows = rows, files = files,
    }
  end

  fault("unsupported_command", "tileset op '" .. tostring(op) .. "' is not supported.")
end

--------------------------------------------------------------------------------
-- Validation — a lint pass with located findings.
--------------------------------------------------------------------------------

local function add_finding(list, check, severity, message, extra)
  local f = { check = check, severity = severity, message = message,
    layer = nil, frame = nil, at = nil, count = nil }
  for k, v in pairs(extra or {}) do f[k] = v end
  list[#list + 1] = f
end

H["validate.run"] = function(args)
  local s = find_sprite(args.sprite)
  local wanted = {}
  for _, c in ipairs(args.checks or
    { "palette", "strays", "outline", "banding", "layers", "animation", "export_readiness" }) do
    wanted[c] = true
  end

  local findings = {}

  if wanted.palette then
    local stats = H["palette.stats"]({ sprite = args.sprite })
    if #stats.offPalette > 0 then
      local worst = stats.offPalette[1]
      add_finding(findings, "palette", "warning",
        #stats.offPalette .. " colour(s) in the art are not in the palette; the most used is " ..
        worst.hex .. " (" .. worst.pixels .. "px). Run recolor op 'snap' to bring them in line.",
        { count = #stats.offPalette })
    end
    if #stats.colors > 64 then
      add_finding(findings, "palette", "note",
        #stats.colors .. " palette entries. Most sprites read better under 32 — a large palette usually means ramps that were never merged.",
        { count = #stats.colors })
    end
  end

  for _, layer in ipairs(s.layers) do
    if not layer.isGroup then
      if wanted.layers and #layer.cels == 0 then
        add_finding(findings, "layers", "note",
          "Layer '" .. layer.name .. "' has no cels on any frame.", { layer = layer.name })
      end

      for _, cel in ipairs(layer.cels) do
        local img = cel.image

        if wanted.strays then
          -- A lone opaque pixel with no opaque neighbour is nearly always a
          -- misplaced click or an off-by-one in generated coordinates.
          local strays = 0
          local first = nil
          for y = 0, img.height - 1 do
            for x = 0, img.width - 1 do
              if pixel_to_hex(s, img:getPixel(x, y)) then
                local neighbours = 0
                for _, d in ipairs({ { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }) do
                  local nx, ny = x + d[1], y + d[2]
                  if nx >= 0 and ny >= 0 and nx < img.width and ny < img.height
                     and pixel_to_hex(s, img:getPixel(nx, ny)) then neighbours = neighbours + 1 end
                end
                if neighbours == 0 then
                  strays = strays + 1
                  if not first then first = { x = x + cel.position.x, y = y + cel.position.y } end
                end
              end
            end
          end
          if strays > 0 then
            add_finding(findings, "strays", strays > 3 and "error" or "warning",
              strays .. " isolated pixel(s) with no neighbour on '" .. layer.name ..
              "' frame " .. cel.frameNumber .. ". These read as noise at 1x.",
              { layer = layer.name, frame = cel.frameNumber, at = first, count = strays })
          end
        end

        if wanted.antialiasing and s.colorMode ~= ColorMode.INDEXED then
          local semi = 0
          for y = 0, img.height - 1 do
            for x = 0, img.width - 1 do
              local a = app.pixelColor.rgbaA(img:getPixel(x, y))
              if a > 0 and a < 255 then semi = semi + 1 end
            end
          end
          if semi > 0 then
            add_finding(findings, "antialiasing", "warning",
              semi .. " semi-transparent pixel(s) on '" .. layer.name ..
              "'. Partial alpha usually comes from a soft brush or a resize and reads as blur.",
              { layer = layer.name, frame = cel.frameNumber, count = semi })
          end
        end
      end
    end
  end

  if wanted.outline or wanted.banding then
    for _, layer in ipairs(s.layers) do
      if not layer.isGroup and layer.isVisible then
        for _, cel in ipairs(layer.cels) do
          local img = cel.image

          if wanted.outline then
            -- Silhouette edge = an opaque pixel touching transparency. If one
            -- colour owns most of that edge the sprite is outlined, and the
            -- stragglers are gaps in it; if none does, the sprite simply is not
            -- outlined, which is a legitimate style and only worth a note.
            local edge, counts, total = {}, {}, 0
            for y = 0, img.height - 1 do
              for x = 0, img.width - 1 do
                local hex = pixel_to_hex(s, img:getPixel(x, y))
                if hex then
                  local exposed = false
                  for _, d in ipairs({ { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }) do
                    local nx, ny = x + d[1], y + d[2]
                    if nx < 0 or ny < 0 or nx >= img.width or ny >= img.height
                       or pixel_to_hex(s, img:getPixel(nx, ny)) == nil then exposed = true end
                  end
                  if exposed then
                    total = total + 1
                    counts[hex] = (counts[hex] or 0) + 1
                    edge[#edge + 1] = { x = x + cel.position.x, y = y + cel.position.y, hex = hex }
                  end
                end
              end
            end

            if total > 0 then
              local best, best_n = nil, 0
              for hex, n in pairs(counts) do
                if n > best_n then best, best_n = hex, n end
              end
              local share = best_n / total
              if share >= 0.6 and share < 1.0 then
                local first = nil
                for _, e in ipairs(edge) do
                  if e.hex ~= best and not first then first = { x = e.x, y = e.y } end
                end
                add_finding(findings, "outline", "warning",
                  string.format(
                    "Outline is %d%% '%s' but %d edge pixel(s) use a different colour on '%s'. " ..
                    "A broken outline reads as a hole in the silhouette.",
                    math.floor(share * 100 + 0.5), best, total - best_n, layer.name),
                  { layer = layer.name, frame = cel.frameNumber, at = first, count = total - best_n })
              elseif share < 0.6 then
                add_finding(findings, "outline", "note",
                  "No single colour owns the silhouette edge on '" .. layer.name ..
                  "', so this sprite is not outlined. That is a valid style — just keep it consistent.",
                  { layer = layer.name, frame = cel.frameNumber })
              end
            end
          end

          if wanted.banding then
            -- Banding is a long straight boundary between two colours: the eye
            -- reads it as a contour line instead of a curved surface.
            local threshold = math.max(8, math.floor(img.width / 3))
            local worst, worst_at, worst_pair = 0, nil, nil
            for y = 0, img.height - 2 do
              local run, above, below, run_x = 0, nil, nil, 0
              for x = 0, img.width - 1 do
                local a = pixel_to_hex(s, img:getPixel(x, y))
                local b = pixel_to_hex(s, img:getPixel(x, y + 1))
                if a and b and a ~= b and a == above and b == below then
                  run = run + 1
                else
                  above, below, run, run_x = a, b, (a and b and a ~= b) and 1 or 0, x
                end
                if run > worst then
                  worst = run
                  worst_at = { x = run_x + cel.position.x, y = y + cel.position.y }
                  worst_pair = { above, below }
                end
              end
            end
            if worst >= threshold and worst_pair then
              add_finding(findings, "banding", "note",
                string.format(
                  "A %d-pixel straight boundary between %s and %s on '%s'. " ..
                  "Let the edge wander, or dither part of it, so it reads as a surface rather than a contour line.",
                  worst, tostring(worst_pair[1]), tostring(worst_pair[2]), layer.name),
                { layer = layer.name, frame = cel.frameNumber, at = worst_at, count = worst })
            end
          end
        end
      end
    end
  end

  if wanted.animation and #s.frames > 1 then
    if #s.tags == 0 then
      add_finding(findings, "animation", "error",
        #s.frames .. " frames and no animation tags. An engine cannot address untagged frames — add a tag per cycle.",
        { count = #s.frames })
    end
    local durations = {}
    for _, f in ipairs(s.frames) do durations[math.floor(f.duration * 1000 + 0.5)] = true end
    local distinct = 0
    for _ in pairs(durations) do distinct = distinct + 1 end
    if distinct == 1 and #s.frames > 3 then
      add_finding(findings, "animation", "note",
        "Every frame has the same duration. Uniform timing reads mechanical; hold contact poses longer than pass poses.")
    end
  end

  if wanted.export_readiness then
    if (s.filename or "") == "" then
      add_finding(findings, "export_readiness", "warning",
        "Sprite has never been saved, so there is nothing on disk to hand to a game project.")
    end
  end

  return { sprite = sprite_display_name(s), findings = findings }
end

--------------------------------------------------------------------------------
-- Escape hatch. Gated on the server side; reaching here means the operator
-- turned it on deliberately.
--------------------------------------------------------------------------------

H["lua.run"] = function(args)
  local source = need(args.script, "script")
  local started = os.clock()
  local captured = {}

  local chunk, compile_err = load("local sprite = ...\n" .. source, "ai-artist:lua.run", "t")
  if not chunk then fault("invalid_args", "Lua compile error: " .. tostring(compile_err)) end

  local sprite = nil
  pcall(function() sprite = find_sprite(args.sprite) end)

  local real_print = print
  print = function(...)
    local parts = {}
    for i = 1, select("#", ...) do parts[#parts + 1] = tostring(select(i, ...)) end
    captured[#captured + 1] = table.concat(parts, "\t")
  end

  local ok, result
  local function body() ok, result = pcall(chunk, sprite) end

  -- transact() can throw, and an un-restored `print` stays hijacked for the
  -- rest of the Aseprite session — silently swallowing the output of every
  -- other script the user runs. Restore it whatever happens.
  local ran, ran_err = pcall(function()
    if args.label then transact("AI: " .. args.label, body) else body() end
  end)
  print = real_print
  if not ran then fault("aseprite_error", tostring(ran_err)) end

  if not ok then fault("aseprite_error", tostring(result)) end
  return {
    ok = true,
    result = result,
    stdout = table.concat(captured, "\n"),
    durationMs = math.floor((os.clock() - started) * 1000),
  }
end


--------------------------------------------------------------------------------
-- Dispatch and transport
--------------------------------------------------------------------------------

-- Aseprite's json.decode returns *userdata* with a metatable, not a plain Lua
-- table: `type(decoded) == "userdata"`. Handlers index it fine, but any code
-- that checks types, takes a length, or stores it alongside real tables breaks
-- in ways that look like the command was never received. Normalising once, at
-- the boundary, keeps every handler working in plain Lua.
local function to_plain(value)
  local kind = type(value)
  if kind ~= "table" and kind ~= "userdata" then return value end

  local out = {}

  -- The two shapes behave oppositely, and getting either wrong fails silently:
  --   array  → `#` is the element count, `[1]` is set, pairs yields NOTHING
  --   object → `#` is the *key* count too, `[1]` is nil, pairs yields the keys
  -- So length alone cannot tell them apart — an object would be read as an
  -- array of nils. `[1]` is the discriminator. Read an array with pairs and a
  -- batch of 40 draw ops arrives as zero ops, and the tool reports success
  -- having drawn nothing at all.
  local length = 0
  pcall(function() length = #value end)
  if length > 0 and value[1] ~= nil then
    for i = 1, length do out[i] = to_plain(value[i]) end
    return out
  end

  local ok = pcall(function()
    for k, v in pairs(value) do out[k] = to_plain(v) end
  end)
  if not ok then return value end
  return out
end

local function handle_command(frame)
  local handler = H[frame.cmd]
  if not handler then
    return {
      id = frame.id, ok = false,
      error = {
        code = "unsupported_command",
        message = "This Aseprite extension does not implement '" .. tostring(frame.cmd) ..
          "'. Update it with `npx @with-pebbly/aseprite-ai-artist install-extension` and restart Aseprite.",
        details = { command = frame.cmd, extensionVersion = EXTENSION_VERSION },
      },
    }
  end

  local ok, result = pcall(handler, frame.args or {})
  if ok then return { id = frame.id, ok = true, data = result } end

  if type(result) == "table" and result.__fault then
    return { id = frame.id, ok = false,
      error = { code = result.code, message = result.message, details = result.details } }
  end

  return { id = frame.id, ok = false,
    error = { code = "aseprite_error", message = tostring(result), details = {} } }
end

local function send(payload)
  if not ws or not connected then return false end
  local ok, err = pcall(function() ws:sendText(encode_json(payload)) end)
  if not ok then
    log("send failed: " .. tostring(err))
    connected = false
  end
  return ok
end

local function send_hello()
  send({
    type = "hello",
    protocol = PROTOCOL_VERSION,
    extensionVersion = EXTENSION_VERSION,
    asepriteVersion = tostring(app.version),
    features = FEATURES,
  })
end

local handle_socket_event

--- Events arrive on a closure bound at connect() time, so a socket that has
--- already been replaced can still deliver one. `generation` is the identity
--- check: an event from an older generation is stale and must not touch state.
local function on_message_for(generation)
  return function(messageType, data)
    if generation ~= ws_generation then
      log("ignoring event from superseded socket (gen " .. tostring(generation) .. ")")
      return
    end
    return handle_socket_event(messageType, data)
  end
end

handle_socket_event = function(messageType, data)
  if messageType == WebSocketMessageType.OPEN then
    connected = true
    connecting = false
    connecting_ticks = 0
    log("connected")
    if status_writer then status_writer("connected") end
    send_hello()
    return
  end

  if messageType == WebSocketMessageType.CLOSE then
    connected = false
    connecting = false
    log("closed")
    if status_writer then status_writer("disconnected") end
    return
  end

  if messageType ~= WebSocketMessageType.TEXT then return end

  local ok, decoded = pcall(function() return json.decode(data) end)
  if not ok then
    log("dropped unparseable frame")
    return
  end
  local frame = to_plain(decoded)
  if type(frame) ~= "table" or frame.id == nil then
    log("dropped frame with no id")
    return
  end

  -- A handler that throws outside pcall would kill the whole extension and take
  -- the user's link with it, so the reply itself is also guarded.
  local replied, reply = pcall(handle_command, frame)
  if not replied then
    reply = { id = frame.id, ok = false,
      error = { code = "aseprite_error", message = tostring(reply), details = {} } }
  end
  send(reply)
end

local function connect()
  if connected or connecting then return end
  connecting = true
  connecting_ticks = 0
  ws_generation = ws_generation + 1
  local generation = ws_generation

  local ok, err = pcall(function()
    ws = WebSocket{
      url = "ws://" .. CONFIG.host .. ":" .. CONFIG.port,
      onreceive = on_message_for(generation),
      deflate = false,
    }
    ws:connect()
  end)

  if not ok then
    connecting = false
    ws = nil
    log("connect failed: " .. tostring(err))
  end
end

-- Aseprite drives Lua from the UI thread, so reconnect bookkeeping rides a
-- Timer. A running connection keeps working while the window is unfocused;
-- re-establishing a dropped one may wait for the next focus.
local function start_timer()
  reconnect_timer = Timer{
    interval = CONFIG.reconnect_tick,
    ontick = function()
      if connected then return end
      if connecting then
        connecting_ticks = connecting_ticks + 1
        if connecting_ticks >= CONFIG.connect_max_ticks then
          -- A handshake that never resolves leaves `connecting` stuck true and
          -- blocks every later attempt; force a reset instead.
          connecting = false
          if ws then pcall(function() ws:close() end) end
          ws = nil
        end
        return
      end
      connect()
    end,
  }
  reconnect_timer:start()
end

--------------------------------------------------------------------------------
-- Load marker
--
-- "Nothing happens" has two very different causes: Aseprite never ran this
-- script (extension not installed or not enabled), or it ran and could not
-- reach the bridge. From outside Aseprite those look identical, and users end
-- up reinstalling things that were already fine. Writing a marker on load lets
-- `doctor` tell them apart and name the actual fix.
--------------------------------------------------------------------------------

local function write_status(state)
  local ok = pcall(function()
    local path = app.fs.joinPath(app.fs.userConfigPath, "aseprite-ai-artist.status")
    local handle = io.open(path, "w")
    if not handle then return end
    handle:write(encode_json({
      state = state,
      version = EXTENSION_VERSION,
      protocol = PROTOCOL_VERSION,
      aseprite = tostring(app.version),
      port = CONFIG.port,
      at = os.time(),
    }))
    handle:close()
  end)
  return ok
end

status_writer = write_status

-- Batch mode (`aseprite -b`) has no UI loop, so a Timer never ticks and a socket
-- would never resolve. Skipping the transport there is also what makes the
-- command table testable headlessly: see tests/extension.test.lua.
if app.isUIAvailable then
  write_status("loaded")
  connect()
  start_timer()
  log("aseprite-ai-artist " .. EXTENSION_VERSION .. " loaded, dialling :" .. CONFIG.port)
end

-- Exposed for the headless test harness and for `lua.run` introspection.
_G.AI_ARTIST = {
  version = EXTENSION_VERSION,
  protocol = PROTOCOL_VERSION,
  features = FEATURES,
  handlers = H,
  encodeJson = encode_json,
  handleCommand = handle_command,
  toPlain = to_plain,
  blob47Masks = blob47_masks,
  -- Exposed so tests/extension.test.lua can pin the SAME numbers as
  -- tests/color.test.ts. The two CIELAB ports must not drift apart: a palette
  -- snap that disagrees between the report and the pixels is worse than either
  -- being wrong alone.
  rgbToLab = rgb_to_lab,
  deltaE = delta_e,
  hexToColor = hex_to_color,
  colorToHex = color_to_hex,
  snapColorToPalette = snap_color_to_palette,
  shadeColor = shade_color,
}
