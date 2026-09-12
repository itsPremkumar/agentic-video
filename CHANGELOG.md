# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
