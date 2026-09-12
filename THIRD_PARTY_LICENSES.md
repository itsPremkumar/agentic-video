# Third-party licences

VideoForge bundles the following third-party source code. Licences are
reproduced here so the project remains compliant and auditable.

---

## Voicebox (vendored backend) — MIT

- **Location:** `vendor/voicebox/speech/`
- **Upstream:** https://github.com/jamiepine/voicebox
- **Licence:** MIT
- **Copyright:** Copyright (c) 2026 Voicebox Contributors
- **Full licence text:** `vendor/voicebox/speech/LICENSE`
- **Provenance:** clean copy of the upstream backend, mirrored from
  `Automated-Video-Generator/src/speech`. Upstream cloud sync, HumeAI TADA paid
  backend, ROCm/CUDA binary auto-updaters and test suite were removed
  (see `vendor/voicebox/speech/VENDORED.md`).

> MIT License
>
> Copyright (c) 2026 Voicebox Contributors
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

### Runtime dependencies of the vendored backend

`vendor/voicebox/speech/requirements.txt` pulls in FastAPI, Uvicorn, SQLAlchemy,
PyTorch, Transformers, Kokoro, ONNX Runtime and friends. These are **not**
vendored — they are installed on demand by `npm run setup:voicebox`, which
creates an isolated `.venv-voicebox` so the main VideoForge interpreter is
untouched. Each of those packages keeps its own licence.

---

## Service provider notes

VideoForge *talks to* the following services but ships none of their code:

| Service | Used by | Key required | Licence of returned media |
|---------|---------|--------------|---------------------------|
| Pexels | `image.download`, `video.download` | `PEXELS_API_KEY` | Pexels licence (free use) |
| Pixabay | `image.download`, `video.download` | `PIXABAY_API_KEY` | Pixabay licence (free use) |
| Openverse | `image.download` | none | Varies — CC + public domain |
| Wikimedia Commons | `image.download`, `video.download` | none | Varies — check each file |
| Edge-TTS | `voice.tts` | none | Microsoft service terms |
| fal.ai | `video.generate` | `FAL_KEY` | Per fal.ai terms |

Attribution is the responsibility of the operator. `image.download` records
`title` and `source` metadata on every artifact to help with that.
