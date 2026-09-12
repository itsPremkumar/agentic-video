# AGENTS.md — operating Agentic Video from an external AI agent

Agentic Video is a passive tool. **You** (the agent) decide what to do. The
  
project never decides, retries, or substitutes on your behalf. Everything
  
below assumes you want a working video at the end and you want to do it
  
honestly.


## Ground rules

1. **Discover before you promise.**
   ```
   forge list              # 125 plugins, no orchestration
   forge describe <id>     # exact inputs, defaults, enum, what each field means
   ```
   Read `forge describe` before you commit to a plugin. The defaults are
     
   sensible but you may need to override them.
2. **<u>Run one step at a time.</u>**<u> Use `forge run <id> --input k=v ...` and
     
   read the ack. Every success prints the output path; every failure prints
     
   what to fix. Never batch and hope.</u>
3. **If a step fails, fix that step. Do not substitute.**
     
   The contract is explicit: there is no hidden fallback. If `music.generate`
     
   fails on `key: "Am"`, fix it to `"A"` and re-run that one step. If
     
   `video.generate` fails on `FAL_KEY`, add the key to `.env` and re-run.
     
   Do not "save time" by switching to a different plugin and pretending the
     
   original succeeded.
4. **Pass outputs forward.** When step N produces a file, pass its path to
     
   step N+1. Build the chain in memory as you go; don't try to plan it all
     
   up front.
5. **Stop on the first failure when using `forge steps`.** The batch runner
     
   halts immediately at the first FAILED step and reports which steps were
     
   NOT executed. If you want to continue past a failure, run the remaining
     
   steps explicitly yourself.
6. **Verify after you render.** Use `export.probe` to confirm duration,
     
   resolution, codec, audio, and zero black frames. Visually inspect a few
     
   frames (`export.contact_sheet` is cheap and helpful).


## Plugin selection cheatsheet

| Goal                             | First choice                                                                          | Why                                 |
| -------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------- |
| Get stock images by keyword      | `image.download` (pexels / pixabay / openverse / wikimedia)                           | pexels+pixabay need keys, others free |
| Edit an image                    | `image.resize` / `image.grade` / `image.filter`                                       | ffmpeg-native, fast                 |
| Create a static image            | `image.create` (SVG/HTML)                                                             | no key, full CSS/SVG                |
| Create an image programmatically | `image.canvas` (Canvas 2D)                                                            | no key, JS drawing                  |
| Generate an image with AI        | `image.generate` (fal/replicate)                                                      | needs key                           |
| Remove image background          | `image.remove_bg` (rembg)                                                             | needs `pip install rembg`           |
| Cluster near-duplicate images    | `image.dedup` (dHash + Hamming)                                                       | zero-dep, fast                      |
| Score image quality (0-5)        | `image.aesthetic` (resolution + aspect + size + bitdepth)                             | no-LLM                              |
| Tag relevance vs script          | `image.relevance` (Jaccard token overlap)                                             | pure set math                       |
| Get a stock video                | `video.download` (pexels / pixabay / wikimedia)                                       | pexels+pixabay need keys            |
| Stills -> video (Ken Burns)      | `video.from_images`                                                                   | local ffmpeg, no key                |
| Video -> stills                  | `video.extract_frames` (interval / count / times)                                     | local ffmpeg, no key                |
| AI motion from one still         | `video.animate` (ComfyUI + AnimateDiff)                                               | needs ComfyUI; fails loudly if absent |
| Edit a video                     | `video.trim` / `crop` / `resize` / `fade` / `grade` / `denoise`                       | standard                            |
| Split a long clip                | `video.scene_split` (equal or marks)                                                  | lossless stream-copy option         |
| Detect scene cuts                | `video.scene_detect` (scene-score threshold + smartAssemble)                          | ffmpeg-native                       |
| Cluster near-dup video frames    | `video.dedup` (dHash sampled at N frames)                                             | zero-dep                            |
| Make a slideshow                 | `render.slideshow` (with `audio`)                                                     | ffmpeg-native                       |
| Assemble + transitions           | `render.timeline` (with `clips` + `transition`)                                       | ffmpeg-native                       |
| Make motion graphics             | `motion.remotion` (TSX) / `motion.remotion_template` (6 reusable templates)           | full React/Remotion capacity        |
| Make animation programmatically  | `motion.canvas` (Canvas 2D draw)                                                      | no key, per-frame capture           |
| Ken Burns / parallax / punch-in  | `motion.effect` (kenBurns / shake / parallax / punchIn / punchOut)                   | zoompan-driven                      |
| Generate a video with AI         | `video.generate` (wan-t2v, kling, luma)                                               | needs `FAL_KEY`                     |
| Stabilise shaky footage          | `fx.stabilize` (vidstab)                                                              | needs ffmpeg + vidstab              |
| Speed ramp / punch in            | `fx.speed_ramp` (constant/accelerate/decelerate/punch)                                 | setpts+tpad                         |
| Green-screen removal             | `fx.chroma_key`                                                                        | PNG alpha sequence output           |
| Cinematic colour grade           | `effects.look` (11 looks) / `fx.vintage` (14 looks) / `effects.color_grade` (5 treatments) / `effects.genre` (14 genre packs) | ffmpeg-native |
| Apply a stylised transition      | `fx.transition_effect` (glitch / lightLeak / whipPan / flash / rgbSplit / zoomBlur)   | segment-split windowing             |
| Side-by-side / N-up compare      | `fx.compare` (hstack+vstack grid)                                                     | deterministic                       |
| Voiceover                        | `voice.tts` (Edge-TTS)                                                                | no key                              |
| Start/stop the Voicebox backend  | `voice.voicebox_server` (start / stop / restart / status)                             | vendored at `vendor/voicebox`       |
| Check Voicebox GPU + health      | `voice.voicebox_health`                                                               | fast probe                          |
| Manage engines / free VRAM       | `voice.voicebox_models` (status / load / unload / cacheDir)                           | unload before switching engines     |
| Re-use a past generation         | `voice.voicebox_history` (list / stats / get / audio)                                 | avoids re-spending GPU time         |
| Clone a voice (realistic)        | `voice.voicebox_clone`                                                                | needs the local Voicebox server     |
| Speak in a cloned voice          | `voice.voicebox_speak`                                                                | most realistic; needs Voicebox      |
| Clone a voice (offline)          | `voice.clone` (Coqui XTTS-v2)                                                         | needs `pip install TTS` + model     |
| Transcribe                       | `voice.stt` (faster-whisper)                                                          | needs `pip install faster-whisper`  |
| Detect BPM / beat grid           | `audio.beat` (astats Peak_level)                                                      | zero-dep                            |
| Detect onsets + intensity        | `audio.onset` (opm -> calm/mid/energetic + target BPM)                                | ffmpeg-native                       |
| Auto-duck music under VO         | `audio.duck` (sidechain or envelope mode)                                             | ffmpeg-native                       |
| Procedural SFX (16 kinds)        | `audio.sfx` (blip / click / whoosh / impact / chime / wind / rain / laser / ...)      | zero-dep                            |
| Master audio for a final render  | `audio.master` (denoise + highpass + compressor + EBU R128 + optional sidechain duck) | ffmpeg-native                       |
| Normalise loudness to LUFS       | `audio.lufs_for_platform` (youtube / tiktok / reels / podcast / broadcast / music / headphones / custom) | two-pass loudnorm |
| Background music                 | `music.generate` (procedural)                                                         | no deps                             |
| Royalty-free music               | `music.download` (Internet Archive)                                                   | no key                              |
| Captions                         | `subtitle.create` then `subtitle.burn`, or `subtitle.karaoke` for words-only timing   | full control                        |
| Syllable-timed captions          | `subtitle.syllable` (165 ms/syllable SRT + 8 caption-style palette)                   | 8 looks: bold-yellow, soft-white, kinetic-pop, editorial, podcast, tiktok-caption, news-lowerthird, karaoke |
| Transitions                      | `transitions.xfade` (30 named)                                                         | ffmpeg-native                       |
| Brand pack                       | `brand.kit` (logo corner + intro card + outro card + letterbox bars)                  | one-pass composition                |
| Parse a script                   | `text.script_parse` (cue blocks -> scenes + keywords)                                  | stopword-filtered                   |
| SEO bundle                       | `text.seo` (title / description / hashtags)                                           | deterministic                       |
| Generate a hook opener           | `text.hook` (7 opener templates, FNV-1a seeded)                                       | deterministic                       |
| Browser screenshot of a URL      | `browser.screenshot`                                                                  | zero-dep CDP                        |
| Open a real website (cookie banner, dark mode) | `browser.open`                                                          | Playwright Chromium                 |
| Drive a site (click/type/scroll) | `browser.act` with action list: `navigate/click/fill/press/hover/select/scroll/wait/evaluate/screenshot` | Playwright auto-waiting, strict-mode locators |
| Record a video walkthrough       | `browser.record_flow`                                                                 | Playwright recordVideo + ffmpeg     |
| Scroll-capture a long page       | `browser.scroll_capture`                                                              | Playwright + Ken Burns feed         |
| Browser screen recording (per-frame) | `browser.record`                                                                  | per-frame scroll+screenshot         |
| Desktop screen recording         | `screen.record`                                                                       | ffmpeg gdigrab/avfoundation/x11grab |
| Multi-aspect distribution        | `export.derivative` (16:9 + 9:16 + 1:1 + thumb)                                       | one-call                            |
| QC an asset                      | `qc.asset` (resolution/aspect/duration/sha256)                                        | per-call                            |
| Detect blank/placeholder frames  | `qc.placeholder_check` (stddev over 64x64 grayscale)                               | per-call                            |
| 7-gate pipeline aggregator       | `qc.gate` (file / video / duration / cap / size / audio / resolution)                | one-shot PASS/FAIL                  |
| Audit a multi-scene render       | `analyze.scene_audit`                                                                         | per-scene + final QC                |
| QC a finished video              | `analyze.video` (black/freeze/clip)                                                   | per-call                            |
| Verify output                    | `export.probe` + `export.contact_sheet`                                               | always before delivery              |
| Edit timeline spec atomically    | `edit.ops` (delete / insert / reorder / update / retime)                              | JSON in, JSON out                   |
| Publish a deliverable            | `delivery.publish` (versioned manifest + LATEST)                                      | sha1 manifest                       |
| Publish a patch revision         | `delivery.revision` (vX.Y -> vX.Y+1, reads LATEST)                                    | auto-increment                      |
| Archive old versions             | `delivery.archive` (moves old version into cold storage)                              | timestamped                         |

## Reference recipes

### Stock-image reel (no AI keys needed)

```jsonc
// examples/ocean-reel.json (abbreviated)
{
  "steps": [
    { "plugin": "image.resize",   "input": { "src": "...", "width": 1080, "height": 1920, "fit": "contain" } },
    { "plugin": "image.grade",    "input": { "src": "...", "brightness": 0.04, "saturation": 1.2 } },
    { "plugin": "voice.tts",      "input": { "text": "..." } },
    { "plugin": "music.generate", "input": { "duration": 14, "key": "A", "mood": "calm" } },
    { "plugin": "audio.merge",    "input": { "sources": ["...voice.mp3", "...bed.wav"], "weights": [1, 0.18] } },
    { "plugin": "render.slideshow","input": { "images": ["..."], "audio": "..." } },
    { "plugin": "export.probe",   "input": { "src": "..." } }
  ]
}
```

```
forge steps examples/ocean-reel.json
```

### AI-generated reel (requires `FAL_KEY`)

```jsonc
{
  "steps": [
    { "plugin": "image.generate", "input": { "prompt": "coral reef, golden hour, hyperreal" } },
    { "plugin": "image.resize",   "input": { "src": "...", "width": 1080, "height": 1920 } },
    { "plugin": "voice.tts",      "input": { "text": "..." } },
    { "plugin": "video.generate", "input": { "prompt": "underwater camera pushing through kelp", "model": "wan-t2v", "aspectRatio": "9:16" } },
    { "plugin": "video.trim",     "input": { "src": "...", "start": 0, "duration": 4 } },
    { "plugin": "render.timeline","input": { "clips": [{ "src": "...image.mp4", "duration": 4 }, { "src": "...", "duration": 4, "transition": "fade" }], "audio": "..." } }
  ]
}
```


### Realistic cloned voice with Voicebox (recommended)

Voicebox (jamiepine/voicebox) is a local FastAPI TTS studio with zero-shot
  
voice cloning and 7 engines. It must be running before you use these plugins
  
(default `http://localhost:17493`).

```jsonc
{
  "steps": [
    { "plugin": "voice.voicebox_health",   "input": {} },
    { "plugin": "voice.voicebox_clone",    "input": {
        "name": "Narrator",
        "refAudio": "path/to/reference.wav",
        "referenceText": "exact transcript of that audio",
        "defaultEngine": "qwen"
    }},
    { "plugin": "voice.voicebox_speak",    "input": {
        "text": "Your narration here.",
        "profile": "Narrator",
        "out": "narration.wav"
    }}
  ]
}
```

`voice.voicebox_clone` returns a `profileId` — pass the profile **name or id**
  
to `voice.voicebox_speak`. 2-3 clean reference samples give noticeably better
  
fidelity than one. If the server is down you get
  
`VOICEBOX_UNREACHABLE` with a start hint; nothing is substituted.

### Dynamic Remotion (full React/TSX motion graphics)

```jsonc
{
  "plugin": "motion.remotion",
  "input": {
    "compositionId": "Title",
    "durationInFrames": 120,
    "fps": 30,
    "width": 720, "height": 1280,
    "composition": "import { AbsoluteFill, useCurrentFrame, spring, interpolate } from 'remotion';\nexport default function Title() { /* ... */ }",
    "props": { "line1": "Ocean", "line2": "Plastic" }
  }
}
```

The caller authors the TSX. The plugin handles bundling, selecting the
  
system Chrome, and rendering to MP4. The full Remotion API is available
  
(`useCurrentFrame`, `useVideoConfig`, `spring`, `interpolate`,
  
`AbsoluteFill`, transitions, shapes, paths, captions, kinetic text).

## Failure handling patterns

### "Step X failed because of Y" -> fix Y, retry step X

```text
Step 8 -> music.generate (Generate background music) -> FAILED  [1127ms]
    reason : Unknown key "AM".
    code   : INVALID_INPUT
    input  : {"key":"AM"}
    hint   : Supported keys: C, D, E, F, G, A, B
    retry  : yes (with corrected input)
```

Fix: pass `key=A`, re-run only that step.

### "Missing dependency" -> tell the user, do not substitute

```text
voice.clone (Clone a voice from a reference audio) -> FAILED  [1895ms]
    reason : voice.clone requires the Coqui TTS Python library ...
    code   : TTS_NOT_INSTALLED
    hint   : Install with: pip install TTS && tts --model_name ...
    retry  : no
```

The plugin does not fall back to `voice.tts`. Tell the user the install
  
command and let them decide.

### "Asset is wrong" -> redo that step, not the whole chain

```text
Step 5 -> image.grade -> SUCCESS, but you notice the output is washed out.
```

Do NOT add a "color fix" plugin. Re-run `image.grade` with corrected
  
parameters. The previous output is on disk and overwritable.

## Verifying a finished video

```bash
# Probe (duration, codecs, audio, black-frame scan)
forge run export.probe --input src=output.mp4 --input blackCheck=true

# Extract a contact sheet for quick visual review
forge run export.contact_sheet --input src=output.mp4 --input cols=4 --input rows=4 --input width=240
```

If `blackFrames` is non-empty: the renderer received an under-coloured
  
clip. Add `video.grade` or pick a different asset. If duration is wrong:
  
trim or extend at the right step.

## HTTP / MCP transports

For programmatic access:

```bash
# HTTP
npm run api                          # listens on PORT (default 8787)

# MCP (stdio JSON-RPC)
npm run mcp
```

HTTP endpoints:

- `GET  /health`
- `GET  /plugins` (and `/plugins/:id`)
- `POST /run`   `{ plugin, input, step? }`
- `POST /steps` `{ steps: [{ plugin, input }] }`

MCP exposes every plugin as one tool. `tools/call` returns the formatted
  
ack in `content[].text` and `isError: true|false`.

---

## The agent skill

There is a complete skill for this project at [`skills/agentic-video/`](skills/agentic-video/).
It is the fastest way to get oriented — start with `SKILL.md`.

```
skills/agentic-video/
├── SKILL.md                       start here: the 8-stage master workflow
├── references/
│   ├── plugin-catalogue.md        all 125 plugins by category  (generated)
│   ├── remotion-templates.md      all 20 Remotion templates    (generated)
│   ├── providers.md               stock / AI / TTS sources and keys
│   ├── failure-codes.md           every failure code and what to do
│   └── recipes.md                 copy-paste end-to-end chains
├── workflows/                     runnable `forge steps` files
└── prompts/                       prompt templates (plan, recover, verify, author)
```

The two generated references are rebuilt with `npm run gen:skill`; CI fails if they drift.
