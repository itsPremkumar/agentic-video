# Voice Options in Agentic Video

## Quick Start (No Setup Required)

### Edge-TTS — Cloud, Free, Instant
Works immediately. No GPU. No local server. 322 voices across 100+ languages.

```bash
# Single speaker
npm run forge -- run voice.tts --input text="Hello world" --input voice=en-US-JennyNeural

# Multi-speaker dialogue
npm run forge -- run voice.dialogue --json dialogue.json
```

**Popular voices:**
| Voice | Language | Gender |
|-------|----------|--------|
| en-US-JennyNeural | English (US) | Female |
| en-US-GuyNeural | English (US) | Male |
| en-GB-SoniaNeural | English (UK) | Female |
| en-IN-NeerjaNeural | English (India) | Female |
| ja-JP-NanamiNeural | Japanese | Female |
| zh-CN-XiaoxiaoNeural | Chinese | Female |
| de-DE-KatjaNeural | German | Female |
| fr-FR-DeniseNeural | French | Female |
| es-ES-ElviraNeural | Spanish | Female |
| pt-BR-FranciscaNeural | Portuguese (BR) | Female |
| ko-KR-SunHiNeural | Korean | Female |
| ru-RU-SvetlanaNeural | Russian | Female |

**List all voices:**
```bash
npm run forge -- run voice.list_voices --input locale=en-US
```

---

## Local GPU Voice (Premium Quality)

### Voicebox — Vendored, 7 Engines
Requires: Python 3.10-3.12, PyTorch, ~0.8-3.8 GB VRAM

**Setup (one-time):**
```bash
# Windows
python -m venv .venv-voicebox
.venv-voicebox/Scripts/python.exe -m pip install --upgrade pip

# Install PyTorch (pick one):
# CPU-only:
.venv-voicebox/Scripts/python.exe -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
# CUDA (NVIDIA GPU):
.venv-voicebox/Scripts/python.exe -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu126

# Install Voicebox dependencies:
.venv-voicebox/Scripts/python.exe -m pip install -r vendor/voicebox/speech/requirements.txt
```

**Note:** Python 3.13 is not supported by Kokoro. Use Python 3.10-3.12.

**Usage:**
```bash
# 1. Start the server
npm run forge -- run voice.voicebox_server --input action=start

# 2. Check health
npm run forge -- run voice.voicebox_health

# 3. Create a profile
npm run forge -- run voice.voicebox_profiles --input action=create --input name="Narrator" --input voiceType=preset

# 4. Generate speech (pick your engine)
npm run forge -- run voice.voicebox_kokoro --input text="Hello" --input profile="Narrator"
npm run forge -- run voice.voicebox_chatterbox --input text="Hello" --input profile="Narrator"
npm run forge -- run voice.voicebox_qwen --input text="Hello" --input profile="Narrator"
```

**Engine comparison:**
| Engine | Plugin | VRAM | Best For |
|--------|--------|------|----------|
| Kokoro | voice.voicebox_kokoro | ~0.8 GB | Fast narration |
| Chatterbox | voice.voicebox_chatterbox | ~3.2 GB | Multilingual clone |
| Chatterbox Turbo | voice.voicebox_chatterbox_turbo | ~3.8 GB | Fast clone |
| Qwen | voice.voicebox_qwen | ~3.6 GB | Quality narrator |
| Qwen Custom | voice.voicebox_qwen_custom | ~3.6 GB | Custom clone |
| LuxTTS | voice.voicebox_luxtts | varies | Premium quality |

---

## Offline Voice Cloning

### Coqui XTTS-v2 — Fully Offline
Requires: `pip install TTS`, ~4 GB VRAM

```bash
npm run forge -- run voice.clone --input audio=reference.wav --input text="Hello in my cloned voice"
```

---

## Speech-to-Text

### Whisper (Local)
Requires: `pip install faster-whisper`

```bash
npm run forge -- run voice.stt --input src=audio.mp3
```

### With Speaker Diarization
Requires: `pip install faster-whisper pyannote.audio`

```bash
npm run forge -- run voice.diarize --input src=interview.mp3
```

---

## Voice Verification

After generating any voice, verify it:

```bash
npm run forge -- run audio.verify --input src=speech.mp3 --input engine=heuristic
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `edge-tts not installed` | `python -m pip install edge-tts` |
| `Voicebox unreachable` | Start server: `voice.voicebox_server --input action=start` |
| `Kokoro version error` | Use Python 3.10-3.12 (not 3.13) |
| `CUDA out of memory` | Use smaller engine (kokoro) or CPU mode |
| `No GPU detected` | Use Edge-TTS or CPU-only PyTorch |
