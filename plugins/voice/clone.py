"""
voice.clone — synthesise speech in a cloned voice from a reference sample.

Requires the Coqui TTS library (pip install TTS) and a reference audio of at
least ~10 seconds of clean speech. If the library is not installed, this
plugin fails EXPLICITLY with an install hint — it never silently falls back.

Output format is WAV by default. The model used is XTTS-v2 (multi-lingual,
supports voice cloning from a 6+ second reference clip).
"""
from __future__ import annotations

import importlib.util as _u
import os
from forge_py.runtime import PluginFailure, artifact, ok


MANIFEST = {
    "id": "voice.clone",
    "name": "Clone a voice from a reference audio",
    "category": "voice",
    "description": "Synthesise speech in a cloned voice using Coqui XTTS-v2. Requires 'pip install TTS' and a reference audio.",
    "inputs": {
        "refAudio": {"type": "string", "required": True, "description": "Reference audio path (10s+ clean speech, WAV/MP3)."},
        "text": {"type": "string", "required": True, "description": "Text to speak in the cloned voice."},
        "language": {"type": "string", "default": "en", "description": "Language code (en, es, fr, de, it, pt, pl, tr, ru, nl, cs, ar, zh-cn, ja, ko, hu, hi)."},
        "out": {"type": "string", "default": "cloned.wav", "description": "Output file name."},
    },
    "outputs": [{"kind": "audio", "description": "Cloned-voice audio."}],
}


def _require_tts():
    if _u.find_spec("TTS") is None:
        raise PluginFailure(
            code="TTS_NOT_INSTALLED",
            message="Coqui TTS is not installed.",
            reason="voice.clone requires the Coqui TTS Python library and a downloaded XTTS-v2 model.",
            retryable=False,
            hint="Install with: pip install TTS && tts --model_name tts_models/multilingual/multi-dataset/xtts_v2",
        )


def run(input, ctx):
    ref_audio = (input.get("refAudio") or "").strip()
    text = (input.get("text") or "").strip()
    language = (input.get("language") or "en").strip() or "en"

    if not ref_audio:
        raise PluginFailure(code="INVALID_INPUT", message="refAudio is required.", retryable=True)
    if not os.path.exists(ref_audio):
        raise PluginFailure(code="FILE_NOT_FOUND", message=f"refAudio not found: {ref_audio}", retryable=True)
    if not text:
        raise PluginFailure(code="INVALID_INPUT", message="text is required.", retryable=True)

    _require_tts()

    out_name = input.get("out") or "cloned.wav"
    out_path = ctx.get("out", out_name)
    if not os.path.isabs(out_path):
        out_path = os.path.join(ctx.get("workspaceDir", "."), out_path)

    # Late import — keep import-time errors outside the plugin load phase.
    from TTS.api import TTS  # type: ignore

    try:
        tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2", gpu=False).to("cpu")
        tts.tts_to_file(
            text=text,
            speaker_wav=ref_audio,
            language=language,
            file_path=out_path,
        )
    except Exception as exc:  # noqa: BLE001 — every error is reported
        raise PluginFailure(
            code="CLONE_FAILED",
            message="XTTS cloning failed.",
            reason=f"{type(exc).__name__}: {exc}",
            retryable=True,
            hint="Check that the reference audio is clean speech, 6-30s long, and the XTTS-v2 model is downloaded.",
        ) from exc

    return ok([artifact(out_path, "audio", mime="audio/wav", meta={"engine": "xtts-v2", "language": language})])
