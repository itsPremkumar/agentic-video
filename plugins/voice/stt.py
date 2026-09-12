"""
voice.stt — speech to text.

Requires an explicit `engine`. If the engine is not installed the plugin
FAILEDs with MISSING_DEPENDENCY and the exact install command. It never
pretends to transcribe.
"""
from __future__ import annotations

import json
import os

from forge_py.runtime import PluginFailure, artifact, ok, out_path, require_file

MANIFEST = {
    "id": "voice.stt",
    "name": "Speech to text",
    "category": "voice",
    "description": "Transcribe speech from an audio/video file using faster-whisper.",
    "version": "1.0.0",
    "engine": "python",
    "inputs": {
        "src": {"type": "string", "required": True, "description": "Audio or video file to transcribe."},
        "engine": {
            "type": "string",
            "description": "Transcription engine.",
            "enum": ["faster-whisper"],
            "default": "faster-whisper",
        },
        "model": {"type": "string", "description": "Model size.", "default": "base"},
        "language": {"type": "string", "description": "Language code, e.g. 'en'. Empty = auto-detect.", "default": ""},
        "out": {"type": "string", "description": "Output JSON file name.", "default": "transcript.json"},
    },
    "outputs": [{"kind": "data", "description": "Transcript with per-segment timings."}],
}


def run(input: dict, ctx: dict) -> dict:
    engine = input.get("engine") or "faster-whisper"
    if engine != "faster-whisper":
        raise PluginFailure(
            code="UNKNOWN_ENGINE",
            message=f'Unsupported STT engine "{engine}".',
            input={"engine": engine},
            retryable=True,
            hint="Supported engines: faster-whisper",
        )

    src = require_file(str(input.get("src") or ""), "src")

    try:
        from faster_whisper import WhisperModel  # noqa: F401
    except ImportError as exc:
        raise PluginFailure(
            code="MISSING_DEPENDENCY",
            message="faster-whisper is not installed.",
            reason=str(exc),
            input={"engine": engine, "src": src},
            retryable=False,
            hint="Install it with:  python -m pip install faster-whisper",
        )

    model_name = input.get("model") or "base"
    language = input.get("language") or None

    try:
        from faster_whisper import WhisperModel

        model = WhisperModel(model_name)
        segments, info = model.transcribe(src, language=language)
        rows = [
            {"start": round(float(s.start), 3), "end": round(float(s.end), 3), "text": s.text.strip()}
            for s in segments
        ]
        detected = getattr(info, "language", None)
    except Exception as exc:  # noqa: BLE001
        raise PluginFailure(
            code="STT_FAILED",
            message=f"Transcription failed: {exc}",
            reason=str(exc),
            input={"engine": engine, "model": model_name, "src": src},
            retryable=True,
        )

    dest = out_path(ctx, input.get("out") or "transcript.json")
    payload = {
        "source": src,
        "engine": engine,
        "model": model_name,
        "language": detected,
        "text": " ".join(r["text"] for r in rows).strip(),
        "segments": rows,
    }
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

    return ok(
        [artifact(dest, "data", segments=len(rows), language=detected)],
        [f"Detected language: {detected}"] if detected else [],
    )
