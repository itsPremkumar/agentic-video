# Failure codes

Every failure returns the same shape:

```json
{
  "ok": false,
  "plugin": "image.resize",
  "error": {
    "code": "INVALID_INPUT",
    "message": "Provide a positive width and/or height.",
    "reason": "Provide a positive width and/or height.",
    "input": { "width": 0 },
    "detail": "...",
    "retryable": true,
    "hint": "Run: forge describe image.resize  (to see the accepted inputs)"
  }
}
```

**`retryable` is the field to branch on.**

- `true` → the input was wrong. Fix it and re-run **the same step**.
- `false` → the environment is wrong (missing binary, missing key, broken source file).
  Re-running the same input will fail identically.

Anything not listed here will still carry a `code` — read it, do not swallow it.

---

## Codes you will actually hit

| Code | Means | Retryable | What to do |
|---|---|:---:|---|
| `INVALID_INPUT` | an input is missing, malformed or out of range | ✅ | Read `hint`; usually `forge describe <id>` |
| `FILE_NOT_FOUND` | a path you passed does not exist | ✅ | Check the path — pass the one the previous step printed |
| `MISSING_API_KEY` | provider key not in `.env` | ❌ | Add the key, re-run |
| `MISSING_BINARY` | ffmpeg / ffprobe not on `PATH` | ❌ | Install ffmpeg |
| `MISSING_DEPENDENCY` | python or Chromium missing | ❌ | Install, or set `AGENTIC_VIDEO_PYTHON` / `AGENTIC_VIDEO_CHROME` |
| `NO_RESULTS` | stock query returned nothing | ✅ | Reword the query or switch provider |
| `DOWNLOAD_FAILED` | a fetched asset could not be saved | ✅ | Retry; check network/disk |
| `CLIP_UNREADABLE` | source file has no decodable video stream | ❌ | Replace the file (see below) |
| `UNKNOWN_PROVIDER` | `provider` not one of the accepted values | ✅ | `forge describe <id>` for the enum |
| `UNKNOWN_TEMPLATE` | Remotion template name not recognised | ✅ | See [remotion-templates.md](remotion-templates.md) |
| `UNKNOWN_LOOK` / `UNKNOWN_EFFECT` / `UNKNOWN_STYLE` / `UNKNOWN_TRANSITION` / `UNKNOWN_ASPECT` | enum value not in the list | ✅ | `forge describe <id>` |
| `UNKNOWN_MODEL` / `UNKNOWN_ACTION` | model or browser action not recognised | ✅ | `forge describe <id>` |
| `UPSTREAM_FAILED` / `UPSTREAM_ERROR` / `UPSTREAM_TIMEOUT` / `PROVIDER_ERROR` | remote API failed | ✅ | Retry; if persistent, the provider is down |
| `BAD_UPSTREAM_RESULT` | remote API replied with something unusable | ✅ | Retry, or change provider |
| `CHROME_NOT_FOUND` | no Chromium for browser/canvas/Remotion plugins | ❌ | Install Chrome, or run `npx playwright install chromium` |
| `REMOTION_NOT_INSTALLED` | Remotion package missing | ❌ | `npm install` |
| `SCREENSHOT_FAILED` / `RECORD_FAILED` / `SCREEN_SHOT_FAILED` / `SCREEN_RECORD_FAILED` | capture failed | ✅ | Check the URL and viewport size |
| `TARGET_NOT_FOUND` | a browser locator matched nothing | ✅ | Fix the selector; the message names the step index |
| `WAIT_TIMEOUT` | element never appeared | ✅ | Increase the timeout or fix the selector |
| `TRANSITION_FAILED` / `REFRAME_FAILED` / `TEMPLATE_FAILED` | ffmpeg or Remotion step failed | ✅ | Read `detail` |
| `QC_FAILED` | the file did not pass a quality gate | ❌ | Look at what the gate reports and fix the asset |
| `PYTHON_PLUGIN_FAILED` / `PYTHON_PLUGIN_NO_RESULT` | Python bridge error | ✅ | Read `detail` — usually a missing Python package |

---

## Voicebox (local TTS) codes

All mean the same practical thing: the local TTS server is not usable. Start it with
`voice.voicebox_server --input action=start`, or use `voice.tts` (Edge-TTS) instead — but say so
explicitly rather than silently swapping.

`VOICEBOX_UNREACHABLE`, `VOICEBOX_TIMEOUT`, `VOICEBOX_SERVER_NOT_READY`, `VOICEBOX_HTTP_ERROR`,
`VOICEBOX_BAD_JSON`, `VOICEBOX_BACKEND_NOT_FOUND`, `VOICEBOX_NO_GENERATION_ID`,
`VOICEBOX_GENERATION_TIMEOUT`, `VOICEBOX_GENERATION_FAILED`, `VOICEBOX_AUDIO_FETCH_FAILED`.

---

## Two traps

**1. `MISSING_BINARY` vs `INVALID_INPUT`.** "ffmpeg not installed" and "you passed a bad number"
are different problems. If you get `MISSING_BINARY`, do **not** start rewriting inputs — install
ffmpeg.

**2. `CLIP_UNREADABLE` usually means a still, not a corrupt file.** A `.png`/`.jpg` passed where
a video is expected has no video stream. Either give it a duration (`motion.effect`) or use a
plugin that accepts stills (`video.from_images`, `render.timeline`).

---

## Never do this

- Don't switch plugins because one failed. `music.generate` failing on `key: "Am"` is not a
  reason to use `audio.sfx` instead — it is a reason to pass `key: "A"`.
- Don't retry a `retryable: false` failure in a loop.
- Don't tell the user a step succeeded when it returned `ok: false`.

The contract exists so the caller always knows what happened. Preserving that is the point of
the whole project.
