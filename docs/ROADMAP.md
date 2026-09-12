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

## What I would *not* build

- **An orchestrator.** The whole point is that the caller decides. AVG's ADR 001 chose the
  opposite and that is a legitimate product, but it is a different one.
- **A GUI.** The consumers are agents and scripts. A GUI would double the surface area and serve
  neither.
- **More stock providers.** Four is already more than the alternatives offer. Depth in editing
  beats breadth in acquisition at this point.
