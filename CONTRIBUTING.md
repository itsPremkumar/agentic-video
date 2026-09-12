# Contributing to Agentic Video

Thanks for taking the time to contribute.

Agentic Video is a **pure plugin toolkit**: an external AI agent calls one
plugin at a time. There is no orchestrator inside this repo, and the value of
the project lives almost entirely in the quality of its plugin contracts — an
ambiguous input description or a silent fallback turns into a confusing failure
for whatever agent is driving it.

So the bar for a contribution is: **does this make life more predictable for
the thing calling us?**

---

## Getting set up

Prerequisites:

| Tool | Why | Notes |
|---|---|---|
| Node.js 20+ (22 LTS recommended) | TypeScript plugin runtime | see `.nvmrc` |
| ffmpeg + ffprobe | nearly every media plugin | must be on `PATH` |
| Python 3.10+ | Python plugins (`music.generate`, `voice.*`, `image.remove_bg`) | optional — only needed if you touch those |
| Chromium (via Playwright) | `browser.*` plugins | `npx playwright install chromium` |

```bash
git clone https://github.com/itsPremkumar/agentic-video.git
cd agentic-video
npm install
cp .env.example .env          # optional: add FAL_KEY / REPLICATE_API_TOKEN for AI plugins

npm test                      # typecheck + plugin contract check
npm run forge list            # you should see every plugin
```

Optional, large (~2–3 GB, downloads torch):

```bash
npm run setup:voicebox        # local TTS engines under vendor/voicebox
```

---

## The one rule

```
plugin id   <namespace>.<action>
file path   plugins/<namespace>/<action>.ts
```

The filesystem mirrors the namespace. The loader discovers plugins by walking
the tree, so **there is no registration step** — drop the file in and
`forge list` sees it. `plugins/INDEX.md` and the README category table are
generated from that same walk, so they can never go stale.

Filenames are `snake_case` and match the id exactly. No camelCase anywhere in
the tree.

---

## Adding a TypeScript plugin

Create `plugins/<namespace>/<action>.ts`:

```ts
import { definePlugin } from '../../core/define.ts';
import { S, requireFile, resolveOutPath } from '../_shared/common.ts';

export default definePlugin({
    id: 'image.resize',
    name: 'Resize image',
    category: 'image',
    description: 'Resize an image to an explicit width/height (or fit within a box).',
    inputs: {
        src: S.string('Source image path', { required: true }),
        width: S.int('Target width in pixels (-1 keeps aspect)', { default: -1 }),
        out: S.string('Output file name (inside the plugin workspace)'),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const dest = resolveOutPath(ctx, input.out);
        // ... do the work ...
        return { outputs: [{ path: dest, kind: 'image' }] };
    },
});
```

Checklist — the contract check (`npm test`) enforces most of this:

- [ ] `id` is snake_case and matches the file path exactly
- [ ] `name`, `description`, `category`, `outputs` are all set and non-empty
- [ ] **every** input has a human-readable description (the agent reads these)
- [ ] `enum` inputs list at least one allowed value and declare a `default`
- [ ] outputs are written through `resolveOutPath(ctx, input.out, …)`
- [ ] nothing is silently substituted on failure

## Adding a Python plugin

Create `plugins/<namespace>/<action>.py` with a module-level `MANIFEST` dict
and a `run(payload, ctx)` function. The bridge lives in `core/python.ts` and
discovers the plugin via `python/run_plugin.py describe`.

```
plugins/music/generate.py      ->  music.generate
plugins/image/remove_bg.py     ->  image.remove_bg
plugins/voice/tts.py           ->  voice.tts
```

---

## Failure conventions (important)

**Never fall back silently.** If a provider is missing a key, a binary is
absent, or an input is out of range, throw a `PluginFailure` with a specific
`code`. The external agent decides what to do next — not us.

```ts
import { PluginFailure } from '../../core/define.ts';
import { invalidInput } from '../_shared/common.ts';

// Recoverable input problem -> INVALID_INPUT, retryable: yes,
// and the runner adds "Run: forge describe <id>" automatically.
invalidInput('Provide a positive width and/or height.', { field: 'width', value: input.width });

// Unrecoverable / environmental -> explicit code, retryable: false
throw new PluginFailure({
    code: 'MISSING_KEY',
    message: 'FAL_KEY is not set',
    reason: 'Provider credentials missing',
    retryable: false,
    hint: 'cp .env.example .env and add FAL_KEY',
});
```

A bare `throw new Error(...)` becomes `PLUGIN_ERROR` with `retryable: false`,
which tells the agent never to retry — usually wrong for a bad input. Use
`invalidInput()` instead.

---

## Before you open a PR

```bash
npm test                 # typecheck + contract check (must be clean)
npm run gen:index        # if you added/renamed a plugin — regenerates INDEX.md
                         # and the README category table
```

Then, if your plugin touches media, actually run it once end-to-end and confirm
the output with `export.probe`. Contract checks do not render anything.

Commit messages: conventional commits are appreciated
(`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).

---

## What we are unlikely to merge

- An LLM/orchestrator/planner inside this repo — by design there is none.
- Silent fallbacks ("provider failed, so use this other one instead").
- Plugins without input descriptions.
- Generated artifacts committed under `workspace/` (it is gitignored).

---

## Reporting bugs and requesting plugins

Use the issue templates:

- **Bug report** — a plugin produced a wrong or silent failure
- **Plugin request** — a capability the toolkit is missing
- **Feature request** — anything else

For security issues, **do not open a public issue** — see
[SECURITY.md](SECURITY.md).

---

## Code of conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Licence

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
