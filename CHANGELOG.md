# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`video.proxy` + `edit.conform`** — the offline/online split, which the toolkit had no
  representation of. `video.proxy` builds low-resolution editing stand-ins for a file or a folder
  and writes a manifest; `edit.conform` reads that manifest and rewrites a timeline so
  `render.timeline` reads the originals. Proxies preserve duration and frame rate exactly, which is
  what makes the swap valid — and conform **refuses** rather than warns when a proxy's duration has
  drifted, because that would silently move every cut point after it.
- **Per-clip properties in `render.timeline`** — clips now carry `transform` (`scale`, `x`, `y`,
  `rotation`, `background`), `speed` and `volume`. This was the highest-leverage change in the
  codebase: it turns the timeline from a concat into an edit. You can now hold one shot smaller
  and off-centre over a background, retime a single clip, and sit one clip's audio under another
  — all without pre-rendering intermediates.
- **`analyze.scopes`** — waveform (IRE scale), vectorscope and RGB parade, plus numeric
  `signalstats` and plain-language legal-range notes. Grading without measurement is guesswork.
- **`edit.transcript_cut`** — cut picture by what was said: drop fillers, keep only matching
  lines, tighten pauses. `voice.stt` produced per-segment timings and nothing consumed them.
- **`video.transform`** — keyframed scale / position / rotation, composited onto a background.
  This was the biggest gap in the toolkit: everything could assemble and process clips, but
  nothing could *animate* one, which is what separates assembling assets from editing them.
  Unlocks animated picture-in-picture, push-ins on footage, sliding titles and dynamic crops.
  Keyframes are interpolated by summing clamped ramps into an ffmpeg expression in `t`, so any
  number of keyframes works without generating intermediate clips. `ease` is `linear` or
  `smooth` (smoothstep). Opacity is constant-only and says so loudly if you animate it —
  `colorchannelmixer` has no `t` variable and `geq` would recompute every pixel of every frame.
- **`audio.eq`** — parametric EQ with bands, high/low-pass, noise gate, compressor and optional
  loudnorm. `audio.master` is a fixed chain; this is the control it lacked. Verified: a voiceover
  moved from −20.4 to −16.3 LUFS through the chain.
- **`docs/ROADMAP.md`** — an honest capability audit against what "advanced editing" requires,
  with the remaining gaps ordered by (creative unlock ÷ effort).
- **`edit.beat_cut`** — `audio.beat` detected a beat grid but nothing consumed it, so cutting on
  the beat meant re-deriving the arithmetic by hand. This turns the grid into an explicit clip
  list for `render.timeline`, so every cut lands on an onset (or beat). It decides nothing: same
  grid + same files = same plan. `minClipSeconds` (default 0.25) absorbs slivers that would
  otherwise render as single-frame flashes; `maxClipSeconds` splits a long segment across more
  files. 125 plugins now.
- **An agent skill** at `skills/agentic-video/` — a single top-level entry point for driving the
  whole toolkit: an 8-stage master workflow, a "kitchen sink" chain that uses every major
  capability, five runnable `forge steps` files, and four prompt templates (plan, recover,
  verify, author-Remotion).
- `references/plugin-catalogue.md` and `references/remotion-templates.md` are **generated** from
  the live code by `npm run gen:skill`, so they cannot drift.
- **Ten new Remotion templates** (20 total): `stat-counter`, `quote-card`, `split-screen`,
  `typewriter`, `timeline`, `list-reveal`, `waveform`, `glitch-title`, `testimonial`,
  `product-card`.
- `browser.open`, `browser.act`, `browser.record_flow`, `browser.scroll_capture`
  — Playwright-backed automation: navigate, interact, record a real video of a
  session, and capture scroll stills. Playwright replaces the previous ad-hoc
  headless-Chrome bridge; recording requires full Chromium (not Headless Shell),
  so `browser.record_flow` launches headed.
- `render.timeline` accepts still images: a `.png`/`.jpg`/`.webp` clip is held
  for a default 3 s (`-loop 1`) instead of producing a 262-byte clip with no
  video stream.

### Fixed

- **`export.contact_sheet` produced a grid of the same frame.** The filter was
  `fps=1/${round(100 / (cols*rows)) / 100}` — that computes a *rate* (0.06) and feeds it where an
  *interval* is expected, i.e. `fps=1/0.06` = 16.7 fps. `tile=` then took the first `cols*rows`
  frames, all from the opening second, so a 13-second video produced 16 identical tiles. The
  interval is now `duration / tiles`, so the sheet spans the whole timeline.
- Two different failure codes for the same condition: `image.generate` and `video.generate`
  reported `API_KEY_MISSING` while the download plugins reported `MISSING_API_KEY`. Both are now
  `MISSING_API_KEY` — an agent can match on one code.
- `AGENTS.md` still said "87 plugins"; it is 124.
- **`motion.remotion` claimed "the full Remotion API" but supported exactly one package.** Only
  `remotion` and `react` were resolvable: `@remotion/bundler` aliases those two explicitly and sets
  no `resolve.modules`, so every other import is resolved by walking up from the entry point — and
  the bundle was built under `%TEMP%`, which has no `node_modules` above it. A composition
  importing `@remotion/transitions` failed to bundle *with the package installed*. The bundle now
  builds under the project root, and seven companion packages are installed.
- **`staticFile()` could not resolve anything.** `publicDir` was created and never populated, so no
  composition could use a local image, video, audio file or font. New `assets` input copies media
  in.
- **Compositions were limited to a single file.** New `files` input writes extra modules, so a
  composition can be split up.
- **`render.timeline`'s `audioVolume` input was declared but never used.** The schema accepted it,
  the docs described it, and it did nothing. It now applies to an external audio bed in both
  render paths.
- **An external audio bed could be silently ignored.** The non-transition path gave no `-map`, so
  ffmpeg was free to keep the clips' own audio instead of the bed that was asked for.
- Skill docs referenced inputs that do not exist (`music.generate` `bars`,
  `image.download` `orientation`, `browser.scroll_capture` `out`, `subtitle.burn` `video`,
  `export.probe` `file`, `render.timeline` top-level `transition`). All found by running the five
  pipelines end to end and corrected.


### Changed

- Recoverable input errors now report `INVALID_INPUT` with `retryable: true`
  instead of `PLUGIN_ERROR` / `retry: no`. Affected: `audio.fade`,
  `image.crop`, `image.filter`, `image.resize`, `video.fade`. The runner adds
  `Run: forge describe <id>` as the hint automatically.
- Renamed `fx.speedRamp` → `fx.speed_ramp` and `fx.chromaKey` → `fx.chroma_key`
  so every plugin id is snake_case.
- The README plugin-category table is now **generated** by `npm run gen:index`
  between `<!-- BEGIN/END GENERATED: categories -->` markers. It had drifted to
  21 rows against 16 real categories.
- Project renamed **VideoForge → Agentic Video** (package `agentic-video`).

### Fixed

- `video.download` returned zero results from Wikimedia Commons: most Commons
  video is `.ogv` served as `application/ogg`, which the old
  `mime.startsWith('video/')` filter dropped. Detection is now MIME **or**
  extension based. (`gsrnamespace=6` is also required or imageinfo comes back
  empty.)
- `render.timeline` failed with "matches no streams" when any input was a still:
  every xfade offset collapsed to `0.000`.
- `export.probe` consumers that expected a flat `streams` array — the plugin has
  always returned nested `video`/`audio` objects. Documented.

## [1.0.0] — 2026-09-12

### Added

- Plugin-based video toolkit: 124 plugins across 20 namespaces, one file per
  plugin, discovered by walking `plugins/**` (no registration step).
- Four transports for the same plugin set: CLI (`bin/forge.ts`), HTTP API
  (`api/server.ts`, port 8787), MCP stdio server (`mcp/server.ts`) and batch
  step files (`examples/*.json`).
- TypeScript plugin engine (tsx) and a Python bridge (`python/run_plugin.py`)
  with a `MANIFEST` + `run(payload, ctx)` contract.
- Explicit failure contract: `PluginFailure` with `code`, `message`, `reason`,
  `input`, `hint`, `retryable`. Batch runners stop at the first failure.
- Contract check (`npm test` = `tsc --noEmit` + `scripts/check-plugins.ts`)
  enforcing id↔path, snake_case ids, full documentation, input descriptions and
  enum defaults.
- Generated `plugins/INDEX.md` catalogue.
- Vendored MIT Voicebox TTS backend (7 engines) under `vendor/voicebox/`.

[Unreleased]: https://github.com/itsPremkumar/agentic-video/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/itsPremkumar/agentic-video/releases/tag/v1.0.0
