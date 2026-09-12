# Agentic Video

A **passive** video toolkit. It has 130 plugins and **no orchestrator** — it never decides,
  
retries or substitutes. You are the intelligence. It is the hands.

That is the whole deal. Everything below follows from it.

---

## The three rules

1. **Describe before you promise.** `forge describe <id>` prints exact inputs, defaults and
     
   enum values. Guessing an input name is the single most common failure.
2. **One plugin at a time, read the result, pass the path forward.** Never batch and hope.
3. **A failure is information, not a setback.** Read `code` and `retryable`:
   - `retryable: true` → fix the input and re-run that one step.
   - `retryable: false` → re-running cannot help; fix the environment (key, binary, file).

**Never substitute a different plugin to make a failure go away.** That is the one thing this
  
toolkit exists to prevent.

---

## Setup check (do this first)

```bash
cd <path-to>/agentic-video
npm run forge list              # must print 130 plugins
ffmpeg -version                 # required for almost everything
cp .env.example .env            # add PEXELS_API_KEY — see references/providers.md
npx playwright install chromium # only if you use browser.* plugins
```

If `forge list` fails, do not proceed — fix the install.

---

## The master workflow

Eight stages. Each is one or more plugins. Run them in order, passing each output path to the
  
next stage. Skip stages you do not need; do not reorder them.

| # | Stage                    | Plugins                                                               |
| - | ------------------------ | --------------------------------------------------------------------- |
| 0 | Plan                     | `forge list`, `forge describe`                                        |
| 1 | Acquire stock media      | `image.download`, `video.download`, `music.download`                  |
| 2 | Create media from markup | `image.create` (SVG / HTML+CSS), `image.canvas`                       |
| 3 | Capture the web          | `browser.screenshot`, `browser.scroll_capture`, `browser.record_flow` |
| 4 | Motion graphics          | `motion.remotion_template`, `motion.remotion`, `motion.canvas`        |
| 5 | Still → motion           | `motion.effect`, `video.from_images`, `render.slideshow`              |
| 5b | Animate a clip           | `video.transform` (keyframed scale / position / rotation)             |
| 6 | Voice, music, subtitles  | `voice.tts`, `music.generate`, `subtitle.create`, `subtitle.burn`     |
| 6a | Multi-speaker dialogue   | `voice.dialogue` (one voice per speaker, sequenced)                    |
| 6c | Cut by transcript        | `voice.stt` → `edit.transcript_cut` (drop fillers, keep by keyword)    |
| 6b | Beat-sync (optional)     | `audio.beat` → `edit.beat_cut` → hard cuts on the onsets              |
| 7 | Assemble                 | `render.timeline`, `video.merge`, `transitions.xfade`                 |
| 8 | Verify                   | `export.probe`, `qc.gate`, `export.contact_sheet`, `analyze.scopes`   |

### Stage 1 — stock media

`provider` is **required** and is never substituted. No key → `MISSING_API_KEY`, not a silent
  
fallback to another source.

```bash
npm run forge -- run image.download --input provider=pexels --input query="ocean waves" \
  --input count=6 --input prefix=sea
npm run forge -- run video.download --input provider=pexels --input query="aerial coast" \
  --input count=3 --input out=clips.json
```

Read the returned JSON — it lists the downloaded files. Use those paths downstream.

Keyless sources that always work: `openverse` (images), `wikimedia` (images + video).

### Stage 2 — media from markup (no stock, no AI)

This is the one people miss. You can **author** visuals as HTML/CSS or SVG and rasterise them in
  
a real browser — full CSS: gradients, filters, blend modes, web fonts, grid/flex, clip-path.

```bash
node -e "const fs=require('fs');fs.writeFileSync('card.json',JSON.stringify({
  html:'<div class=\"c\"><h1>Ocean Plastic</h1><p>12 million tonnes a year</p></div>',
  css:'.c{width:1080px;height:1920px;background:#06121f;color:#fff;display:flex;flex-direction:column;justify-content:center;padding:120px;font-family:system-ui}h1{font-size:110px;margin:0}p{font-size:44px;color:#38bdf8}',
  width:1080,height:1920,out:'card.png'
}))"
npm run forge -- run image.create --json card.json
```

Always pass markup through `--json file.json`. `--input k=v` cannot survive quotes and commas.

### Stage 3 — capture a website

```bash
npm run forge -- run browser.screenshot --input url=https://example.com --input fullPage=true
npm run forge -- run browser.scroll_capture --input url=https://example.com --input steps=6
npm run forge -- run browser.record_flow --input url=https://example.com \
  --json actions.json        # array of {action, ...}
```

`browser.record_flow` launches **headed** on purpose — Chrome Headless Shell cannot record video.
  
On a headless server, run it under `xvfb-run`.

### Stage 4 — Remotion motion graphics

**20 ready-made compositions**, from lower-thirds to product cards. Real React + spring
  
animations, not ffmpeg filters.

```bash
npm run forge -- run motion.remotion_template --input template=stat-counter \
  --input label="Videos rendered" --input value=128 --input suffix=k \
  --input durationInFrames=75 --input out=stat.mp4
```

See [references/remotion-templates.md](references/remotion-templates.md) for all 20 and their
  
props. For something bespoke, `motion.remotion` takes your own TSX.

Rendering is slow the first time (~25 s cold bundle, then ~20 s each). That is normal, not a
  
failure — do not switch to a different plugin to "save time".

### Stage 5 — stills into motion

```bash
# one image, with a Ken Burns move
npm run forge -- run motion.effect --input file=card.png --input effect=kenBurns \
  --input duration=5 --input zoomTo=1.15 --input width=1080 --input height=1920

# many images
npm run forge -- run video.from_images --json from-images.json   # {files:[...]}
```

`render.timeline` accepts stills too — it holds each for 3 s by default.

### Stage 6 — voice, music, subtitles

```bash
npm run forge -- run voice.tts   --input text="..." --input voice=en-US-AriaNeural
npm run forge -- run music.generate --input key=A --input bpm=90 --input duration=24 --input mood=hopeful
npm run forge -- run subtitle.create --json subs.json            # cues must be an array

# Beat-synced cutting: audio.beat writes a grid, edit.beat_cut turns it into a
# clip list, render.timeline renders it. Cuts land exactly on the onsets.
npm run forge -- run audio.beat     --input file=bed.wav --input out=beats.json
npm run forge -- run edit.beat_cut  --json cut.json   # {files:[...], beats:"beats.json"}
npm run forge -- run render.timeline --json clips.json
npm run forge -- run subtitle.burn --input video=reel.mp4 --input subtitles=subs.srt
```

`music.generate` takes a **note name**, not a key signature: `A`, not `Am`. That trips people.

### Stage 7 — assemble

```bash
npm run forge -- run render.timeline --json timeline.json   # {clips:[{src,duration,transition}]}
npm run forge -- run video.merge --json merge.json          # {sources:[...]} — plain concat
```

### Stage 8 — verify, always

```bash
npm run forge -- run export.probe --input src=final.mp4
npm run forge -- run qc.gate --input file=final.mp4
npm run forge -- run export.contact_sheet --input file=final.mp4 --input cols=4 --input rows=4
```

`export.probe` returns **nested** `{video:{codec,width,height,fps}, audio:{codec}}` — not a
  
`streams` array.

---


## The kitchen-sink recipe

One video that uses every major capability in order. This is the reference workflow — adapt it
  
rather than starting from scratch.

```
1. image.download        Pexels, 4 landscape stills          → stock shots
2. video.download        Pexels, 2 clips                     → stock motion
3. image.create          HTML+CSS title card                 → authored graphic
4. browser.screenshot    capture a product page              → web capture
5. motion.remotion_template  stat-counter + lower-third      → motion graphics
6. motion.effect         Ken Burns on the stills             → stills → motion
7. voice.tts             narration                           → voice
8. music.generate        background bed                      → music
9. audio.merge / audio.duck   bed under narration            → mix
10. subtitle.create + subtitle.burn                          → captions
11. render.timeline      all clips, xfade between            → assembly
12. export.probe + qc.gate                                   → verify
```

A runnable version is in [workflows/kitchen-sink.json](workflows/kitchen-sink.json).

---

## Choosing a plugin

| I need…                             | Use                                                      | Not                                         |
| ----------------------------------- | -------------------------------------------------------- | ------------------------------------------- |
| A photo                             | `image.download`                                         | `image.generate` (costs money, needs a key) |
| Footage                             | `video.download`                                         | —                                           |
| A graphic I can describe in HTML    | `image.create`                                           | —                                           |
| Procedural / data-driven art        | `image.canvas`                                           | `image.create`                              |
| A picture from a prompt             | `image.generate`                                         | —                                           |
| A website as an image               | `browser.screenshot`                                     | —                                           |
| A website as a video                | `browser.record_flow`                                    | —                                           |
| Animated text / lower-third / chart | `motion.remotion_template`                               | `video.text`                                |
| Cuts that land on the music         | `audio.beat` → `edit.beat_cut`                            | cutting by eye                              |
| Bespoke motion graphics             | `motion.remotion` (your TSX)                             | —                                           |
| Move a still                        | `motion.effect`                                          | `video.from_images` (that's for many)       |
| Move/zoom/rotate a CLIP over time   | `video.transform` (keyframes)                            | `motion.effect` (stills only)               |
| Shape a voiceover                   | `audio.eq` (bands + gate + compressor)                   | `audio.master` (fixed chain)                |
| Several people talking in one track | `voice.dialogue` (per-speaker voices)                    | `audio.merge` (mixes simultaneously)        |
| Many stills → video                 | `video.from_images` / `render.slideshow`                 | —                                           |
| Join clips                          | `video.merge` (concat) / `render.timeline` (transitions) | —                                           |
| Cut a clip                          | `video.trim`                                             | —                                           |
| Check a file                        | `export.probe`                                           | —                                           |
| Measure a picture before grading    | `analyze.scopes` (waveform/vectorscope/histogram)         | grading by eye                              |
| Cut by what was said                | `voice.stt` → `edit.transcript_cut`                      | scrubbing manually                          |

Full list: [references/plugin-catalogue.md](references/plugin-catalogue.md).

---

## Failure handling

Every failure returns `{code, message, reason, input, detail, retryable, hint}`.

| Code                   | Means                          | Do this                                          |
| ---------------------- | ------------------------------ | ------------------------------------------------ |
| `INVALID_INPUT`        | your input is wrong            | read `hint`, fix, re-run the same step           |
| `MISSING_API_KEY`      | provider key absent            | add to `.env`, re-run                            |
| `MISSING_BINARY`       | ffmpeg/ffprobe not on PATH     | install it, re-run                               |
| `MISSING_DEPENDENCY`   | python/Chromium missing        | install, re-run                                  |
| `CLIP_UNREADABLE`      | source has no decodable stream | replace that file                                |
| `NO_RESULTS`           | stock query found nothing      | reword the query or change provider              |
| `VOICEBOX_UNREACHABLE` | local TTS not running          | run `voice.voicebox_server --input action=start` |

When `INVALID_INPUT` comes back, the `hint` usually tells you to run
  
`forge describe <id>` — **do it**, it prints the accepted values.

More: [references/failure-codes.md](references/failure-codes.md).

---


## Gotchas that cost real time

Every one of these was hit by actually running the pipeline, not by reading the code.

### Input naming is inconsistent — always `forge describe` first

- **`export.probe` takes `src`. `qc.gate` takes `file`.** Same idea, different name. These two are
  the ones people get wrong most.
- **`subtitle.burn` takes `src`**, not `video`.
- **`image.download` / `video.download` take no `orientation`** — just `query`, `provider`,
  `count`, `prefix`.
- **`browser.scroll_capture` takes no `out`** — it writes into its artifact dir and returns the
  stills.
- **`image.grade` has no `look`** — it is `brightness` / `contrast` / `saturation` / `gamma`.
  For named looks use `effects.look` or `effects.genre`.

### Arguments and shapes

- **Arrays and objects need `--json file.json`.** `--input k=v` mangles them, and the schema
  rejects a JSON *string* where it wants an array. Quotes in HTML/SVG break `--input` outright.
- **Transitions are per-clip, not per-timeline.** `render.timeline` takes
  `{src, transition, transitionDuration}` on each clip *after* the first; there is no top-level
  `transition`. And `transitions.xfade` joins exactly **two** clips (`first` + `second`) — for N
  clips use `render.timeline`.
- **`music.generate` wants `key: "A"`**, not `"Am"`. Its length input is **`duration` in seconds**
  (plus `mood: calm|hopeful|tense`) — there is no `bars` input.

### Outputs

- **`export.probe` is nested** — `{video:{codec,width,height,fps}, audio:{codec}}`, not a
  `streams` array.
- **Some plugins return non-media files alongside the media.** `browser.scroll_capture` emits a
  `scroll-manifest.json` next to its PNGs. Hand the whole output list to the next plugin and it
  will try to decode that JSON as an image. **Filter by extension** before passing a list forward.
- **`export.contact_sheet` spans the whole video** — its frame interval is derived from the real
  duration. If every tile looks identical, suspect the sheet, not the video.

### Timing

- **Transitions consume clip duration.** N clips totalling S seconds with transition T come out at
  `S − (N−1)·T`. Six 2-second clips with 0.5 s transitions is 9.5 s, not 12 s.
- **`video.from_images` uses a fixed ~0.5 s transition** with no input to change it. With 0.75 s
  clips that eats most of every shot — a 6 s slideshow came out at 2.6 s. For fast cutting use
  `transition: "none"` (hard cuts), or make each image longer.
- **Remotion's first render is slow** (~25 s bundling, then ~20 s each). Budget for it.

### Other

- **Absolute output paths** — plugins resolve a relative `out` inside their own artifact
  directory. Pass a full path to control where the file lands, and read the printed path rather
  than assuming.
- **`video.download` from Wikimedia** returns `.ogv` files. That is correct, not a bug.
- **`browser.act` executes JavaScript you supply.** Only point it at URLs you trust.

---

## References

- [references/plugin-catalogue.md](references/plugin-catalogue.md) — all 130 plugins by category *(generated)*
- [references/remotion-templates.md](references/remotion-templates.md) — all 20 templates + props *(generated)*
- [references/providers.md](references/providers.md) — stock / AI / TTS sources and keys
- [references/failure-codes.md](references/failure-codes.md) — every code and what to do
- [references/recipes.md](references/recipes.md) — copy-paste end-to-end recipes
- [workflows/](workflows/) — runnable `forge steps` files
- [prompts/](prompts/) — prompt templates for driving this from an LLM

## Regenerating

```bash
npm run gen:skill     # rebuilds the two generated references from the live code
```
