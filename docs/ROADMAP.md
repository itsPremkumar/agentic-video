# Capability audit & roadmap

An honest assessment of Agentic Video as an *editing* tool, measured against what
"advanced video editing" actually requires. Written 2026-09-12 against 126 plugins.

## Verdict

**Strong at assembly. Weak at editing.**

The toolkit is excellent at *getting media in, processing it, and putting it together*: stock
download, generation, colour looks, audio mastering, subtitles, transitions, delivery variants.
That is genuinely most of a production pipeline.

What it could not do until now was **change a clip over time**. That single missing verb —
animating a transform — is what separates "assembling assets" from "editing". Most of the
remaining gaps are downstream of it or are professional-workflow concerns rather than creative
ones.

---

## What is genuinely strong

| Area | Why it holds up |
|---|---|
| **Failure contract** | Every plugin declares `code` / `retryable` / `hint`. Nothing silently substitutes. This is rarer than it sounds and it is the reason an agent can drive this reliably. |
| **Contract check** | `npm test` validates all 126 manifests — id↔path, snake_case, documentation, input descriptions, enum defaults. Cheap, fast, catches real drift. |
| **Generated docs** | `plugins/INDEX.md`, the README category table and the skill references are all generated. CI fails on drift. No hand-maintained catalogue to rot. |
| **Media acquisition** | 4 stock providers + AI generation + authored HTML/SVG/Canvas + live browser capture. Wider than most commercial tools. |
| **Audio** | `audio.master` (denoise → highpass → compressor → EBU R128), ducking, beat detection, LUFS per platform. Better than most NLEs out of the box. |
| **Motion graphics** | 20 Remotion templates with real React/spring animation, plus `motion.remotion` for bespoke TSX. |
| **Verification** | `export.probe`, `qc.gate`, `export.contact_sheet`. Most pipelines have no QC at all. |

---

## What is missing

### Tier 1 — blocks real editing

| Gap | Why it matters | Status |
|---|---|---|
| **Keyframed transform** | No way to move/scale/rotate a clip over time. Blocks animated PiP, push-ins on footage, sliding titles, dynamic crops. | **Fixed** — `video.transform` |
| **Animated opacity** | `video.transform` takes a constant opacity only: ffmpeg's `colorchannelmixer` has no `t` variable, and the alternative (`geq`) recomputes every pixel of every frame. Fades work via `video.fade`. | Open |
| **Per-clip properties in the timeline** | `render.timeline` clips take `{src, duration, transition}` — no transform, no volume, no speed. You cannot mix a quiet clip under a loud one, or speed one shot without pre-rendering it. | Open |
| **Audio EQ / de-esser / gate / pitch** | `audio.master` is a fixed chain. There is no parametric EQ, no multiband compression, no noise gate, no independent pitch shift. | Open |
| **Masking / rotoscoping** | `image.remove_bg` removes a background; there is no mask shape, no feathered matte, no animated matte, no tracking. | Open |

### Tier 2 — professional workflow

| Gap | Why it matters |
|---|---|
| **Proxy / optimised media** | Nothing generates proxies. Cutting 4K without them is painful. |
| **Shot matching** | No way to match colour across shots — the single most visible mark of amateur editing. |
| **Scopes** | No waveform, vectorscope or histogram. You cannot grade responsibly without them; `image.aesthetic` scores an image but does not measure it. |
| **Optical-flow retiming** | `video.speed` does frame duplication/dropping. No `minterpolate`, so no true slow motion. |
| **Round-trip interchange** | No EDL, FCPXML, XML or AAF export. An edit made here cannot be opened in Resolve or Premiere. |
| **Project state** | A "project" is a step list. There is no document you can reopen, tweak and re-render incrementally. |
| **Render cache** | Every re-run recomputes every step. No intermediate cache, no render queue, no resume. |

### Tier 3 — delivery & scale

| Gap | Why it matters |
|---|---|
| **Platform encode presets** | `export.derivative` does aspect ratios and a thumbnail, but not per-platform bitrate/codec/loudness specs (YouTube 4K vs TikTok vs Reels). |
| **Streaming packages** | No HLS/DASH segmenting. |
| **Chapter markers / metadata** | No chapters, no container metadata writing. |
| **Speaker diarisation** | `voice.stt` transcribes; it does not separate speakers, so multi-speaker captions need manual work. |
| **Upscaling** | No super-resolution. `export.reframe` mentions scaling but is not an upscaler. |

---

## Roadmap, in the order I would build it

Ordered by (creative unlock ÷ effort), not by how impressive it sounds.

### 1. Per-clip properties in `render.timeline`
The highest-leverage change in the codebase. Add to each clip:

```
{ src, start, duration, transition, transitionDuration,
  transform: { scale, x, y, rotation },   // static, per clip
  volume: 0.6,                            // per-clip audio level
  speed: 1.5 }                            // per-clip retime
```

Everything needed already exists — `video.transform` proved the filter chain, `audio.volume` and
`video.speed` exist as separate plugins. This is composition, not new capability. It turns the
timeline from a concat into an actual edit.

### 2. `audio.eq` — parametric EQ + gate + de-esser
Straightforward ffmpeg chain (`equalizer`, `agate`, `acompressor`, `highpass`/`lowpass`), filling
the largest single audio gap. Low risk, immediate benefit to anything with a voiceover.

### 3. `video.retime` — optical-flow speed changes
`minterpolate` for genuine slow motion. Retires the frame-duplication limitation in `video.speed`.

### 4. `analyze.scopes` — waveform, vectorscope, histogram
Cheap to build (ffmpeg has the filters), and it is what makes grading defensible rather than
guesswork. Pairs with the existing `effects.*` grade plugins.

### 5. `video.mask` — static and animated mattes
Shape masks with feather, driven by the same keyframe expression builder `video.transform` uses.
This is the last big creative unlock.

### 6. `edit.match` — shot matching
Sample a reference frame from two clips, compute a correction, apply it. Uses existing analysis
and grading plugins; the new part is the measurement and the transfer.

### 7. Proxies + render cache
Both are infrastructure, not plugins. Highest value once the edit surface is real, because they
are what make working on long timelines bearable.

### 8. Interchange + project state
Only worth doing once the edit surface is stable enough that exporting it means something.

---

## Voice: the engine is complete, the control surface is not

Worth stating precisely, because it is easy to misread.

**The vendored Voicebox is complete.** `vendor/voicebox/speech/` is byte-identical to the
reference integration in Automated Video Generator — same 99 files, same 18,341 lines of Python,
**identical SHA-256 tree hash**. Eight TTS backends, database, MCP server, the lot. Nothing was
trimmed.

**But only ~7 of its ~60 endpoints are exposed as plugins:**

| Voicebox area | Endpoints | Exposed |
|---|---:|---|
| `profiles`, `speak`, `models`, `health`, `history` | ~20 | ✅ `voice.voicebox_*` (7 plugins) |
| **`stories`** — multi-track voice timeline | 14 | ❌ |
| **`effects`** — 11 voice effects + presets + preview | 7 | ❌ |
| **`channels`** — per-profile channels and voices | 5 | ❌ |
| **`transcription`** — `/transcribe` | 1 | ❌ |
| `captures` — voice-capture readiness | 6 | ❌ |
| `llm`, `settings`, `tasks`, `export/import`, `versions` | ~10 | ❌ |

The two that matter most are exactly the ones people ask for:

- **`stories` is the multi-speaker engine.** `StoryItemDetail` carries `start_time_ms` and
  `track`, with per-item `volume`, `trim`, `split`, `move`, `reorder` and `version` — a real
  multi-track audio timeline. No plugin exposes it.
- **`effects` is the voice-editing engine.** `utils/effects.py` defines `pitch_shift`,
  `deep_voice`, `robotic`, `radio`, `reverb`, `chorus`, `delay`, `echo_chamber`, `compressor`,
  `highpass`, `lowpass`, each with parameters (semitones, room_size, feedback, …). No plugin
  exposes it.

### What was added instead

`voice.dialogue` — multi-speaker dialogue, built on the *existing* speech plugins rather than the
unexposed API, so it works today with Edge-TTS (no 2–3 GB setup) and with Voicebox profiles when
the backend is running. Verified: 4 lines across 3 voices, correctly sequenced with 5 silence
gaps rather than mixed together.

### `render.timeline` per-clip properties

Clips now carry `transform` (`scale`, `x`, `y`, `rotation`, `background`), `speed` and `volume`.
Every normalised clip gets an audio track — silence when the source has none — so mixed stills and
clips concatenate without the caller thinking about it.

The audio chain mirrors the video chain: a cut concatenates, a transition `acrossfade`s by the
same duration, so the two stay in sync through xfades. Verified: a two-clip fade timeline where
the same source segment appears at `volume` 1.0 and 0.35 measures exactly **−9.1 dB** apart, and
the final file's level matches the intermediate part to the decimal.

Two bugs fixed on the way: `audioVolume` was declared but **never used**, and an external audio bed
could be silently ignored because no `-map` was given.

### Remotion: it was core-only, now it is the real thing

`motion.remotion` claimed "the full Remotion API". It was not true, and the reason was subtle.

**Only `remotion` and `react` were importable.** `@remotion/bundler`'s webpack config sets
explicit aliases for those two and **no `resolve.modules`**, so every other import is resolved by
walking up from the entry point. The bundle was built in `%TEMP%`, which has no `node_modules`
above it — so a package could be installed and still be unreachable. Any composition importing
`@remotion/transitions` failed to bundle.

Two further gaps: `publicDir` was created and **never populated**, so `staticFile()` could not
resolve a single local asset; and the bundle was one file, so a composition could not be split
into modules.

Fixed:
- the bundle now builds under the project root, putting the real `node_modules` in the walk-up path
- seven companion packages installed: `transitions`, `paths`, `shapes`, `noise`, `layout-utils`,
  `animation-utils`, `google-fonts`
- new `assets` input copies local media into `publicDir`, so `staticFile()` works
- new `files` input writes extra modules, so a composition can be more than one file

Verified with an agent-authored composition using **nine packages**: `TransitionSeries` with
`fade`/`slide`/`wipe`, `evolvePath` + `getLength` for SVG path drawing, `Star`/`Circle` shapes,
`noise2D` for organic drift, `fitText`, `makeTransform`, a local PNG via `staticFile` + `Img`, a
local WAV via `Audio`, and a `Badge` component imported from a second file. 255 frames,
1080x1080, h264/aac, no black frames.

### The agentic-generation front end: `text.screenplay`

State-of-the-art agentic video starts with *script understanding* — extract scenes, characters,
action and beats, then plan shots. The toolkit had no representation of screenplay at all.

`text.screenplay` parses INT./EXT. slug lines, character cues, parentheticals and transitions into
scenes, shot-sized units with conservative camera suggestions, estimated durations, and a cast list
with line counts. It is deterministic parsing, not shot design: it extracts what is on the page and
leaves the covering decisions to the caller.

Verified on a real three-scene screenplay: 3 scenes, 10 shots (5 action / 5 dialogue), cast of 3 with
correct line counts, and camera sizes that match the text — "wide shot of the lab" → wide,
"aerial view" → wide, "CLOSE ON:" → close, and a `(quietly)` parenthetical → close.

The output is what feeds the rest: shots become footage to find or generate, and `cast` maps
straight onto `voice.dialogue` speakers.

### Consistency checking: `analyze.continuity`

The SOTA pipelines run a *consistency check* across shots. Nothing here could compare shots to each
other, so an assembled cut could not be judged. This reports the luma, contrast, saturation and
colour-balance delta at every cut, with thresholds, and names the direction of the mismatch so you
know which way to correct.

Verified: on a three-shot sequence it found a real jump of +23.3 luma between shots 1 and 2, over a
22 threshold, with the direction reported as "brighter".

### Offline/online: `video.proxy` + `edit.conform`

The assistant-editor role existed nowhere in the toolkit. Now:

`video.proxy` walks a file or a folder and writes low-resolution stand-ins plus a manifest.
**Duration and frame rate are preserved exactly** — that is what makes the swap valid, because
every timecode in an edit made against a proxy still means the same thing against the original.

`edit.conform` reads that manifest and rewrites a timeline so `render.timeline` reads the
originals instead. It refuses rather than warns when a proxy's duration has drifted: a proxy that
does not match its original makes every cut point after it wrong, and silently moving them is
exactly the class of failure this project exists to avoid.

Verified end to end: three clips at 1080x1080 → proxies at 540x540 (21/16/30% of the original
size, durations identical to 3 decimals) → an edit with tight trims against the proxies → conform
→ render at **1080x1080 from the originals**, 3.70s, matching `1.2 + 1.5 + 1.8 − 2×0.4`. A
tampered manifest with a 0.4s drift is correctly refused.

### The next step, when Voicebox is installed

`voice.voicebox_stories` and `voice.voicebox_effects` are thin wrappers over endpoints that
already exist in the vendored code. They are not written yet because `npm run setup:voicebox`
(~2–3 GB) has not been run, and shipping wrappers that cannot be executed end to end would be
guesswork — which is how the six wrong input names in the skill docs got there in the first place.

---

## What a professional post team actually does

Researched against published post-production workflows and the current landscape of agentic
editing tools. The industry pipeline is well defined, and mapping it against this toolkit is the
honest way to see what "replace a post team" would require.

### The roles, and where this toolkit stands

| Role | What they actually do | Covered? |
|---|---|---|
| **Assistant editor** | Ingest, organise bins, sync double-system audio, generate proxies, back up | 🟡 **proxies + conform now**; still no ingest, no double-system sync |
| **Editor** | Assembly → rough → fine cut; pacing; picture lock | 🟡 `render.timeline`, `edit.beat_cut`, `edit.transcript_cut`, `video.trim` — but no versions, no lock, no multicam |
| **Sound editor** | Dialogue edit, ADR flags, ambience, Foley, SFX, mix, **stem export** | 🟡 strong on processing (`audio.master`, `audio.eq`, `audio.duck`); **no stems export**, no Foley/ambience |
| **Colourist** | Conform from EDL/XML, primary (shot matching, exposure, white balance), creative grade, **secondary corrections** | 🟡 grades exist; **scopes now added**; still no shot matching, no secondaries, no conform |
| **VFX artist** | Keying, tracking, roto, screen replacement, cleanup | 🔴 `fx.chroma_key` and `image.remove_bg` only; no tracking, no masks, no video background removal |
| **Motion designer** | Titles, lower thirds, infographics, animation | ✅ 20 Remotion templates + `motion.remotion`, `video.transform` |
| **Subtitler** | Captions, translation, dubbing, sync | 🟡 `subtitle.*` is solid; no translation, no dubbing, no auto-sync |
| **QC / technical** | Format specs, legal levels, loudness, black-frame and dropout checks | 🟡 `qc.gate`, `export.probe`, `analyze.scopes`; no dropout detection, no slating |
| **Delivery** | Platform variants, DCP/ProRes, stems, captions sidecar, metadata | 🟡 `export.derivative` does aspects + thumbnails; no encode presets, no stems, no DCP |

### The stages nobody builds for, and this toolkit is missing

1. **Ingestion & organisation** — proxy generation, double-system audio sync, media inventory with
   checksums. Without proxies, editing 4K is painful; without sync, footage with separate audio
   cannot be used at all.
2. **Offline/online split** — edit on proxies, conform to camera originals at full resolution for
   the grade. This is a *concept* the toolkit has no representation of.
3. **Picture lock as state** — a declared, dated version that downstream stages work from. Right
   now every run is stateless; there is no notion of "this is the approved cut".
4. **Stems** — dialogue / music / effects delivered separately. A broadcast or distributor
   requirement, and the thing that makes re-versioning (dubs, different edits) possible.
5. **Handoff documents** — EDL/XML/AAF for conform, a VFX shot list with in/out frames, a delivery
   spec sheet. These are what let a *team* work in parallel. An agent pipeline needs the same
   artefacts to be re-enterable and reviewable.

### What the agentic-editing landscape treats as table stakes

From surveying current AI-editing tools and MCP servers, the capabilities an agent is expected to
have: transcript-based cutting, semantic footage search, silence removal, multicam, auto-reframe,
auto-captions, dubbing/translation, upscaling, frame interpolation, stabilisation, background
removal, and NLE round-trip (Resolve/Premiere via MCP or XML).

Of those, this toolkit now has: transcript cutting ✅, silence removal ✅, auto-reframe ✅,
auto-captions ✅, stabilisation ✅, reframing ✅.
Still missing: **semantic footage search**, **multicam**, **dubbing/translation**, **upscaling**,
**frame interpolation**, **video background removal**, **NLE round-trip**.

---

## Revised build order

Superseding the earlier list, now ordered against the role table above.

| # | Build | Role it serves | Why now |
|---|---|---|---|
| ~~1~~ | ~~**Per-clip properties in `render.timeline`** (`transform`, `volume`, `speed`)~~ | Editor | **Done.** Turns a concat into an edit. |
| ~~2~~ | ~~**`video.proxy` + `edit.conform`**~~ | Assistant editor | **Done.** The offline/online split now exists. |
| 3 | **`analyze.search`** — search transcripts and footage by meaning | Editor | The second half of transcript-driven editing: find the shot, not just cut it. |
| 4 | **`delivery.stems`** | Sound editor | Broadcast/distribution requirement. Cheap: the pipeline already knows which file is voice and which is music. |
| 5 | **`export.platform`** — encode presets per platform + broadcast legalisation | Delivery | Table stakes; `export.derivative` only does aspect ratios. |
| 6 | **`video.retime`** — optical-flow interpolation | Editor | Real slow motion, and it retires the frame-duplication limitation. |
| 7 | **`video.multicam`** — sync angles, switch between them | Editor | The one editor feature with no partial coverage at all. |
| 8 | **`video.mask` + `analyze.track`** | VFX | Masks are the last big creative unlock; tracking makes them usable on moving shots. |
| 9 | **`edit.match`** — shot matching | Colourist | The most visible difference between amateur and professional cutting. |
| 10 | **`subtitle.translate` + `voice.dub`** | Subtitler | Localisation. Pairs with the existing TTS stack. |
| 11 | **Project state + render cache** | All | Makes long timelines workable and re-runs incremental. |
| 12 | **EDL / FCPXML export** | All | Only meaningful once the edit surface is stable. |

## What I would *not* build

- **An orchestrator.** The whole point is that the caller decides. AVG's ADR 001 chose the
  opposite and that is a legitimate product, but it is a different one.
- **A GUI.** The consumers are agents and scripts. A GUI would double the surface area and serve
  neither.
- **More stock providers.** Four is already more than the alternatives offer. Depth in editing
  beats breadth in acquisition at this point.
