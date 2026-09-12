# Plugin catalogue

> **Generated** by `npm run gen:skill` from the live registry. Do not edit by hand.
> 125 plugins, 17 categories.
>
> Run `forge describe <id>` for exact inputs, defaults and enum values before you use one.

- [analyze](#analyze) (9)
- [audio](#audio) (15)
- [brand](#brand) (3)
- [browser](#browser) (2)
- [distribute](#distribute) (4)
- [edit](#edit) (3)
- [effects](#effects) (6)
- [export](#export) (6)
- [fx](#fx) (7)
- [image](#image) (18)
- [music](#music) (2)
- [qc](#qc) (3)
- [render](#render) (6)
- [subtitle](#subtitle) (5)
- [transitions](#transitions) (1)
- [video](#video) (24)
- [voice](#voice) (11)

## analyze

| Plugin | What it does | Outputs |
|---|---|---|
| `analyze.scene_audit` | Per-scene probe + cross-check + final assembly QC. Returns a JSON audit report. | [object Object] |
| `analyze.video` | QC report: black frames, freeze frames, audio peaks, codec/duration/aspect/fps. | [object Object] |
| `audio.onset` | Measures onsets-per-minute from an audio file, classifies the track as calm/mid/energetic, returns the matching target BPM and top-50 onset timestamps. | [object Object] |
| `image.aesthetic` | Returns a 0-5 score: +2 resolution >= 1280x720, +1 >= 1920x1080, +1 sane aspect ratio, +1 file size > 200KB, +1 valid bit-depth. No LLM. | [object Object] |
| `image.dedup` | Compute dHash (9x8 grayscale, 64-bit) for each image, cluster via Hamming distance threshold. Returns groups so the agent can prune duplicates. | [object Object] |
| `image.relevance` | Returns Jaccard similarity (0-1) between query keywords and image tag list. Pure set math, no LLM. | [object Object] |
| `text.script_parse` | Splits a script into paragraphs + sentences, identifies [Visual:]/[Text:] cue blocks as scenes, and emits per-scene keywords and reading-time. | [object Object] |
| `video.dedup` | Sample frames, dHash each (9x8 grayscale -> 64-bit), cluster near-duplicates via Hamming distance. Returns timestamped groups so the agent can dedup. | [object Object] |
| `video.scene_detect` | Deterministic scene-change detection via ffmpeg select=gt(scene,TH). Returns cut times + optional smart re-assembly. | [object Object] |

## audio

| Plugin | What it does | Outputs |
|---|---|---|
| `audio.beat` | Deterministic beat/BPM/onset detection via ffmpeg astats. Outputs a regularised beat grid for beat-synced cutting. | [object Object] |
| `audio.denoise` | Spectral denoise for audio. afftdn with a fixed floor or adaptive profile. | [object Object] |
| `audio.duck` | Sidechain-compress or volume-envelope a music bed so the voiceover stays clear. | [object Object] |
| `audio.fade` | Add fade-in and/or fade-out to an audio file. | [object Object] |
| `audio.info` | Return duration, codec, sample rate and loudness stats for an audio file. | [object Object] |
| `audio.lufs_for_platform` | Two-pass loudnorm to platform-specific LUFS targets (YouTube -14, Reels -16, Podcast -16, Broadcast -23, Music -14, Headphones -20). Custom also supported. | [object Object], [object Object] |
| `audio.master` | One-shot final audio: denoise + highpass + compressor + EBU R128 loudnorm + optional sidechain ducking. | [object Object] |
| `audio.merge` | Mix two or more audio files together (e.g. voiceover + background music). | [object Object] |
| `audio.mux` | Replace a video's audio track, and optionally keep the original audio mixed underneath. | [object Object] |
| `audio.normalize` | Apply EBU R128 loudness normalization (loudnorm) to an audio file. | [object Object] |
| `audio.remove_silence` | Cut silent passages out of an audio file. | [object Object] |
| `audio.sfx` | Deterministic SFX from ffmpeg signal sources (blip, click, whoosh, riser, impact, boom, chime, pad, wind, rain, swoosh, glitch, laser, ...). | [object Object] |
| `audio.speed` | Speed up or slow down audio while preserving pitch (atempo). | [object Object] |
| `audio.trim` | Cut a segment out of an audio file. | [object Object] |
| `audio.volume` | Scale the volume of an audio file (dB gain or multiplier). | [object Object] |

## brand

| Plugin | What it does | Outputs |
|---|---|---|
| `brand.kit` | Bundle: logo corner watermark, intro card, outro card, optional cinemascope letterbox bars. | [object Object] |
| `text.hook` | Pick one of 7 deterministic opener templates and plug in the script's strongest keywords. Deterministic given seed. | [object Object] |
| `text.seo` | Deterministic, no-LLM title + description + hashtag bundle derived from the script via stopword-filtered keyword frequency. | [object Object] |

## browser

| Plugin | What it does | Outputs |
|---|---|---|
| `browser.act` | Run a list of browser actions (navigate, click, fill, type, press, hover, select, scroll, wait, evaluate, screenshot) with Playwright auto-waiting. | [object Object], [object Object] |
| `browser.open` | Open a URL in Playwright Chromium, wait for it to settle, and save a screenshot. Handles cookie banners and dark mode. | [object Object] |

## distribute

| Plugin | What it does | Outputs |
|---|---|---|
| `delivery.archive` | Reads the current published version under <deliveriesRoot>/<projectId>/, moves that version folder into <archiveRoot>/<projectId>/<version>-<timestamp>. | [object Object] |
| `delivery.publish` | Copies a file to <outDir>/<projectId>/<version>/<basename>, writes a MANIFEST.json (sha1, size, mtime), and updates <projectId>/LATEST to point to the current version. | [object Object] |
| `delivery.revision` | Bumps the patch component of the project's current version (v1.0 -> v1.1) and publishes the new file under that version tag. Reads LATEST marker to find the current version. | [object Object] |
| `export.derivative` | One input, many outputs: 9:16, 16:9, 1:1, plus thumbnail PNG. | [object Object] |

## edit

| Plugin | What it does | Outputs |
|---|---|---|
| `edit.beat_cut` | Convert an audio.beat grid into an explicit clip list for render.timeline, so every cut lands on an onset (or beat). | [object Object] |
| `edit.ops` | Apply a batch of timeline operations (delete/insert/reorder/update/retime) to a JSON timeline spec. Returns the new timeline + a log of applied ops. | [object Object] |
| `video.scene_split` | Split a long clip into N sub-clips: evenly (mode=equal, count=N) or at explicit comma-separated timestamp marks (mode=marks). Uses lossless trim+concat. | [object Object] |

## effects

| Plugin | What it does | Outputs |
|---|---|---|
| `effects.color_grade` | Advanced colour: animated film grain, halation bloom, .cube LUT, lift/gamma/gain wheels, bleach bypass. | [object Object] |
| `effects.look` | Apply a named colour grade (cinematic, vivid, neon, teal-orange, bleach, warm, cool, bw, sepia, vintage) to a video or image. | [object Object] |
| `effects.style` | Full look recipe (grade + grain + vignette + sharpening): noir, sunset, cyberpunk, golden, arctic, moody, pastelDream, horrorDesat, documentary, hdr, muted, neonNight. | [object Object] |
| `effects.video` | Apply a named effect to a video. Supported: film-grain, vignette, letterbox, mirror, black-white, color-pop, blur, sharpen, shake, zoom-punch, edge-glow, slow-shutter | [object Object] |
| `image.remove_bg` | Local rembg (U-2-Net / ISNet) background removal. Writes a PNG with alpha. | image |
| `video.denoise` | Spatial + temporal denoise (hqdn3d). Optional chroma-only mode to keep skin tones clean. | [object Object] |

## export

| Plugin | What it does | Outputs |
|---|---|---|
| `browser.extract` | Read a page in headless Chromium and extract its title, meta, headings, text, links and images as JSON. | [object Object] |
| `browser.pdf` | Print a URL or local HTML file to PDF using headless Chromium. | [object Object] |
| `export.contact_sheet` | Build a grid of frames from a video (contact sheet) for visual review. | [object Object] |
| `export.gif` | Convert a video segment into an animated GIF. | [object Object] |
| `export.probe` | Report duration, size, codecs, streams, and run a black-frame check. | [object Object] |
| `export.reframe` | Fit a video into 9:16 / 16:9 / 1:1 / 4:5 by padding or cropping. | [object Object] |

## fx

| Plugin | What it does | Outputs |
|---|---|---|
| `effects.genre` | Applies a single coherent genre look via a tuned ffmpeg filter chain. 14 packs: cinematic, anime, retro-80s, lofi, documentary, vintage-film, cyberpunk, vhs, scifi-clean, horror, news-broadcast, music-video, dream-soft, noir, pop-commercial. | [object Object] |
| `fx.chroma_key` | Remove a colour from the background of a clip. Outputs WebM with alpha or mp4 over a coloured background. | [object Object] |
| `fx.compare` | Pick the same timestamp from N input videos, scale each to 480x270, tile into a 2-column (or N-column) contact sheet, draw each label. Deterministic, no overlay alignment needed. | [object Object] |
| `fx.speed_ramp` | Constant speed, accelerate, decelerate, punch-in, or punch-out via setpts+tpad. | [object Object] |
| `fx.stabilize` | Two-pass vidstab stabilisation (detect + transform) for handheld clips. | [object Object] |
| `fx.transition_effect` | Time-windowed transition effects: glitch, lightLeak, whipPan, flash, rgbSplit, zoomBlur. Split-concat windowing means every filter works, even ones without timeline support. | [object Object] |
| `fx.vintage` | Vintage, sepia, bleach, noir, polaroid, 70s, 80s, VHS, dreamy, cold, warm, punchy, pastel, or mono. | [object Object] |

## image

| Plugin | What it does | Outputs |
|---|---|---|
| `browser.mockup` | Render a URL or local HTML inside a browser-window or phone frame on a styled background. | [object Object] |
| `browser.screenshot` | Render a URL or local HTML file in headless Chromium and save it as PNG/JPG. | [object Object] |
| `browser.scroll_capture` | Scroll a page in even steps, screenshotting the viewport at each stop. Good for Ken Burns pans and long-page QA. | [object Object], [object Object] |
| `image.canvas` | Draw into a real HTML5 canvas with caller-supplied JavaScript and save the result as an image. | [object Object] |
| `image.convert` | Convert an image to another format, optionally setting JPEG quality. | [object Object] |
| `image.create` | Rasterise SVG or HTML+CSS markup into a PNG/JPG image using a real browser engine. | [object Object] |
| `image.crop` | Crop a rectangular region out of an image. | [object Object] |
| `image.download` | Search and download stock images from pexels \| pixabay \| openverse \| wikimedia. | [object Object] |
| `image.filter` | Apply a named visual filter. Supported: blur, sharpen, grayscale, sepia, vignette, noise, emboss, edge, pixelate, invert, posterize | [object Object] |
| `image.flip` | Flip an image horizontally or vertically. | [object Object] |
| `image.generate` | Create an image via fal.ai or Replicate text-to-image. Requires a key. Does NOT auto-fallback. | [object Object] |
| `image.grade` | Adjust brightness, contrast, saturation and gamma of an image. | [object Object] |
| `image.info` | Return dimensions, format and file size for an image. | [object Object] |
| `image.resize` | Resize an image to an explicit width/height (or fit within a box). | [object Object] |
| `image.rotate` | Rotate an image by an arbitrary angle (or 90° steps). | [object Object] |
| `image.text` | Burn text onto an image (title card, caption, lower third). | [object Object] |
| `image.watermark` | Overlay a watermark/logo image onto an image. | [object Object] |
| `screen.shot` | Take one still screenshot of the desktop (or one window by title). | [object Object] |

## music

| Plugin | What it does | Outputs |
|---|---|---|
| `music.download` | Download CC-licensed music from internet-archive. | [object Object] |
| `music.generate` | Synthesise a simple royalty-free background track (WAV) procedurally. | [object Object] |

## qc

| Plugin | What it does | Outputs |
|---|---|---|
| `qc.asset` | Validate one media file: min resolution, aspect ratio, duration, codec, sha256. | [object Object] |
| `qc.gate` | Runs deterministic gates against a media file: file exists, has video stream, duration in range, duration under platform cap, file size floor, audio stream present if required, resolution floor. | [object Object] |
| `qc.placeholder_check` | Downscale to 64x64 grayscale, read signalstats YSTD. YSTD <= 8 = placeholder (FAIL). 8 < YSTD <= 14 = low-information (WARN). Otherwise PASS. | [object Object] |

## render

| Plugin | What it does | Outputs |
|---|---|---|
| `motion.canvas` | Render an HTML5 Canvas animation to MP4/WebM by sampling one frame at a time. Supports optional audio, alpha (webm), and custom frame functions. | [object Object] |
| `motion.effect` | Ken Burns zoom/pan, handheld shake, parallax drift, punch-in/out. Works on stills (with duration) or clips. | [object Object] |
| `motion.remotion` | Bundle and render a caller-authored Remotion (React) composition. The composition code can use the full Remotion API: useFrame, spring, interpolate, transitions, shapes, paths, captions, kinetic text, etc. | [object Object] |
| `motion.remotion_template` | Render a prebuilt Remotion composition (lower-third, title-card, end-cta, countdown, progress-bar, kinetic-text, bar-chart, logo-reveal, spectrum, confetti, stat-counter, quote-card, split-screen, typewriter, timeline, list-reveal, waveform, glitch-title, testimonial, product-card) by name. | [object Object] |
| `render.slideshow` | Render a sequence of images into a video, with optional Ken Burns motion and audio. | [object Object] |
| `render.timeline` | Assemble an explicit list of clips (+ optional audio and subtitles) into the final video. | [object Object] |

## subtitle

| Plugin | What it does | Outputs |
|---|---|---|
| `subtitle.burn` | Permanently render an SRT/ASS subtitle file onto a video. | [object Object] |
| `subtitle.convert` | Convert SRT↔VTT and optionally shift every cue by an offset. | [object Object] |
| `subtitle.create` | Build an SRT or VTT subtitle file from timed cues. | [object Object] |
| `subtitle.karaoke` | Even-distributed word captions from a word list, or precise cues from an SRT-shaped array. | [object Object] |
| `subtitle.syllable` | Synthesise per-syllable caption timings (165 ms/syllable, clamped [120,600], 40 ms inter-word gap). Emits .srt and an 8-style CSS palette. | [object Object], [object Object] |

## transitions

| Plugin | What it does | Outputs |
|---|---|---|
| `transitions.xfade` | Join two clips with an ffmpeg xfade transition. | [object Object] |

## video

| Plugin | What it does | Outputs |
|---|---|---|
| `browser.record` | Record a URL / local HTML file to MP4 or WebM while scrolling, one captured frame at a time. | [object Object] |
| `browser.record_flow` | Record video of a website while driving it (navigate, scroll, click, type). Produces MP4 via Playwright + ffmpeg. | [object Object], [object Object] |
| `screen.record` | Capture the desktop (or one window by title) to MP4 using the platform screen-grabber. | [object Object] |
| `video.animate` | Animate a still image into a short motion clip using a local ComfyUI server with AnimateDiff. Needs ComfyUI running — for the no-dependency path use video.from_images. | [object Object] |
| `video.crop` | Crop a video to a rectangle, or to an aspect ratio with auto-centering. | [object Object] |
| `video.download` | Search and download stock video clips from pexels \| pixabay \| wikimedia. | [object Object] |
| `video.extract_audio` | Pull the audio track out of a video into an audio file. | [object Object] |
| `video.extract_frames` | Export still images from a video — every N seconds, a fixed count, or at explicit timestamps. | [object Object] |
| `video.fade` | Add a fade from/to black at the start and/or end of a clip. | [object Object] |
| `video.from_images` | Convert still images into a video with optional Ken Burns motion and crossfade transitions. Local ffmpeg — no API key. (For AI motion see video.generate.) | [object Object] |
| `video.generate` | Create a video via fal.ai text-to-video or image-to-video. Requires FAL_KEY. | [object Object] |
| `video.grade` | Adjust brightness, contrast, saturation and gamma of a video. | [object Object] |
| `video.info` | Return duration, dimensions, codecs and streams for a video file. | [object Object] |
| `video.merge` | Join multiple clips end to end. Re-encodes so mixed sources always work. | [object Object] |
| `video.overlay` | Overlay one video/image on top of another (PiP). | [object Object] |
| `video.remove_silence` | Cut silent passages out of a video (also removes the matching picture). | [object Object] |
| `video.resize` | Scale a video to an explicit size or to a target short-edge height. | [object Object] |
| `video.reverse` | Play a clip backwards (re-encodes, no audio). | [object Object] |
| `video.rotate` | Rotate a video by 90 / 180 / 270 degrees, or an arbitrary angle. | [object Object] |
| `video.speed` | Speed up or slow down a video (and optionally its audio). | [object Object] |
| `video.text` | Burn text onto a video, optionally only during a time window. | [object Object] |
| `video.thumbnail` | Grab a single frame from a video as an image. | [object Object] |
| `video.trim` | Cut a segment out of a video by start time and duration. | [object Object] |
| `video.watermark` | Overlay a logo/watermark image onto a video. | [object Object] |

## voice

| Plugin | What it does | Outputs |
|---|---|---|
| `voice.clone` | Synthesise speech in a cloned voice using Coqui XTTS-v2. Requires 'pip install TTS' and a reference audio. | [object Object] |
| `voice.list_voices` | List available Edge-TTS voices, optionally filtered by locale (e.g. en-US). | [object Object] |
| `voice.stt` | Transcribe speech from an audio/video file using faster-whisper. | [object Object] |
| `voice.tts` | Synthesise natural speech to an MP3/WAV file using Edge-TTS. | [object Object] |
| `voice.voicebox_clone` | Create a cloned Voicebox voice profile from reference audio + transcript. Returns a profile id you can speak through. | [object Object] |
| `voice.voicebox_health` | Ping the local Voicebox TTS server (default http://localhost:17493) and report its health. | [object Object] |
| `voice.voicebox_history` | List / search Voicebox generations, read stats, or re-download the audio of a previous generation by id. | [object Object] |
| `voice.voicebox_models` | Inspect Voicebox engine status, preload a model, or unload one to free VRAM before switching engines. | [object Object] |
| `voice.voicebox_profiles` | List, create, inspect or delete Voicebox voice profiles (cloned / preset / designed). | [object Object] |
| `voice.voicebox_server` | Lifecycle control for the vendored Voicebox TTS backend (vendor/voicebox/speech). Actions: start, stop, restart, status. | [object Object] |
| `voice.voicebox_speak` | Generate speech through a Voicebox voice profile (cloned / preset / designed) and save the audio file. | [object Object] |
