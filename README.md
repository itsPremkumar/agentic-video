# VideoForge

A pure plugin-based toolkit for agentic video editing and creation. An external
AI agent drives VideoForge by combining explicit plugins, **one at a time**.
There is no LLM orchestrator, no goal planner, and no autonomous workflow
inside this project — it is just a large, explicit set of tools.

```
External AI agent  ->  Plugin Interface (CLI / HTTP / MCP / batch)
                       |
                       v
       Pure plugin system (plugins/**)
       image | video | audio | voice | music | subtitle |
       effects | transitions | render | export | generation | animation
                       |
                       v
           core/* (ffmpeg, browser, validate, registry, runner)
```

## Philosophy

1. **Everything is a plugin.** Even the most basic creation paths
   (SVG → PNG, Canvas animation → MP4, AI text-to-image) are first-class
   plugins with their own inputs, outputs, and explicit failure modes.
2. **The core stays minimal.** It holds only the infrastructure required to
   discover, validate, and run plugins (ffmpeg wrapper, headless Chrome
   bridge, Python bridge, validation, registry, runner).
3. **Every operation is explicit and independent.** The external agent decides
   what to do. Nothing inside VideoForge makes a decision for it.
4. **Failures are loud, never silent.** No plugin falls back to a substitute.
   Missing key, missing dependency, broken input — every case returns a
   structured `PluginFailure` with `code`, `message`, `reason`, `input`,
   `hint`, `retryable`.
5. **Batch runners stop at the first failure.** A failing step is reported;
   the remaining steps are NOT executed and nothing is substituted.

## Quick start

```bash
cd VideoForge
cp .env.example .env                # add FAL_KEY / REPLICATE_API_TOKEN if you want AI plugins

npm run forge list                   # list every plugin (120 by default)
npm run forge describe image.resize  # show a plugin's inputs / outputs
npm run forge run image.resize --input src=input.png --input width=1080 --input height=1920
npm run forge steps examples/ocean-reel.json    # replay an explicit step list
```

Transports:
```bash
npm run api                          # start HTTP API on http://localhost:8787
npm run mcp                          # start the MCP stdio server (JSON-RPC)
```

## Project layout

```
VideoForge/
├── core/            plugin contract: loader, registry, runner, media, artifacts
├── plugins/         every capability (120) — see plugins/README.md
│   ├── INDEX.md     generated catalogue: id → one-liner → engine → file
│   └── _shared/     shared code, never registered as plugins
├── python/          Python bridge (run_plugin.py) + forge_py runtime
├── bin/forge.ts     the CLI (list | describe | run | steps | categories)
├── api/             HTTP transport
├── mcp/             Model Context Protocol transport
├── vendor/voicebox/ vendored MIT TTS backend (7 engines)
├── scripts/         setup:voicebox, gen:index
└── workspace/       generated artifacts — gitignored
```

The single organising rule: **plugin id `<namespace>.<action>` lives at
`plugins/<namespace>/<action>.ts`**. Families get a subfolder
(`voice/voicebox/`, `motion/remotion/`). Full conventions and how to add a
plugin: [`plugins/README.md`](plugins/README.md).

## Naming conventions

| Thing | Rule | Example |
|---|---|---|
| Plugin id | `<namespace>.<action>`, snake_case | `video.from_images` |
| Plugin file | `plugins/<namespace>/<action>.ts` | `plugins/video/from_images.ts` |
| Family subfolder | a sub-system groups under its namespace | `voice.voicebox_health` → `voice/voicebox/health.ts` |
| Shared code | leading `_` — walked, never registered | `_shared/stock.ts`, `voice/voicebox/_voicebox.ts` |
| Core module | single lowercase word, no prefix/suffix | `core/artifacts.ts` |
| Transport | one folder per protocol | `api/server.ts`, `mcp/server.ts` |
| Python side | `python/` (bridge) + `python/forge_py/` (SDK) | `python/run_plugin.py` |

## Plugin categories

<!-- BEGIN GENERATED: categories -->

| Category | Count | Plugins |
|---|---|---|
| `analyze` | 9 | `analyze.scene_audit`, `analyze.video`, `audio.onset`, `image.aesthetic`, `image.dedup`, `image.relevance`, `text.script_parse`, `video.dedup`, `video.scene_detect` |
| `audio` | 15 | `audio.beat`, `audio.denoise`, `audio.duck`, `audio.fade`, `audio.info`, `audio.lufs_for_platform`, `audio.master`, `audio.merge`, `audio.mux`, `audio.normalize`, `audio.remove_silence`, `audio.sfx`, `audio.speed`, `audio.trim`, `audio.volume` |
| `brand` | 3 | `brand.kit`, `text.hook`, `text.seo` |
| `distribute` | 4 | `delivery.archive`, `delivery.publish`, `delivery.revision`, `export.derivative` |
| `edit` | 2 | `edit.ops`, `video.scene_split` |
| `effects` | 6 | `effects.color_grade`, `effects.look`, `effects.style`, `effects.video`, `image.remove_bg`, `video.denoise` |
| `export` | 6 | `browser.extract`, `browser.pdf`, `export.contact_sheet`, `export.gif`, `export.probe`, `export.reframe` |
| `fx` | 7 | `effects.genre`, `fx.chroma_key`, `fx.compare`, `fx.speed_ramp`, `fx.stabilize`, `fx.transition_effect`, `fx.vintage` |
| `image` | 17 | `browser.mockup`, `browser.screenshot`, `image.canvas`, `image.convert`, `image.create`, `image.crop`, `image.download`, `image.filter`, `image.flip`, `image.generate`, `image.grade`, `image.info`, `image.resize`, `image.rotate`, `image.text`, `image.watermark`, `screen.shot` |
| `music` | 2 | `music.download`, `music.generate` |
| `qc` | 3 | `qc.asset`, `qc.gate`, `qc.placeholder_check` |
| `render` | 6 | `motion.canvas`, `motion.effect`, `motion.remotion`, `motion.remotion_template`, `render.slideshow`, `render.timeline` |
| `subtitle` | 5 | `subtitle.burn`, `subtitle.convert`, `subtitle.create`, `subtitle.karaoke`, `subtitle.syllable` |
| `transitions` | 1 | `transitions.xfade` |
| `video` | 23 | `browser.record`, `screen.record`, `video.animate`, `video.crop`, `video.download`, `video.extract_audio`, `video.extract_frames`, `video.fade`, `video.from_images`, `video.generate`, `video.grade`, `video.info`, `video.merge`, `video.overlay`, `video.remove_silence`, `video.resize`, `video.reverse`, `video.rotate`, `video.speed`, `video.text`, `video.thumbnail`, `video.trim`, `video.watermark` |
| `voice` | 11 | `voice.clone`, `voice.list_voices`, `voice.stt`, `voice.tts`, `voice.voicebox_clone`, `voice.voicebox_health`, `voice.voicebox_history`, `voice.voicebox_models`, `voice.voicebox_profiles`, `voice.voicebox_server`, `voice.voicebox_speak` |
<!-- END GENERATED: categories -->

Every category has a "tier-1" plugin — the most-used single tool — so an agent can solve the common case without learning the entire catalogue. Examples: `video.trim`, `audio.normalize`, `subtitle.create`, `image.resize`, `render.motion_remotion`, `export.derivative`, `fx.transition_effect`, `analyze.video`, `qc.gate`.

## Local voice: the vendored Voicebox backend

VideoForge ships a **complete, local TTS studio** at `vendor/voicebox/speech/`
— a vendored copy of [Voicebox](https://github.com/jamiepine/voicebox) (MIT).
It gives you GPU-accelerated narration and **zero-shot voice cloning** with no
cloud service and no per-character billing.

Seven engines are available: `kokoro` (zero-config narrator), `chatterbox`,
`chatterbox_turbo`, `qwen`, `qwen_custom_voice`, `luxtts`.

```bash
# One-time: install the backend deps into an isolated venv
npm run setup:voicebox                      # add --cuda cu126 for NVIDIA GPUs

# Then drive it entirely through plugins
npm run forge run voice.voicebox_server   --input action=start
npm run forge run voice.voicebox_health
npm run forge run voice.voicebox_profiles --input action=create --input name=Narrator --input voiceType=preset
npm run forge run voice.voicebox_clone    --input audio=me.wav --input transcript="exact words" --input name="My Voice"
npm run forge run voice.voicebox_speak    --input text="Hello world" --input profile="My Voice"
```

| Plugin | Purpose |
|--------|---------|
| `voice.voicebox_server` | start / stop / restart / status of the backend |
| `voice.voicebox_health` | GPU + backend variant |
| `voice.voicebox_profiles` | create / list / update / delete voice profiles |
| `voice.voicebox_clone` | register a cloned voice from a reference sample |
| `voice.voicebox_speak` | synthesise speech (polls, then downloads the WAV) |
| `voice.voicebox_models` | list / preload / unload engines (VRAM management) |
| `voice.voicebox_history` | past generations, stats, re-download audio |

Full setup (including the VRAM table per engine) is in
[`vendor/voicebox/README.md`](vendor/voicebox/README.md). Licence provenance is
in [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).

> Voicebox is **not** a silent replacement for `voice.tts`. If Voicebox is
> unreachable, `voice.voicebox_speak` fails and tells you why — switching to
> Edge-TTS is your call, not the plugin's.

## Stock media providers

`image.download` and `video.download` each take an explicit `provider`:

| Provider | Images | Video | Key |
|----------|:------:|:-----:|-----|
| Pexels | ✅ | ✅ | `PEXELS_API_KEY` |
| Pixabay | ✅ | ✅ | `PIXABAY_API_KEY` |
| Openverse | ✅ | — | none |
| Wikimedia Commons | ✅ | ✅ | none |

No provider substitution ever happens: ask for `pixabay` without a key and the
plugin fails with `MISSING_API_KEY` rather than quietly using something else.

## Namespace consolidation (breaking renames)

Eight orphan namespaces each held a single plugin, which produced confusing
near-duplicate folders (`effect/` next to `effects/`, `color/` next to
`grade/`). They were folded into the existing taxonomy. **Old ids no longer
resolve** — update any script that used them:

| Old id | New id |
|--------|--------|
| `asset.placeholder_check` | `qc.placeholder_check` |
| `captions.karaoke` | `subtitle.karaoke` |
| `scene.audit` | `analyze.scene_audit` |
| `effect.video` | `effects.video` |
| `color.grade` | `effects.color_grade` |
| `grade.look` | `effects.look` |
| `style.engine` | `effects.style` |
| `transition.xfade` | `transitions.xfade` |

Also renamed: `py/` → `python/` (the Python bridge). Plugin *files* moved to
match their namespace, but no other ids changed.

## The explicit-failure contract

Every `run` call returns a structured result:

```ts
interface OpResult {
    ok: boolean;
    step?: number;
    plugin: string;
    operation: string;
    category?: string;
    outputs: Artifact[];
    warnings: string[];
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    error?: {
        code: string;
        message: string;
        reason?: string;
        input?: unknown;
        detail?: string;
        retryable: boolean;
        hint?: string;
    };
}
```

The CLI prints this as:

```
Step 4 -> music.generate (Generate background music) -> FAILED  [1127ms]
    reason : Unknown key "AM".
    code   : INVALID_INPUT
    input  : {"key":"AM"}
    hint   : Supported keys: C, D, E, F, G, A, B
    retry  : yes (with corrected input)
```

## Examples

* `examples/demo-steps.json` — minimal smoke test.
* `examples/ocean-reel.json` — the full ocean plastic reel:
  image.download -> image.resize -> image.grade -> voice.tts ->
  music.generate -> audio.merge -> render.slideshow -> export.probe.
* `examples/inputs/image-create.json` — pure SVG -> PNG title card.
* `examples/inputs/image-canvas.json` — Canvas 2D particles -> PNG.
* `examples/inputs/motion-canvas.json` — Canvas 2D animation -> MP4.
* `examples/inputs/motion-remotion.json` — full Remotion (React/TSX) -> MP4.

## Environment

* `PEXELS_API_KEY` (image.download / video.download with provider=pexels)
* `FAL_KEY` (image.generate / video.generate with provider=fal)
* `REPLICATE_API_TOKEN` (image.generate with provider=replicate)
* `FFMPEG_PATH`, `FFPROBE_PATH` (override auto-detection)
* `VOICEBOX_URL` (Voicebox TTS server; default `http://localhost:17493`)
* `VIDEOFORGE_PYTHON`, `VIDEOFORGE_CHROME` (override Python / browser)
* `PORT` (HTTP server port; default 8787)

## Engine breakdown

| Engine | Plugins | When |
|---|---|---|
| TypeScript (`definePlugin`) | 56 | everything except voice.tts / voice.list_voices / voice.stt / voice.clone / music.generate |
| Python (`MANIFEST` + `run(input, ctx)`) | 4 | voice.tts, voice.list_voices, voice.stt, voice.clone, music.generate |
| ffmpeg | image/video/audio/subtitle/render/export/effects/transitions | every video / image op |
| Headless Chromium (`core/browser.ts`) | image.create, image.canvas, motion.canvas, motion.remotion | any browser-rendered output |
| fal.ai / Replicate | image.generate, video.generate | AI generation |
| Local Voicebox server | voice.voicebox_health / _profiles / _clone / _speak | realistic cloned-voice TTS |

The Python bridge is `py/run_plugin.py`; the browser bridge is
`core/browser.ts`. Both are zero-dependency beyond the system toolchain.
