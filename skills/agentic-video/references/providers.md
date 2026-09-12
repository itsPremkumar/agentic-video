# Providers, keys and where media comes from

Every provider is **explicit**. You name it; it is never substituted. No key → `MISSING_API_KEY`,
not a quiet swap to a worse source.

## Stock images and video

`image.download` and `video.download` both take a required `provider` input.

| Provider | Images | Video | Key | Notes |
|---|:--:|:--:|---|---|
| `pexels` | ✅ | ✅ | `PEXELS_API_KEY` | Best relevance. Recommended — add this one. |
| `pixabay` | ✅ | ✅ | `PIXABAY_API_KEY` | Good coverage, slightly looser relevance. |
| `openverse` | ✅ | — | none | Always available. Good keyless default for images. |
| `wikimedia` | ✅ | ✅ | none | Always available. Video comes back as **`.ogv`** — that is correct, but transcode before mixing with MP4 (`export.derivative`). |

```bash
npm run forge -- run image.download --input provider=pexels --input query="ocean waves" \
  --input count=6 --input prefix=sea
```

Returns a JSON file listing what it downloaded. Read it, then pass those paths downstream.

### Keyless mode

With no keys at all, use `openverse` (images) and `wikimedia` (images + video). Results are
lower-relevance than Pexels but the pipeline works. Say so in your plan rather than silently
producing worse output.

---

## AI generation

| Plugin | Providers | Key | Notes |
|---|---|---|---|
| `image.generate` | `fal`, `replicate` | `FAL_KEY` / `REPLICATE_API_TOKEN` | text-to-image |
| `video.generate` | `fal` | `FAL_KEY` | text-to-video, image-to-video |

Costs money and is slow. Prefer stock or authored markup unless the user asked for generated
imagery.

---

## Voice

| Plugin | Engine | Key | Notes |
|---|---|---|---|
| `voice.tts` | Edge-TTS | none | Good default. No setup. |
| `voice.voicebox_*` | Vendored Voicebox (7 engines) | none | Local, GPU-optional, supports zero-shot cloning. Needs `npm run setup:voicebox` (~2–3 GB). |
| `voice.stt` | faster-whisper | none | Transcription. |
| `voice.clone` | Coqui TTS | none | Voice cloning. |

Until Voicebox is installed, `voice.voicebox_*` returns `VOICEBOX_UNREACHABLE`. That is expected —
use `voice.tts`.

Musical note for `music.generate`: it wants a **note name** (`A`), not a key signature (`Am`).

---

## Where the media comes from without any network

| Source | Plugin |
|---|---|
| HTML / CSS / SVG you write | `image.create` |
| Canvas 2D code you write | `image.canvas` |
| A website | `browser.screenshot`, `browser.scroll_capture`, `browser.record_flow` |
| Procedural audio | `music.generate`, `audio.sfx` |
| Remotion compositions | `motion.remotion_template` (20 templates), `motion.remotion` |

A complete video can be built with **zero API keys** and **zero downloads** this way.

---

## Environment variables

Put these in `.env` (gitignored). Full list with comments: `.env.example`.

```
PEXELS_API_KEY=          # image.download / video.download, provider=pexels
PIXABAY_API_KEY=         # image.download / video.download, provider=pixabay
FAL_KEY=                 # image.generate / video.generate
REPLICATE_API_TOKEN=     # image.generate

FFMPEG_PATH=             # only if auto-detection fails
FFPROBE_PATH=
AGENTIC_VIDEO_PYTHON=    # python for the plugin bridge
AGENTIC_VIDEO_CHROME=    # chromium for browser/canvas/remotion
VOICEBOX_URL=            # default http://127.0.0.1:17493
PORT=                    # HTTP API, default 8787
```

The old `VIDEOFORGE_PYTHON` / `VIDEOFORGE_CHROME` names still resolve — both are accepted.
