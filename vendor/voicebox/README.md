# Voicebox — vendored TTS backend

This directory is a **verbatim vendored copy** of the
[Voicebox](https://github.com/jamiepine/voicebox) backend (MIT licence), so
VideoForge can run a local, GPU-accelerated TTS studio with **zero-shot voice
cloning** without any external repo or cloud service.

- **Upstream:** https://github.com/jamiepine/voicebox
- **Licence:** MIT — Copyright (c) 2026 Voicebox Contributors (see `speech/LICENSE`)
- **Provenance:** mirrored from `Automated-Video-Generator/src/speech`
- **Package layout:** `speech/` is the Python package; run it as
  `python -m speech.main` with **cwd set to this directory**.

> The vendored copy has upstream's cloud sync, HumeAI TADA paid backend, ROCm/CUDA
> binary auto-updaters and test suite removed. See `speech/VENDORED.md`.

---

## What you get

7 TTS engines behind one FastAPI server:

| Engine id | Purpose | Approx. VRAM |
|-----------|---------|--------------|
| `kokoro` | Zero-config default narrator, no cloning | ~0.8 GB |
| `chatterbox` | Cloned voice, multilingual | ~3.2 GB |
| `chatterbox_turbo` | Cloned voice, fast | ~3.8 GB |
| `qwen` | High-quality narrator | ~3.6 GB |
| `qwen_custom_voice` | Custom voice clone | ~3.6 GB |
| `luxtts` | LuxTTS engine | varies |

Models load **lazily** on first use and stay warm in VRAM afterwards.

---

## One-time setup

Voicebox needs its own Python dependencies (FastAPI + PyTorch). VideoForge's
default interpreter does **not** carry them, so create a dedicated venv:

```bash
# From the VideoForge project root (Windows)
python -m venv .venv-voicebox
.venv-voicebox/Scripts/python.exe -m pip install --upgrade pip

# CPU-only (works everywhere)
.venv-voicebox/Scripts/python.exe -m pip install -r vendor/voicebox/speech/requirements.txt

# ...or with CUDA 12.6 (NVIDIA GPU, much faster)
.venv-voicebox/Scripts/python.exe -m pip install \
  --index-url https://download.pytorch.org/whl/cu126 torch torchaudio
.venv-voicebox/Scripts/python.exe -m pip install -r vendor/voicebox/speech/requirements.txt
```

Then point the plugin at that interpreter (either works):

```bash
export VOICEBOX_PYTHON=.venv-voicebox/Scripts/python.exe
# or pass --input python=.venv-voicebox/Scripts/python.exe
```

---

## Driving it from VideoForge

Everything goes through plugins — there is no hidden auto-start and no silent
fallback. The usual order:

```bash
# 1. Bring the server up (polls /health until ready, then detaches)
forge run voice.voicebox_server --input action=start

# 2. Confirm GPU + backend
forge run voice.voicebox_health

# 3. Create a voice profile
forge run voice.voicebox_profiles --input action=create --input name="Narrator" --input voiceType=preset

# 4. Clone a real voice (needs 10-30s of clean reference audio)
forge run voice.voicebox_clone --input audio=my-voice.wav \
                               --input transcript="the exact words spoken" \
                               --input name="My Voice"

# 5. Speak
forge run voice.voicebox_speak --input text="Hello world" --input profile="My Voice"
```

Other plugins: `voice.voicebox_models` (list / load / unload engines),
`voice.voicebox_history` (past generations).

If Voicebox is unavailable, use `voice.tts` (Edge-TTS) instead — but **you**
make that choice; the plugin system will never swap providers behind your back.

---

## Data location

Profiles, samples and generated audio live in the data dir, which defaults to
`workspace/cache/voicebox` (override with `--input dataDir=...`). Keep it out of
git — it contains your voice data.
