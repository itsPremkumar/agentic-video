"""
voice.list_voices — enumerate the Edge-TTS voices available on this machine.
Useful before calling voice.tts so the agent can pick a valid voice id.
"""
from __future__ import annotations

import asyncio
import json

from forge_py.runtime import PluginFailure, artifact, ok, out_path

MANIFEST = {
    "id": "voice.list_voices",
    "name": "List TTS voices",
    "category": "voice",
    "description": "List available Edge-TTS voices, optionally filtered by locale (e.g. en-US).",
    "version": "1.0.0",
    "engine": "python",
    "inputs": {
        "locale": {"type": "string", "description": "Filter prefix, e.g. 'en' or 'en-US'.", "default": ""},
        "out": {"type": "string", "description": "Output JSON file name.", "default": "voices.json"},
    },
    "outputs": [{"kind": "data", "description": "JSON list of voices."}],
}


def run(input: dict, ctx: dict) -> dict:
    try:
        import edge_tts
    except ImportError as exc:
        raise PluginFailure(
            code="MISSING_DEPENDENCY",
            message="edge-tts is not installed.",
            reason=str(exc),
            retryable=False,
            hint="Install it with:  python -m pip install edge-tts",
        )

    async def _list():
        return await edge_tts.list_voices()

    try:
        voices = asyncio.run(_list())
    except Exception as exc:  # noqa: BLE001
        raise PluginFailure(
            code="VOICE_LIST_FAILED",
            message=f"Could not retrieve the voice list: {exc}",
            reason=str(exc),
            retryable=True,
            hint="Check network access — Edge-TTS fetches its voice list online.",
        )

    locale = (input.get("locale") or "").strip()
    if locale:
        voices = [v for v in voices if str(v.get("Locale", "")).startswith(locale)]

    dest = out_path(ctx, input.get("out") or "voices.json")
    rows = [
        {
            "id": v.get("ShortName"),
            "locale": v.get("Locale"),
            "gender": v.get("Gender"),
            "friendlyName": v.get("FriendlyName"),
        }
        for v in voices
    ]
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False, indent=2)

    return ok([artifact(dest, "data", count=len(rows))])
