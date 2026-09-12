# plugins/ — layout & conventions

The filesystem mirrors the plugin namespace. If you know a plugin id you know
its path, and vice versa. The loader discovers everything by walking this tree,
so there is no registration step — and [`INDEX.md`](INDEX.md) is **generated**
from that same walk (`npm run gen:index`), so it can never go stale.

## The one rule

```
plugin id   <namespace>.<action>
file path   plugins/<namespace>/<action>.ts
```

| Plugin id | File |
|-----------|------|
| `video.trim` | `plugins/video/trim.ts` |
| `video.from_images` | `plugins/video/from_images.ts` |
| `subtitle.syllable` | `plugins/subtitle/syllable.ts` |
| `qc.gate` | `plugins/qc/gate.ts` |

Filenames use `snake_case` and match the id exactly — no camelCase anywhere in
the tree. `workspace/.tmp/audit.mjs` enforces the rule: it reports any file
whose top-level folder differs from its id namespace (currently 0 mismatches).

## Family subfolders

Plugin families that belong together get a subfolder inside their namespace.
The namespace folder is unchanged; only the grouping deepens.

```
plugins/voice/voicebox/          voice.voicebox_*
    _voicebox.ts                 shared HTTP client (not a plugin)
    server.ts    speak.ts    profiles.ts
    clone.ts     models.ts   history.ts   health.ts

plugins/motion/remotion/         motion.remotion, motion.remotion_template
    _templates.ts                Remotion composition builders
    render.ts    template.ts
```

## Shared code

| Location | Scope |
|----------|-------|
| `plugins/_shared/common.ts` | project-wide helpers (`S` field builders, `requireFile`, `resolveOutPath`, `safeFilePart`, `safeExt`, `withExt`) |
| `plugins/_shared/stock.ts` | stock-media plumbing shared by the download plugins (key guard, HTTP error wrap, Wikimedia Commons search, download-to-disk loop) |
| `plugins/_shared/font.ts` | font resolution |
| `plugins/<ns>/_*.ts` | namespace-local helpers (e.g. `voice/voicebox/_voicebox.ts`, `motion/remotion/_templates.ts`) |

Only the provider-specific request/response shapes live inside
`image/download.ts` and `video/download.ts`; everything both of them need is
in `_shared/stock.ts`.

Files beginning with `_` are **never** registered as plugins. They must not
export a default `definePlugin(...)`.

## Adding a plugin

1. Pick the namespace — reuse an existing one; only add a new folder if the
   capability genuinely does not fit.
2. Create `plugins/<namespace>/<action>.ts`.
3. Export `definePlugin({ id, name, category, description, inputs, outputs, run })`.
4. Use `S.string(...)` / `S.int(...)` etc. from `_shared/common.ts` for inputs.
5. Write outputs via `resolveOutPath(ctx, input.out)` so paths never double-nest.
6. On failure throw `PluginFailure` with a specific `code` — never silently
   substitute another provider.

No registration step: `npm run forge list` will pick it up immediately.

## Python plugins

`plugins/<namespace>/<action>.py` with a module-level `MANIFEST` dict and a
`run(payload, ctx)` function. They are discovered by
`python/run_plugin.py describe` and executed over the bridge in
`core/python.ts`.

```
plugins/music/generate.py        music.generate
plugins/image/remove_bg.py       image.remove_bg
plugins/voice/{tts,stt,clone,list_voices}.py
```

## Namespaces

| Folder | Contains |
|--------|----------|
| `analyze` | video QC, scene audit |
| `audio` | trim/fade/normalize/merge/mux/master/duck/beat/onset/sfx/lufs |
| `brand` | brand kit |
| `browser` | headless-Chrome screenshot/record/pdf/extract/mockup |
| `delivery` | versioned publish / revision / archive |
| `edit` | atomic timeline operations |
| `effects` | genre packs, looks, style engine, colour grade, video effects |
| `export` | probe, gif, reframe, contact sheet, derivative |
| `fx` | speed ramp, stabilise, chroma key, vintage, transitions, compare |
| `image` | create/canvas/edit/analyse/dedup/download |
| `motion` | Ken Burns & camera motion, canvas, Remotion |
| `music` | procedural music, CC download |
| `qc` | asset QC, gate aggregator, placeholder check |
| `render` | slideshow, timeline |
| `screen` | desktop capture |
| `subtitle` | create/convert/burn/syllable/karaoke |
| `text` | script parse, SEO, hooks |
| `transitions` | xfade library |
| `video` | trim/crop/download/animate/from_images/extract_frames/… |
| `voice` | Edge-TTS, STT, cloning, and the `voicebox/` family |
