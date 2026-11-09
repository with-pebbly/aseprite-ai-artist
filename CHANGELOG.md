# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[semver](https://semver.org/).

## [Unreleased]

## [0.8.3] — 2026-11-09

### Changed

- CI now builds Aseprite 1.3.17's CLI variant from source (cached) and runs
  the headless Lua handler suite, which previously ran only on a developer's
  machine; a handler regression now fails the pipeline.
- `studio` asks whether to run more fix rounds when its three run out with a
  BLOCKING finding still standing or a score under 7/10, instead of stopping
  silently; a headless or batch run stops and says so in the report.

### Fixed

- `reference` no longer leaves the source image open as the active sprite when
  reading it fails, and now restores the user's active layer and frame too, not
  only the sprite.
- `look`, `read_pixels`, `palette` and `tileset` now refuse a reply from an
  outdated extension that lacks the fields they summarise, with an
  `install-extension` hint, instead of reporting `undefined` or an empty
  palette as if the call worked.
- **`pixel-critic` can see the sprite in Claude Code** (#10). Its `tools:`
  list named only `Read`, `Glob` and `Grep`, and an explicit list replaces
  inheritance, so it could not call `preflight`, `look`, `sprite_info`,
  `validate` or `read_pixels`, nor read `rules://` — it answered "NOT
  REVIEWED" or judged exported PNGs. Those read-only tools are now listed; the
  reference-layer check reads layer names from `sprite_info` instead of
  `reference op="list"`, which would have given it a tool that mutates.

## [0.8.2] — 2026-10-12

### Fixed

- **The OpenCode plugin loads from a git install.** `opencode plugin add
  …::path:opencode` keeps only the plugin subdirectory in its cache, so the
  plugin failed on `../hooks/shared.mjs` and found no skills. It now resolves
  both from the published package (declared dependency) when the sibling tree
  is absent, and the install command names the `#main` ref it needs.

## [0.8.1] — 2026-10-12

### Changed

- **`lua.run` is gated on both sides.** The Aseprite extension refuses the
  escape hatch unless the Aseprite process was started with
  `ASEPRITE_AI_ALLOW_LUA=1`, so the capability itself — not just the tool entry
  — is off by default. Headless sessions inherit the variable from the server
  when `--allowLua` is set.
- **Git-install bootstrap pins its lockfile.** `bin/aseprite-ai-artist.mjs`
  builds first-run installs with `npm ci --ignore-scripts`, so a plugin
  installed from git cannot execute dependency lifecycle scripts.

- **README hero in 3D.** The rainy bookshop is redrawn in two-point perspective
  as a 16-second multiplane shot at 24 fps (384 frames): 24 layers, the depth
  planes swaying with the camera, rain falling at three depths with every drop
  splashing on whatever it hits, a maple that sways and sheds leaves with the
  utility pole passing through its crown, light
  shafts and puddle reflections moving against the facade, and the lightning
  throwing long shadows. Same shop, same story; a girl in a big knit sweater
  now reads inside.

- **Benchmark score: craft counts most.** The composite is now 50% craft from
  human judges, 35% criteria passed, 15% speed (was 50% criteria, 35% craft,
  15% speed). A rating may carry the judge's own `overall` (0–10 integer), which
  replaces the axis mean as their craft score — the 0–4 axes could not hold a
  0–10 score without merging neighbours (4 and 5, 7 and 8). The existing
  `human:fedorovvvv` overall scores are migrated to it.
- **Packs sort by score.** A pack's cards, and so its cover, are ordered
  best-first by score; the order in `pack.yaml` no longer matters.

### Added

- **OpenCode install target.** `install opencode` writes the MCP server into
  OpenCode 2.x's config (`~/.config/opencode/opencode.json`, native
  `mcp.servers` shape — OpenCode 1.x cannot read it), with MCP prompts off so
  the plugin's `/aseprite:*` commands do not double.
- **OpenCode plugin.** `/aseprite:*` commands, skills, bridge status and the
  look nudge for OpenCode V2, loaded from the repo (checkout path or
  `github:...::path:opencode`).
- **Gallery pack: the rainy bookshop, before and after.** The old hero
  (plugin 0.2.0) and the 3D cut (0.8.0), both by Claude Opus 5.5, with their
  sources and prompts.
- **Site: sound effects.** Every control on the site now clicks, selects,
  toggles or opens with a short retro sound, and opening a pack has a
  soundtrack cued by its animation: the shake, the foil tearing, the cards
  rising and each ring of the fan being dealt. The effects are Kenney's CC0
  sounds picked from soundcn (credits in `apps/web/static/sounds/CREDITS.txt`).
  A speaker switch in the header (and the phone menu) turns them off; with no
  choice made, they start off for visitors whose system asks for reduced
  motion. Nothing plays before the first click or key press on a page.

### Fixed

- **`sprite_info` is valid under strict output validation.** The extension
  reports `modified`; the declared output schema did not allow it. OpenCode's
  MCP client rejects any result with undeclared properties, so the tool failed
  there while every other harness never noticed — the field is now declared.

- **Gallery prompts in English.** The blacksmith generation now keeps its
  Russian prompt in `original` and the English rendering in `text`, like the
  others.

## [0.8.0] — 2026-10-07

### Added

- **Review by fresh eyes.** `studio` now hands everything it drew to the
  `pixel-critic` agent, which runs on Opus and starts with a cold read — what
  the picture shows to someone never told what it is — and checks for murky
  value. A draft ships when the critique has no BLOCKING finding and scores
  7/10 or more; below that, each round makes one named fix, at most three
  rounds. A round snapshots what it touches, a fix that changes more than
  about a quarter of a layer counts as a redraw and is restored, and a fix is
  kept only if one critic call, shown the old and new versions blind, picks
  the new one — scores from separate calls proved not to share a scale.
  `animate` draws objects that grow on screen at three or four hand-made
  sizes, and the critic inspects key frames at full zoom. The effect on
  quality is not established: thirteen single-run experiments, all in the
  gallery beside the benchmark rows.

- **Site: a knowledge base.** `/knowledge` shows the pixel-art rulebook the
  agents follow — every rule, grouped by band, with its ` ```grid ` templates
  drawn as pixel pictures beside their legend and source — plus every skill,
  agent and bundled palette, with search across all of them. Each document has
  its own page with a sidebar of the whole base, an outline, and previous/next;
  `rules://` references in the text link to the rule they name. The pages are
  in the sitemap and `/llms.txt`, and the plugin page's skill and agent cards
  link to them.
- **About 2000 bundled palettes.** `knowledge/palettes.json` grows from six
  presets to 2006: the hand-written classics plus Lospec's 2000 most-downloaded
  palettes, each with its author and source URL
  ([docs/PALETTES.md](docs/PALETTES.md);
  `scripts/fetch-lospec-palettes.ts` refreshes them). `palette` op `preset`
  still loads by key; a key that does not exist is now a search, answering
  with up to 20 matching keys instead of the whole list. The site lists them
  all at `/knowledge/palettes`, searchable by name, author, tag and size, with
  infinite scroll; the catalogue loads as a separate JSON file.
- **Site: 8-bit toggle group.** A port of 8bitcn's `ToggleGroup` on bits-ui
  (keyboard and pressed state included), now used by the palette size filter
  and the compare page's Slider/Grid switch; the knowledge base's section links
  share its look.
- **Gallery: packs.** `gallery/packs/<slug>/pack.yaml` groups related
  generations under one title ([ADR-0012](docs/adr/0012-gallery-packs.md)). On
  the gallery and home walls a pack is one sealed booster tile in place of its
  pieces, matched by a filter when any piece inside matches. `/packs/<slug>`
  opens it: the pack shakes, the seal tears and the cards deal out into a fan,
  with every card listed below; reduced motion shows the fan already open. Each
  piece's page links back to its pack. `pnpm gallery:check` rejects a pack with
  an unknown or invalid member or a piece in two packs, and packs are
  maintainer-only like benchmark prompts. The benchmark runs now come in four
  packs, one per prompt.
- **README: a live leaderboard.** "Which model?" embeds
  `/leaderboard/{light,dark}.svg` from the site instead of a hand-written
  table — the same ranking as `/benchmarks`, redrawn on every deploy, in
  GitHub's light or dark theme to match the reader.

### Changed

- **Site: the header fits every width.** Below 1024 px the section links, the
  GitHub count and the theme switch move into a burger menu — a sheet from the
  right edge that traps focus, closes on Escape, a backdrop click or
  navigation, and hands focus back to the button. Knowledge joins the links.
- **Site: a redesign pass over every page.** The site sits in a faint lavender
  wash (with CRT scanlines in the dark theme) under a glass
  header. Every page opens with the same hero — a spaced-caps eyebrow, a title
  with a one-pixel arcade drop shadow, a lead — and sections carry a stepped
  accent marker. One orange call to action per screen; cards and framed
  buttons lift a step on hover. The leaderboard gets gold, silver and bronze
  rank gems; the install and contribute pages get a numbered stepper with
  framed terminals; the compare page a control deck; the knowledge base, piece
  pages, 404 and the 8-bit controls (inputs, selects, toggles, tables,
  sliders, toasts, the mobile menu) are restyled to match.
- **Site: a pack flies to its page.** Opening a pack from the gallery or home
  wall carries the sealed booster across the screen into the pack page through
  a view transition, and the opening waits for it to land before it shakes
  and tears.

## [0.7.0] — 2026-10-06

### Added

- **A subject-by-subject pixel-art rulebook**
  ([ADR-0011](docs/adr/0011-pixel-art-knowledge-base.md)). `rules/` grows from
  eight general files to sixty-two, in numbered bands: technique (lines,
  clusters, anti-aliasing, dithering, readability), colour and materials,
  characters (proportions, anatomy, heads and faces, eyes and expressions,
  hands and feet, hair and clothing, design, views, portraits), animation
  (timing, idle, walk and run, jumps, attacks, secondary motion, subpixel,
  top-down), creatures, environments, objects and isometric, effects and UI,
  and style (platform eras, composition, tells of generated art). Each file
  has size budgets, procedures, mistakes, a review list and ` ```grid `
  templates in the exact shape `draw` op `grid` takes — hands at 8–64 px, eye
  ladders, walk and run key poses, quadrupeds, circles and isometric cubes,
  tiles, flames. Written in our own words. `rules://index` groups them by
  band, `studio` maps each
  subject to its files, and the drawing skills and agents read them.
  `tests/rules.test.ts` compiles every template through the grid compiler,
  `scripts/rule-templates.ts` renders them to PNG for review, and a server
  test fails on any `rules://` link that names no rule.

- **Site: score charts.** Each benchmark page has a *Run by run* chart —
  every model's runs of that prompt, all models on one set of axes — and the
  benchmarks index has *Score over time* under the leaderboard: each model's
  leaderboard score on every day it ran, ending exactly on today's table.
  Both are drawn against dates: the window runs from just before the first
  run to today, a year at most, with days, weeks or months on the axis to
  suit. A marker is a run; the line is solid between runs and dashed across
  gaps of more than a week and before the first and after the last run. A
  model keeps one colour and marker shape on every chart; point at a run (or
  arrow-key through them) for every model's value that day, and pick a model
  in the legend to bring its line forward. The gallery now exports each
  leaderboard entry's `history`.

### Changed

- **Site: the benchmark hero is a podium.** It shows the top three models;
  the rest are in the full ranking below.

### Fixed

- **`palette` op `ramp` and `recolor` op `shade` shifted hue the wrong way
  for half the wheel.** Shading rotated hue in a fixed direction, so a red
  ramp's shadows went toward orange and its highlights toward magenta. Shadows
  now rotate toward blue and highlights toward yellow along the shorter arc,
  in both the server and the Lua extension.
- **`validate` with no `checks` skipped `antialiasing`**, although the schema
  says omitting runs everything. Its description also listed odd-pixel
  asymmetry and cross-frame volume drift, which no check implements; it now
  says to judge those with `look`.
- **`draw` op `ellipse` drew even-sized boxes two pixels short** — a 4×4 box
  gave a 2×2 square, 6×6 a 4×4 square — because the radius was measured to
  pixel corners. It now samples pixel centres against half the box, which
  reaches every edge of the box and matches the canonical small-circle and
  2:1 floor-ellipse tables in `rules://72-3d-forms`.

## [0.6.0] — 2026-10-06

### Added

- **Site: a page for the plugin** at `/plugin`: what it is, repository and
  npm numbers, every skill and agent with its description, and the README as
  GitHub renders it. `/plugin/install` is the install guide — a three-step
  quick start with copy buttons, then `docs/INSTALL.md` in full. Header,
  footer and the contribute page link to both. Both pages refresh their GitHub
  data every two hours (Vercel ISR), and so does the header's star count;
  when GitHub cannot be reached, the page links there instead.
- **Site: SEO.** Every page has its own title, description, Open Graph and
  Twitter card, plus JSON-LD where it fits (`SoftwareApplication`, `HowTo`,
  `VisualArtwork`, `WebSite`). New `sitemap.xml` — an index over per-section
  sitemaps for pages, benchmarks and the gallery — `robots.txt` pointing at
  it, a web manifest, and a share card. `/llms.txt` and `/llms-full.txt` give
  language models the site and the plugin in markdown.
- **Site: a full favicon set** — `.ico`, SVG, 96 px, Apple touch and manifest
  icons — generated from the 16×16 Pebbly icon by
  `pnpm --filter @pebbly/web run generate:icons` (RealFaviconGenerator), every
  size an integer multiple of the pixel grid.
- **Site: a holographic accent** (`text-holo`) for the few words that must
  pull the eye — the Plugin link, the GitHub star count now shown in the
  header, "agents" and "AI" in the page titles, and "by pebbly". The header
  logo hops and ripples into it on hover.

### Changed

- **`look` op `ascii` and `diff`: glyphs are bound to palette indices.** Glyph
  *n* is palette entry *n* on every read of a sprite, so a large sprite read in
  pieces has one legend, and rows from one piece draw back correctly in
  another. Before, glyphs were assigned per read, and the same letter could be
  two different colours in neighbouring regions. Colours outside the palette
  take the slots after it and are listed in the new `offPalette` field — the
  only glyphs that can change between reads. The alphabet grew from 72 to 261
  characters (Latin-1 and Latin Extended-A letters after ASCII), enough for a
  full 256-colour palette.
- **Text grids are bounded by the canvas, not by fixed sizes.** `look` op
  `ascii` reads the whole canvas (was 4096 cells), and `draw` kind `grid`
  accepts up to the canvas size on each side (was 256).
- **Site: SvelteKit 3,** adapter-vercel 7, and every other dependency at its
  latest, except TypeScript, held at 6: SvelteKit 3.0 and svelte-check still
  need TypeScript's JavaScript API, which TypeScript 7 no longer ships. The
  configuration moved from `svelte.config.js` into `vite.config.ts`, and the
  FSD layer aliases (`$shared/…`) became package.json subpath imports
  (`#shared/….js`). Vercel Web Analytics is wired through `$app/state`,
  because `@vercel/analytics/sveltekit` still imports the removed
  `$app/stores`.
- **Site: borders and corners.** Borders step down with nesting — 6px outside,
  4px inside, 2px deeper — and every stepped corner gets the inner corner pixel
  the 8-bit components draw, instead of edges that stop short of each other.
  The lightbox closes with the site's pixel icon button.
- **Site: benchmark previews show the best-crafted run,** not the
  highest-scoring one; score and date break ties.
- **Site: "Add your art".** A button in the header on every page and one
  beside the gallery's title, both leading to the contribute page.
- **Benchmark: only human craft ratings count.** Ratings from model judges
  stay valid in `generation.yaml` but are ignored — not shown, not scored —
  until they are re-evaluated.
- **Benchmark: a run with no recorded time is not penalised for speed.** Its
  score is criteria and craft alone, rescaled to 0–100, instead of counting
  speed as 0.
- **Site: the benchmark page leads with the results.** Each ranked model's
  best piece, winner first; the prompt and criteria close the page.

## [0.5.0] — 2026-10-02

### Added

- **Benchmark runs on 0.5.0.** All three benchmarks re-run with Claude Opus 5.5
  using `grid`: the mage scores 14/15, the tree 12/13 and the road 13/14, and
  each can be set against its 0.4.0 run on the new compare page.
- **Site: compare runs of one benchmark.** `/benchmarks/<prompt>/compare`,
  linked as *Compare runs* from a benchmark with two or more runs. Pick an
  image — any step's still, animation or filmstrip — then either drag a
  divider between two runs drawn at the same scale, so the same art pixel
  sits under the same screen pixel on both sides, or lay any number of runs
  out as a grid. Animations are decoded and played on one shared clock,
  each stretched to the longest loop, so they start and end together; a
  scrubber pauses and steps through them, and each run shows its own loop
  length and the speed it plays at. Filmstrips are shown raw — untimed,
  uncropped — as full-screen-width rows at a fixed height. The mode, image
  and runs are kept in the URL, so a comparison can be linked.
- **Site: renamed Pixeli, at [pixeli.pebbly.space](https://pixeli.pebbly.space/),
  with a pin-board gallery.** Running text is set in Pixelify Sans, headings
  stay in Press Start 2P, and every page carries a canonical link to the
  deployed address. A new footer links the site, the plugin's docs and
  pebbly, signed with the pebbly logo redrawn in pixels. The home page's
  newest pieces and the gallery share one full-width wall. The gallery spans the
  whole screen in up to six masonry columns. Cards are drawn like pixel game
  cards — a stepped pixel frame, a name plate with the score as a gem, the
  art in its own framed window, a text plate — over a blurred glow of the
  art itself; benchmark cards share the design. Art everywhere fills its
  width edge to edge with the height following, and only art too wide to
  reach a minimum height gets space above and below. Images, the compare
  slider and grid tiles open full screen; page changes cross-fade through
  the View Transitions API, and a piece's art moves from its card to its
  page.

- **`draw` kind `grid` — draw by writing the picture.** A legend (one
  character → colour, `.` transparent) and rows of text, one character per
  pixel, compiled on the server into ordinary draw ops. The model sees the
  whole silhouette while it writes it instead of composing it from shapes.
  `transparent: "erase"` (default) makes the rectangle exactly the grid;
  `"skip"` stamps over existing art. Ragged rows and undeclared characters are
  refused with their row and column. See ADR-0010.
- **`look` op `ascii` is the readable half of that round trip.** It now returns
  `gridRows` and `origin` alongside `legend`, and `rulers: false` prints the
  bare rows: read a layer, edit the rows, send them back as a grid at the same
  origin. The `draw`, `fix` and `animate` skills use this for pixel-level
  edits and for redrawing a part from one key pose to the next.

- **Benchmark: craft ratings and run metrics.** A generation can carry blind
  `ratings` — one per judge, 0–4 on `read`, `form`, `motion`, `cohesion` and
  `appeal` against the anchors in `gallery/RUBRIC.md` — and per-step
  `metrics` (minutes, tool calls, output tokens, cost). Compliance still ranks
  first; craft breaks ties and has its own column; cost is shown, never
  ranked. The checker refuses a model rating a run it took part in and a
  missing `motion` score on an animated run.
- **Gallery: `references` on every generation.** Required, no default:
  `source` (`none`, `generated` by an image model, or `supplied` by the
  author), `imageModels`, `kinds` (concept-sheet, storyboard, …) and the
  optional image-model `prompt`, plus a `reference` file role. The benchmark
  ranks concept-assisted runs on their own row (`model · concept by
  gpt-image-2`), and the site shows the source on every generation page.
  `aseprite:submit` fills it in.
- **Gallery: `steps[].original`.** A prompt sent in another language can be
  shown in English while the verbatim text is kept; benchmark runs cannot use
  it. The Pebbly generation's prompts now read in English with the Russian
  originals kept.

### Changed

- **Benchmarks: the knight is retired; three fully specified prompts replace
  it.** `boombox-mage` (a street-mage, then an anime sound-blast attack with
  an impact frame and effect layers confined to their beats), `tree-growth`
  (a cherry tree, then its growth from a seed built backwards from that exact
  final frame) and `winding-road` (a deep-perspective valley road, then a
  24-frame seamless ambient loop with a wagon travelling it). Each step text
  fixes size, palette, layout, colours, layer names, frame counts and timing,
  so runs on different models answer the same task. The eval guide moved to
  `docs/evals/benchmarks.md`.

### Fixed

- **`frame reorder` keeps a tag that covers only the moved frame.** Deleting
  the original frame took such a tag with it; it is now rebuilt with its name,
  colour, direction and repeats.
- **Erasing on an indexed sprite writes its transparent index.** Region and
  selection `clear` — and so every `.` in a `grid` — wrote index 0, which is
  opaque on a sprite whose transparent index is something else.
- **`draw` `selectionOnly` clipped only `pixels`.** The schema promised every
  op; `rect`, `line`, `polyline`, `ellipse`, `fill`, `replace`, `dither`,
  `gradient`, `clear` and `blit` painted straight through the selection. The
  clip now lives in the one function every primitive writes through, so a new
  op cannot miss it, and a contiguous `fill` no longer spreads across the
  selection edge.
- **`frame` op `reorder` always failed** with `command 'MoveFrame' not found`
  — Aseprite 1.3 has no such command. It now moves the frame's cels and
  duration to `toIndex` through the sprite API and leaves tag ranges where
  they were.
- **`draw` op `fill` ignored `tolerance`.** Every fill was exact. On RGB
  sprites `tolerance` is now the largest per-channel difference still counted
  as the clicked colour; indexed and grayscale fills stay exact.
- **`look` ops `onion` and `filmstrip` ignored `layer`.** Over an opaque
  background the target frame covered every ghost, so onion skin of a moving
  prop in a scene showed nothing. Both now render only the named layer when
  one is given.
- **`export` ignored `layers` and `tags`.** Both were in the schema and never
  read, so every export wrote every layer and frame. `layers` now limits png,
  gif, frames and spritesheet to those layers; `tags` limits gif, frames and
  spritesheet to the frames the tags cover. `aseprite` (and `png` for `tags`)
  refuses them instead of ignoring them.
- **`look` op `ascii`/`diff` with `layer` read the composite.** The layer was
  passed through but the read stayed flattened, so a per-layer diff silently
  diffed the whole image. Naming a layer now reads that layer's cel.
- **Site: wide art no longer loses its left edge.** An image wider than its
  box (a long filmstrip) was centred inside a scroll container, which pushed
  its left part out of reach; it now starts at the left and scrolls right.

## [0.4.0] — 2026-09-29

### Added

- **Headless mode (`serve --headless`, `ASEPRITE_AI_HEADLESS=1`).** The server
  runs one long-lived batch Aseprite (`aseprite -b` + `headless/runner.lua`)
  instead of driving an open window — for CI, scripted asset builds and
  machines without a display. Same tools and the same Lua command table;
  documents stay in memory until `save`/`save_as`/`export`. Chosen at startup
  or per session with `preflight mode="headless"|"live"` — `aseprite:studio`
  picks it from the request, `--headless`/`--live` force it; never a fallback.
  Refuses to open or write a file the user's attached
  Aseprite window has open (`file_open_in_editor`). `preflight` reports
  `mode`; `doctor` shows which executable headless would run; `install
  --headless` writes the flag, `--aseprite` the path.
  [ADR-0008](docs/adr/0008-headless-mode.md).
- **`aseprite:concept` skill — design with an image model, draw with the
  agent.** Writes the art spec (scenario, palette hexes, view, key poses),
  turns it into a ready-to-paste prompt for a concept sheet or storyboard, and
  offers the user one choice: send references back or continue without. Then
  reads the reference into a PixelSpec and imports it. `studio`, `brief`,
  `draw`, `animate`, `review`, `fix`, `animation-director` and `pixel-critic`
  use it. [ADR-0009](docs/adr/0009-concept-first.md).
- **`reference` op `import` takes `region`, `grid` and `frame`.** `region` crops
  one panel of a sheet (also for `sample_palette`); `grid` cuts a storyboard into
  panels and puts panel i on frame i of one reference layer. `frame` was read by
  the extension but never reachable through the schema.
- **`look` op `compare`.** The reference layer at full opacity beside the art
  without any reference layer, same frame and scale — rendered from a scratch
  copy, so nothing in the document changes. Needs `install-extension` and an
  Aseprite restart.
- **`aseprite:submit` skill.** Turns a finished sprite into a gallery pull
  request: exports the `.aseprite`, cover, GIF and filmstrip with `export`,
  writes `generation.yaml` with the prompts verbatim and the model per step,
  scores benchmark criteria only from evidence it looked at, runs
  `pnpm gallery:check`, and opens the PR with `gh` — after asking.
- **The gallery (`gallery/`).** A store of generations, each with its files,
  prompt sequence, models, harness and plugin version, validated by one zod
  schema (`pnpm gallery:check`, also in CI). The benchmark is derived from it:
  prompt × model × plugin version, scored against the prompt's criteria. The
  knight benchmark moved to `gallery/prompts/knight/prompt.yaml`.
  [ADR-0006](docs/adr/0006-gallery-and-benchmark.md).
- **The site (`apps/web`).** SvelteKit + shadcn-svelte with components ported
  from 8bitcn/ui and icons from pixelarticons: the benchmark as one block per
  prompt with a model × version matrix, a filterable gallery, a page per
  generation with downloads and copy-the-prompt buttons. Deploys to Vercel
  from `main` only. Generation files are linked from GitHub at the deployed
  commit rather than copied into the deployment.
- **Pebbly, the mascot** — a pebble with a paintbrush sprouting from its head,
  drawn with the plugin itself: a 48×48 eight-frame idle for the site, and a
  brushless 12×9 pebble for the logo and favicon. It is the gallery's first
  generation.

### Fixed

- **`export` ops `spritesheet` and `frames` honour `scale`.** Both accepted it
  and wrote 1× files. They now export from a nearest-neighbour upscaled scratch
  copy — the source sprite is untouched and the copy is closed — so the atlas
  JSON describes the scaled texture. Needs `install-extension` and an Aseprite
  restart to take effect.

### Changed

- The repository is a pnpm workspace driven by turborepo. The plugin stays the
  root package and the published tarball is unchanged; contributors run
  `pnpm install` instead of `npm install`. The root `package-lock.json` stays,
  for the plugin launcher's first-run `npm install` on git installs, and CI
  fails when it drifts.

## [0.3.2] — 2026-09-29

### Changed

- `draw` skill: text is its own step instead of a subsection of outlining, and
  the outline step explains `side` and `diagonals`. Fixed a garbled sentence in
  the `animate` skill.

## [0.3.1] — 2026-09-29

### Changed

- **Skills, agents and rules now use the 0.3 tools.** `review`, `animate`,
  `animation-director` and `pixel-critic` check in-betweens with `look` op
  `onion` and close with `validate` `expect`; `fix` reads `changedBounds` and
  routes labels to `draw` kind `text`; `palette-smith` knows `palette` op
  `extract`; `rig-builder` addresses twin layers by group path and reuses parts
  with `layer duplicate` `toSprite`; `studio` routes text and slice requests;
  the outline and review rules cover `side`/`diagonals`, onion and overlap
  checks.
- **README** folds the 0.3 features into the skill guide instead of a separate
  what's-new list, and tells upgraders to reinstall the extension.

## [0.3.0] — 2026-09-29

### Added

- **`look` op `onion`** — the target frame at full opacity over ghosted
  neighbouring frames, oldest-first. For checking in-betweens and spacing
  while animating without stepping through frames one at a time.
- **`look` op `diff` reports `changedBounds` and `percentChanged`** alongside
  the existing text grid, so a caller can read the size of a change without
  parsing the glyphs.
- **`draw` op kind `text`.** Lays out a string from a bitmap font
  (`knowledge/fonts/`, one ships: `pixel5x7`) and expands it to plain pixels
  in TypeScript before it reaches Aseprite, so it shares the batch's palette
  lock and undo step. `measureOnly` returns each op's ink bounds without
  touching the sprite, for centring a label or sizing a panel first. See
  [ADR-0005](docs/adr/0005-bitmap-text.md).
- **`cel` ops `tween` and `oscillate`.** `tween` interpolates a cel's
  position or opacity between two frames with an easing curve; `oscillate`
  adds a sinusoidal position offset over a frame range. Both fill in any
  missing in-between cels from the start cel, in one transaction — for
  secondary motion like a bob, a breath, or a float.
- **`sprite_manage` ops `slice_create`, `slice_update`, `slice_delete`.**
  Slices name a rectangular region of the canvas for an engine to read back:
  a 9-patch panel's `center`, or a hotspot's `pivot`. `sprite_info`'s
  `slices` array now reports `center`/`pivot` when set, and they carry
  through into the spritesheet atlas on export.
- **`palette` op `extract`.** Replaces the palette with one quantized from
  the art itself (RGB sprites only) — for deriving a curated palette from a
  reference image imported at full colour.
- **`validate` input `expect`.** The animation contract you already know:
  `layerFrames` flags art outside a layer's expected frame ranges (or a
  missing cel inside one); `mustNotOverlap` flags any frame where two named
  layers' opaque pixels intersect. Runs independently of `checks`.
- **`transform` op `outline` gains `side` and `diagonals`.** `side: "inside"`
  recolours opaque pixels touching transparency instead of growing the cel;
  `diagonals` switches 4- to 8-neighbour. Default behaviour (`outside`,
  4-neighbour) is unchanged.
- **`layer` op `duplicate` gains `toSprite`.** Copies the layer's cels into
  another OPEN sprite by frame index; frames past the target's frame count
  are dropped and reported.
- **`docs/evals/knight-benchmark.md`** — our own two-prompt benchmark (a
  still 32×32 knight, a windup-to-follow-through sword slash) with a fixed
  setup, a procedure, pass criteria and a results log.

### Changed

- **Every `layer` parameter accepts a `group/child` path**, and a name or
  path that matches more than one layer now fails with `invalid_args` naming
  every match, instead of silently resolving to one of them. Duplicate layer
  names were always possible in Aseprite; only ambiguous lookups now error —
  pass a group path to disambiguate.
- **Users must reinstall the extension.** New ops (`onion`, `text`,
  `tween`/`oscillate`, `slice_*`, `extract`) need the extension side of this
  release: `npx @pebbly/aseprite-ai-artist install-extension`, then quit and
  reopen Aseprite.

### Fixed

- **`export` op `spritesheet` no longer blocks on an overwrite prompt when
  the target files already exist** (the call used to time out).

## [0.2.1] — 2026-09-28

### Fixed

- **Windows:** the auto-started bridge no longer opens a console window, and
  `npm run clean` works without a Unix shell. The README gets a platform
  section listing where the installer looks for Aseprite on macOS, Linux and
  Windows.

## [0.2.0] — 2026-09-28

### Added

- **New README hero:** a 500×400, 72-frame rainy-night bookshop drawn end to
  end by Claude Opus 5.5 through this server; the README now recommends Opus 5.5
  as the model to drive it. The robot and the harbour moved to the gallery.

- **omp support.** `omp plugin marketplace add with-pebbly/aseprite-ai-artist`
  then `omp plugin install aseprite@aseprite-ai-artist` brings the server,
  the workflows and the four subagents from the same tree Claude
  Code reads. omp does not run Claude's `hooks.json`, so the two hooks ship
  again as an omp extension (`omp/aseprite-ai-artist.mjs`, declared under
  `omp.extensions` in `package.json`): bridge status on the first prompt, and
  the once-per-session `look` nudge after `draw`, `recolor` or `transform`.
  The extension also registers the `/aseprite:*` commands, since omp would
  otherwise list plugin skills as `/skill:<name>`.
- **`aseprite:studio`, a workflow that runs the others.** Given any request it
  classifies it, writes down the chain of workflows it needs (brief → new →
  draw → shade → rig → animate → review → export, or any slice of that), hands
  stages to the specialist agents where the harness has them, and does not
  report done before `look` and a review. The server instructions now point to
  it when no single workflow fits.

### Changed

- **Breaking: every workflow is `aseprite:<name>` in every client.** Skill
  directories lost their `pixel-` prefix (`skills/draw`, `skill://draw`), the
  plugin is now `aseprite` (Claude Code shows `/aseprite:draw`), MCP prompts are
  named `aseprite:draw`, and the server instructions list them under those names.
  Claude Code users must reinstall: `/plugin uninstall aseprite-ai-artist`, then
  `/plugin install aseprite@aseprite-ai-artist`. `skill://pixel-*` URIs no longer
  resolve. The npm package and the MCP server key are unchanged.
  Plugin installs start the server with `ASEPRITE_AI_PROMPTS=0`: the harness
  already lists the skills, and the prompts would reappear as
  `/aseprite:aseprite:aseprite:<name>`.

- The hook messages and the bridge probe moved to `hooks/shared.mjs`, so the
  Claude Code hooks and the omp extension cannot drift apart. The session hook
  no longer probes the plugin port, whose answer it never used.

## [0.1.6] — 2026-09-09

Mostly documentation and art, plus one thing that should have existed from the
start. The extension's own code is unchanged from 0.1.5 apart from the version
string it reports.

### Added

- **`doctor` and `preflight` now say when the attached extension is older than
  the server.** Aseprite loads the extension once, at startup, so an editor left
  open across an upgrade keeps answering with the old build — silently, for as
  long as that session lasts. Nothing compared the two versions, so this went
  unnoticed for a whole working day: three bugs fixed in 0.1.5 went on being
  worked around by an agent talking to a 0.1.3 extension that reported itself
  perfectly happily. A mismatch is no longer a tick, and `preflight` puts it in
  the directive the agent reads first.
- `docs/media/src/hero2/` — the generator the hero is built from: a coordinate
  model that emits all 54 frames, a push script, and `compare.py`, which diffs
  the model against Aseprite's own export and currently reports zero differing
  pixels. The scene had been regenerable only from a temporary directory.

### Changed

- **The hero animation closes its loop.** It ran 36 frames, finished the
  painting and hard-cut back to a blank canvas. Now the robot holds on the
  finished picture, wipes it off, and starts again — 54 frames, tagged `paint`
  (1–33), `hold` (34–37), `erase` (38–52), `reset` (53–54). Frame 54 hands over
  to frame 1 with 60 pixels different, all of them deliberate: the first dab,
  the antenna, one step of the dust clock.
- **The README is half the prose it was.** Fifteen headings became nine, the
  install is three short steps, and the per-client capability table moved to
  `docs/INSTALL.md`, which is where someone installing actually looks.
- `docs/INSTALL.md` explains why `npx @pebbly/aseprite-ai-artist` fails inside a
  checkout of this repository. npm resolves the current project as the package,
  skips fetching it, and looks for the binary in `node_modules/.bin` — where a
  package's own bin is never linked. The result is `command not found`, which
  reads like a broken package and is only ever a wrong working directory.

## [0.1.5] — 2026-09-09

Three commands reported success while doing nothing. That is worse than an
error: the agent believes the edit landed and builds the next step on top of it.
All three surfaced while drawing a 35-layer scene through the bridge, none of
them from a crash.

### Fixed

- **`layer` op `group` could never have worked.** It called
  `Sprite:newGroupLayer()`, which is not in the Aseprite API. Indexing a missing
  field throws rather than returning nil, so the whole batch — every other op in
  it included — rolled back with `Field newGroupLayer does not exist`. The
  method is `newGroup()`.
- **`cel` op `link` linked nothing and counted everything.** `LinkCels` acts on
  the timeline range, not on the active layer and frame; the old code set those
  and called the command once per target frame, which is a no-op, then reported
  one success per frame. A caller was told a static layer had been shared across
  a cycle while the target frames were still empty. The range now holds the
  source cel and every target together in one call, the reply counts only frames
  that actually ended up sharing the source image, and linking from a frame with
  no cel is now an error naming `copy` as the way to seed one.
- **`validate` timed out on a large sprite.** Its stray and outline scans asked
  `pixel_to_hex` — a `string.format` — whether a pixel was opaque, for every
  pixel and each of its four neighbours: tens of millions of strings allocated
  to compute a boolean. Presence is now answered without allocating. Measured on
  the 35-layer, 36-frame sprite this was found on, the stray scan went from
  10.5s to 2.2s and found the identical 1373 strays.

### Changed

- **The per-pixel checks skip hidden layers**, as `outline` and `banding`
  already did. A finding about pixels that never reach the export is noise, and
  a document that keeps its earlier drafts as hidden layers is mostly hidden —
  on the sprite above, 769 of 1042 cels. `validate` now says how many layers it
  passed over, so a clean result cannot quietly mean "clean, because I did not
  look".
- `validate.run` gets its own 120s budget rather than the shared 20s default. A
  thorough pass over a rigged sprite is legitimately slow, and a timeout reads
  to an agent as "Aseprite is not answering" — the one message that sends it
  looking for a workaround.

## [0.1.4] — 2026-09-08

### Fixed

- **GIF export waited for a click nobody was there to give.** Aseprite warns
  once per session that GIF cannot hold everything a sprite can, and no save API
  declines it. From outside it did not look like a prompt at all: a modal pumps
  events while it waits, so every other command kept answering and only the
  export appeared to hang. It is now suppressed for the duration of the export
  and handed straight back, so File ▸ Save As keeps whatever the user chose.
- 0.1.3 tried to fix this with `SaveFileCopyAs{ui = false}`. That flag does not
  govern this dialog. GIF export now converts a throwaway copy to indexed
  instead of leaving the conversion to a prompt — and on a copy, because doing
  it in place would silently change the colour mode of the document being
  worked in.

### Added

- `export` op `gif` honours `scale`. A browser scaling a 128px GIF up smooths
  it, and smoothed pixel art is ruined pixel art; exporting big keeps the pixels
  square wherever the file is shown.

### Known

- The first GIF export in an Aseprite session costs 20-30 seconds — measured
  20.6s, then 435ms for the identical export straight after. Something warms up
  once. The 120s export budget from 0.1.3 covers it.

## [0.1.3] — 2026-09-08

### Fixed

- **Exporting a GIF from a live window never returned.** Writing an RGB sprite
  to GIF needs a colour quantisation that Aseprite asks about, and
  `Sprite:saveCopyAs` has no way to decline the dialog. The diagnosis was
  misleading: a modal dialog pumps events while it waits, so every other command
  kept answering normally and only the export looked stuck. Now uses
  `SaveFileCopyAs{ui = false}`. Headless tests could never catch this — `aseprite
  -b` has no dialogs at all.
- **Even fixed, the first GIF export timed out.** Aseprite warms its GIF codec
  once per session: measured at 38s for the first write of a 32x32 sprite and
  about 2s for every one after, against a 20s client timeout. So the first
  animation anyone exported failed on work that then succeeded. `export` now
  gets its own 120s budget.

### Changed

- `LiveClient.call` takes an options object (`expect`, `timeoutMs`) instead of a
  third positional argument.

## [0.1.2] — 2026-09-08

### Fixed

- **`preflight` failed on a freshly started editor.** 0.1.1's new boundary check
  required `sprite` from `session.site`, but a Lua table cannot hold nil: with
  no document open the key never reaches the wire at all, and the check could
  not tell that apart from an extension too old to send it. The first call any
  agent makes therefore failed, telling the user to reinstall a perfectly
  current extension. It now requires `openSprites`, which is always present.

## [0.1.1] — 2026-09-08

### Fixed

- **`transform op=crop_to_content` did nothing and reported success.** It called
  `CanvasSize{trimOutside=true}`, which trims to the *selection*; with none set
  the canvas was untouched. Aseprite's own Sprite > Trim is `AutocropSprite`.
  `pixelsChanged` now reports the area dropped.
- **Importing a reference broke every write that followed it.** `app.open` makes
  the opened file the active sprite and closing it left *no* active sprite at
  all — `app.transaction` refuses to run in that state, so `reference` op
  `import` and `sample_palette` failed, and in the UI the user's tab changed
  under them. The active sprite is restored.
- **A failure inside a transaction arrived as `function: 0x...`.** `transact`
  retried the failing closure through the older one-argument `app.transaction`
  and reported the *second* attempt's error, hiding the first — and replaying a
  mutating closure on top of its own half-applied changes. Which form the build
  supports is probed once instead.
- **`doctor` started a bridge and then reported that bridge as healthy**, and
  left it running. It now says when it started one to test with, stops it again,
  and reports the extension as `unknown` rather than telling the user to open
  Aseprite when the bridge — not Aseprite — is what could not be reached.

### Added

- `tests/pure.test.lua`: the Lua checks that need no editor, so CI finally
  executes part of the extension instead of only parsing it. It runs under stock
  Lua with stand-ins, and unmodified inside Aseprite with the real types.
- A presence check at the Lua→TypeScript boundary: a call may declare the reply
  fields it goes on to read, and a reply without them fails with a message
  naming them instead of letting `undefined` reach the agent as a success. This
  catches an extension older than the server; it is not schema validation, and
  an argument the two sides spell differently is still only caught by the Lua
  suite.
- Coverage for every palette command, reference import/list/sample/remove,
  `transform` crop/translate/scale/outline, `select` all/ellipse/color/invert/
  grow/shrink, `resize_canvas`, `set_properties`, and png/gif/spritesheet
  export. The Lua suite goes from 39 checks to 57, the Node suite to 40.

## [0.1.0] — 2026-09-08

First release. Includes every fix from the pre-release audit below.

### Fixed — 2026-09-08 multi-expert audit

Six reviewers plus two live Codex CLI runs; every item below was reproduced
before it was fixed and has a regression test that fails without the fix.

- **Closed polylines lost their closing edge.** The outline loop stopped one
  short of the wrap the fill loop already did, so a "closed" triangle shipped
  with one side missing and the call reported success.
- **Thick lines were silently clipped.** The bounding box ignored `thickness`,
  so the cel was grown to the endpoints only and the rest of the brush was
  dropped — a 7×7 stamp landing one pixel, reported as success.
- **Fuzzy tile packing merged unrelated tiles on indexed sprites.** The distance
  function read RGB channels out of palette indices. It now refuses non-RGB
  sprites instead of guessing.
- **`transform` op `rotate` with `angle: 0` reported a full-canvas change** for
  an operation that touched nothing, breaking idempotency checks.
- **`validate` never ran its `outline` or `banding` checks.** Both were in the
  schema and in the handler's own default set, and no branch read either — the
  tool answered "Clean." without running them. Both are now implemented.
- **`cel` op `list` always reported `linked: false`**, and `frame` op
  `duplicate` with `linkCels` never actually linked (it called a command that
  does not exist in Aseprite 1.3).
- **`draw` op `gradient` ignored `dither`**, and `diagonal` and `radial`
  silently rendered as `vertical`. All four directions and the dither flag now
  work.
- **`transform`'s `scope` parameter did nothing.** Removed rather than
  half-implemented; transforms act on one cel, and the docs now say so.
- **`tag`'s `repeat` was ignored.** The schema said `repeat` on input and
  output while Aseprite's property is `repeats`, so loop counts were silently
  dropped. Renamed to `repeats` on both sides.
- **`sprite_manage` op `new` returned an identifier that could not be used.** It
  answered `"untitled"` while the sprite was called `"Sprite"`, so feeding a
  tool's own output into the next call failed. Every result now carries a stable
  `id`, and two unsaved documents are no longer ambiguous.
- **Previews were capped far below a readable size.** The upscale factor was
  capped at 16, rendering a 16px sprite at 256px — the case where upscaling
  matters most. The bound is now on output size (~2048px), so small sprites
  reach the documented ~1024px.
- **`selectionOnly` silently widened to the whole cel** when nothing was
  selected. It now refuses.
- **Text grids collided past 71 colours**, quietly misreporting which colour was
  where in the tool used to verify edits. It now refuses.
- **Config writes were not atomic.** A partial write to `~/.claude.json` (100KB+
  of Claude Code's own state) would have broken the user's whole setup. Writes
  go through a temp file and a rename.
- **A dropped bridge left in-flight calls waiting out their 20s timeout**, which
  reads to an agent as "slow" rather than "disconnected". They now fail
  immediately, and a bridge that dies after being spawned can be respawned.
- **Non-`EADDRINUSE` bind failures were reported as "another bridge owns this
  port"**, sending users after a process that does not exist.
- **`run_lua` could leave Lua's global `print` hijacked** for the rest of the
  Aseprite session if the transaction threw.
- **The Claude Code plugin could not start on Windows.** Its MCP `command`
  pointed at a bash script, and Windows does not interpret `#!`. The launcher is
  now Node.
- **`package.json` claimed the 2026-07-28 spec**, contradicting ADR-0004's
  decision to target 2025-11-25. `engines.node` also promised 20.10 while the
  test script needs 22.6.

### Fixed — audit round two

The six reviewers' full reports arrived after the first round of fixes and
carried a further fourteen items, all closed here.

- **`snapToPalette` promised a transparency guard it did not have.** A fully
  transparent input now snaps to itself instead of to the nearest opaque colour,
  which would have painted over deliberate holes.
- **`refused` and `too_large` error codes were declared and never raised**, so
  every "you asked for something out of bounds" refusal arrived as a generic
  `aseprite_error` and an agent could not tell it apart from an internal
  failure. Both are now used at the real refusal sites.
- **The bridge had no frame-size or client cap** on an unauthenticated socket —
  `ws` defaults to 100 MiB per frame. Now 16 MiB and 64 clients.
- **The Codex TOML editor matched its block header anywhere in the file**,
  including inside a comment or a string. The match is now anchored to a line.
- **`layer`'s `batch` was the least-typed path in the surface** while being the
  documented way to build a rig: `z.record(z.unknown())` accepted an opacity of
  `"hello"` and Lua assigned it. It is now the same typed object as the
  single-op form.
- **The Lua reconnect state machine had no per-socket identity check**, so an
  event from a superseded socket could clobber the new connection's state. The
  TypeScript side already guarded the mirror-image race.
- **A rejected `close()`/`stop()` left a floating promise rejection** in the
  CLI's shutdown paths.
- **Four output schemas under-documented what Lua actually returns** —
  `palette` op `load`'s `path`, `sprite_manage` op `list`'s colour mode and
  counts, and the layer entries' `editable`/`isTilemap`/`cels`.
- **Lua test cleanup was not exception-safe.** One failing assertion left the
  active document pointing at a closed scratch sprite and cascaded into every
  later check — the failure this project already hit once. All sixteen scratch
  blocks now go through a helper that always closes and always restores.
- **The cross-language CIELAB claim was not actually enforced.** ADR-0001 and
  ARCHITECTURE.md both said the two ports are held to the same expectations;
  only the TypeScript side had numeric fixtures. The Lua side now pins the same
  white/black L\*, ΔE bounds, grey-snaps-to-grey case and hue-shift direction.
- **`export` op `frames` had no coverage at any level.** Verified it does write
  one file per frame (numbered from 0, now documented) and locked that in.
- **The e2e test used the real default ports**, so running it on a machine with
  a live Aseprite session could steal that session — the bridge accepts the last
  plugin to connect. Ports are now overridable, the risk is documented, and the
  test removes the files it writes.
- **`SECURITY.md` overstated the `allowLua` gate.** It gates the tool surface
  your agent sees, not the capability: the extension implements `lua.run`
  whenever installed and the bridge has no authentication. Now stated plainly,
  alongside the filesystem reach of every `path` argument.

### Added

- `SECURITY.md` — threat model, the localhost bridge's real exposure, what
  `install` touches, and the `run_lua` gate.

### Added — initial implementation

- **MCP server** (`serve`) speaking protocol `2025-11-25`, with 18 tools grouped
  by noun. Every tool declares an `outputSchema` and returns
  `structuredContent`. See [ADR-0003](docs/adr/0003-compact-tool-surface.md) and
  [ADR-0004](docs/adr/0004-protocol-version.md).
- **Standalone WebSocket bridge** (`bridge`), singleton by port ownership,
  outliving MCP server restarts and serving several agent windows at once. See
  [ADR-0002](docs/adr/0002-standalone-bridge.md).
- **Aseprite extension** (`extension/ai-artist.lua`) implementing 23 commands
  against Aseprite 1.3's Lua API, with every mutation inside a transaction so
  one Ctrl+Z undoes one agent action.
- **`look`** — upscaled previews, exact one-glyph-per-pixel text grids,
  animation filmstrips and pixel-level frame diffs.
- **Palette discipline** — CIELAB ΔE snapping on by default in `draw` and
  `recolor`, with a report of every colour moved and how far.
- **Hue-shifted shading** (`recolor` op `shade`, `palette` op `ramp`): shadows
  cool, highlights warm.
- **`validate`** — a lint pass with located findings for palette sprawl, stray
  pixels, semi-transparent pixels, untagged animation and uniform timing.
- **Skills over MCP** — 11 `/pixel-*` workflows and an 8-chapter pixel-art
  rulebook, served as `skill://` and `rules://` resources and as MCP prompts, so
  Codex, Gemini CLI and Cursor get the same discipline as Claude Code.
- **Cross-client installer** (`install`) for Claude Code, Codex, Gemini CLI,
  Cursor, VS Code and Windsurf, with backups and `--dry-run`, plus an
  `AGENTS.md` writer.
- **`doctor`** — a diagnosis command that reports each link in the chain.
- **Claude Code plugin** with four specialist subagents (pixel-critic,
  palette-smith, rig-builder, animation-director) and two hooks.
- **Tests** — TypeScript unit and integration tests for colour, rendering, the
  bridge transport and the MCP surface; a headless Lua harness running the real
  extension handlers inside `aseprite -b` against a real sprite.

- **Tilesets** — `pack` turns a hand-painted mockup into a deduplicated tileset
  plus a tilemap that reconstructs it pixel for pixel (with an optional
  `tolerance` for merging near-identical cells), and `export` writes Tiled
  (`.tsj` tileset plus a `.tmj` map that uses it), Godot 4 (`.tres`) or JSON,
  each beside a packed PNG. `layout: "blob47"` adds a Tiled wangset whose 47
  canonical masks are computed, not hardcoded.

### Known limits

- `blob47` export assumes the tileset is authored in canonical blob-mask order
  and refuses an incomplete set rather than writing a wangset that would
  autotile wrongly.
- Godot export targets Godot 4 (`TileSetAtlasSource`); Godot 3 is not emitted.
- Re-establishing a *dropped* Aseprite connection can wait until the Aseprite
  window is focused once. A live connection keeps working unfocused.
- `look` op `ascii` refuses above 64×64; pass a region.
