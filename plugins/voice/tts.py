"""
voice.tts — text to speech using Microsoft Edge-TTS (no API key required).

Explicit by design: if edge-tts is not installed the plugin fails with
MISSING_DEPENDENCY and tells the agent exactly what to install. It never
silently falls back to another engine.
"""
from __future__ import annotations

import asyncio

from forge_py.runtime import PluginFailure, artifact, ok, out_path

MANIFEST = {
    "id": "voice.tts",
    "name": "Text to speech (Edge-TTS)",
    "category": "voice",
    "description": "Synthesise natural speech to an MP3/WAV file using Edge-TTS.",
    "version": "1.0.0",
    "engine": "python",
    "inputs": {
        "text": {"type": "string", "required": True, "description": "Text to speak."},
        "voice": {
            "type": "string",
            "description": "Edge-TTS voice id, e.g. en-US-JennyNeural.",
            "default": "en-US-JennyNeural",
        },
        "rate": {"type": "string", "description": "Rate adjust, e.g. +10%, -20%.", "default": "+0%"},
        "pitch": {"type": "string", "description": "Pitch adjust, e.g. +2Hz.", "default": "+0Hz"},
        "out": {"type": "string", "description": "Output file name.", "default": "speech.mp3"},
    },
    "outputs": [{"kind": "audio", "description": "Synthesised speech file."}],
}


def run(input: dict, ctx: dict) -> dict:
    text = (input.get("text") or "").strip()
    if not text:
        raise PluginFailure(
            code="EMPTY_INPUT",
            message="`text` is empty — nothing to synthesise.",
            reason="No text was supplied.",
            input={"text": text},
            retryable=True,
            hint="Pass a non-empty `text` value.",
        )

    try:
        import edge_tts  # noqa: F401
    except ImportError as exc:
        raise PluginFailure(
            code="MISSING_DEPENDENCY",
            message="edge-tts is not installed.",
            reason=str(exc),
            retryable=False,
            hint="Install it with:  python -m pip install edge-tts",
        )

    voice = input.get("voice") or "en-US-JennyNeural"
    rate = input.get("rate") or "+0%"
    pitch = input.get("pitch") or "+0Hz"
    dest = out_path(ctx, input.get("out") or "speech.mp3")

    async def _synth() -> None:
        import edge_tts

        communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        await communicate.save(dest)

    try:
        asyncio.run(_synth())
    except Exception as exc:  # noqa: BLE001 - surfaced verbatim
        raise PluginFailure(
            code="TTS_FAILED",
            message=f"Edge-TTS failed for voice '{voice}': {exc}",
            reason=str(exc),
            input={"voice": voice, "rate": rate, "pitch": pitch, "textLength": len(text)},
            retryable=True,
            hint="Check the voice id (forge run voice.list_voices) and network access.",
        )

    return ok([artifact(dest, "audio", voice=voice, characters=len(text))])
