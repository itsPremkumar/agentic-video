# Voicebox Setup Guide

## System Check Results

Your machine has:
- **CUDA 12.6** toolkit installed
- **Python 3.12** available at `C:\Python312\python.exe`
- **NVIDIA GPU** present (driver check requires running `nvidia-smi` directly on your machine)

## One-Command Setup

Open **PowerShell** in your `VideoForge` folder and run:

```powershell
node scripts/setup-voicebox.mjs --cuda cu126
```

This will:
1. Detect Python 3.12 automatically
2. Create `.venv-voicebox` with the correct interpreter
3. Install PyTorch with **CUDA 12.6** support (~2.6 GB download)
4. Install all Voicebox dependencies (FastAPI, transformers, kokoro, etc.)
5. Verify CUDA is accessible

> **Note:** The first run downloads ~3 GB of ML packages. Time depends on your internet speed (typically 10-30 minutes).

---

## Manual Setup (if the script fails)

```powershell
# 1. Create venv with Python 3.12
C:\Python312\python.exe -m venv .venv-voicebox

# 2. Activate
.venv-voicebox\Scripts\Activate.ps1

# 3. Upgrade pip
python -m pip install --upgrade pip

# 4. Install PyTorch with CUDA 12.6
python -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu126

# 5. Install Voicebox requirements
python -m pip install -r vendor\voicebox\speech\requirements.txt

# 6. Verify GPU
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); print(f'Device: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"CPU\"}')"
```

---

## Generate Your First Voice

After setup, in a **new** PowerShell window:

```powershell
# Set the environment variable (one-time per session)
$env:VOICEBOX_PYTHON="C:\one\VideoForge\.venv-voicebox\Scripts\python.exe"

# Start the Voicebox server
npx tsx bin/forge.ts run voice.voicebox_server --input action=start

# In another terminal, generate speech with Kokoro
npx tsx bin/forge.ts run voice.voicebox_kokoro `
  --input text="Hello, this is a test of the Kokoro voice engine on my GPU." `
  --input profile=af_heart `
  --input out=kokoro-test.wav
```

The audio file will appear in your `output/` folder.

---

## Available Kokoro Voices

| Voice ID | Name | Gender | Accent |
|----------|------|--------|--------|
| `af_heart` | Heart | Female | American |
| `af_bella` | Bella | Female | American |
| `af_sarah` | Sarah | Female | American |
| `am_adam` | Adam | Male | American |
| `am_echo` | Echo | Male | American |
| `bf_emma` | Emma | Female | British |
| `bf_alice` | Alice | Female | British |
| `bm_daniel` | Daniel | Male | British |
| `bm_george` | George | Male | British |

Use any of these as the `profile` parameter.

---

## Engine Comparison

| Engine | Plugin | VRAM | Speed | Best For |
|--------|--------|------|-------|----------|
| **Kokoro** | `voice.voicebox_kokoro` | ~0.8 GB | Fastest | Narration, default |
| **Qwen** | `voice.voicebox_qwen` | ~3.6 GB | Medium | Quality narration |
| **Chatterbox** | `voice.voicebox_chatterbox` | ~3.2 GB | Medium | Multilingual clone |
| **Chatterbox Turbo** | `voice.voicebox_chatterbox_turbo` | ~3.8 GB | Fast | Quick cloning |
| **Qwen Custom** | `voice.voicebox_qwen_custom` | ~3.6 GB | Medium | Custom voice clone |
| **LuxTTS** | `voice.voicebox_luxtts` | Varies | Slow | Premium quality |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Python 3.13 detected` | Use `--python C:\Python312\python.exe` or reinstall with Python 3.12 |
| `CUDA not available` | Check `nvidia-smi` works. Reinstall PyTorch with correct CUDA version |
| `Out of memory` | Use Kokoro (~0.8 GB) instead of larger engines, or add `--input engine=kokoro` |
| `Port 17493 in use` | Stop existing server: `npx tsx bin/forge.ts run voice.voicebox_server --input action=stop` |
| `Kokoro not found` | Kokoro requires Python 3.10-3.12. Python 3.13 is not supported |

---

## Permanent Environment Variable (Windows)

To avoid setting `$env:VOICEBOX_PYTHON` every session:

```powershell
[Environment]::SetEnvironmentVariable("VOICEBOX_PYTHON", "C:\one\VideoForge\.venv-voicebox\Scripts\python.exe", "User")
```

Restart your terminal after running this.
