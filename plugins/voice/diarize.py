"""
voice.diarize — speech to text with speaker labels.

Extends voice.stt with speaker diarization using pyannote.audio.
Each transcript segment is tagged with a speaker ID (SPEAKER_00, SPEAKER_01, ...).

Requires faster-whisper and pyannote.audio. If either is missing the plugin
fails with MISSING_DEPENDENCY and the exact install command.
"""
from __future__ import annotations

import json
import os

from forge_py.runtime import PluginFailure, artifact, ok, out_path, require_file

MANIFEST = {
    "id": "voice.diarize",
    "name": "Speech to text with speaker diarization",
    "category": "voice",
    "description": "Transcribe speech and identify who spoke when. Returns per-segment speaker labels.",
    "version": "1.0.0",
    "engine": "python",
    "inputs": {
        "src": {"type": "string", "required": True, "description": "Audio or video file to transcribe."},
        "model": {"type": "string", "description": "Whisper model size.", "default": "base"},
        "language": {"type": "string", "description": "Language code, e.g. 'en'. Empty = auto-detect.", "default": ""},
        "min_speakers": {"type": "integer", "description": "Minimum expected speakers (0 = auto).", "default": 0},
        "max_speakers": {"type": "integer", "description": "Maximum expected speakers (0 = auto).", "default": 0},
        "out": {"type": "string", "description": "Output JSON file name.", "default": "diarization.json"},
    },
    "outputs": [{"kind": "data", "description": "Transcript with per-segment timings and speaker labels."}],
}


def run(input: dict, ctx: dict) -> dict:
    src = require_file(str(input.get("src") or ""), "src")

    # Check faster-whisper
    try:
        from faster_whisper import WhisperModel  # noqa: F401
    except ImportError as exc:
        raise PluginFailure(
            code="MISSING_DEPENDENCY",
            message="faster-whisper is not installed.",
            reason=str(exc),
            input={"src": src},
            retryable=False,
            hint="Install it with:  python -m pip install faster-whisper",
        )

    # Check pyannote.audio
    try:
        from pyannote.audio import Pipeline  # noqa: F401
    except ImportError as exc:
        raise PluginFailure(
            code="MISSING_DEPENDENCY",
            message="pyannote.audio is not installed.",
            reason=str(exc),
            input={"src": src},
            retryable=False,
            hint="Install it with:  python -m pip install pyannote.audio",
        )

    model_name = input.get("model") or "base"
    language = input.get("language") or None
    min_speakers = int(input.get("min_speakers") or 0) or None
    max_speakers = int(input.get("max_speakers") or 0) or None

    # Step 1: Transcribe with Whisper
    try:
        from faster_whisper import WhisperModel

        model = WhisperModel(model_name)
        segments, info = model.transcribe(src, language=language)
        whisper_segments = [
            {"start": round(float(s.start), 3), "end": round(float(s.end), 3), "text": s.text.strip()}
            for s in segments
        ]
        detected = getattr(info, "language", None)
    except Exception as exc:  # noqa: BLE001
        raise PluginFailure(
            code="TRANSCRIPTION_FAILED",
            message=f"Transcription failed: {exc}",
            reason=str(exc),
            input={"model": model_name, "src": src},
            retryable=True,
        )

    # Step 2: Run diarization
    try:
        from pyannote.audio import Pipeline

        pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=None)
        if pipeline is None:
            raise RuntimeError("Could not load pyannote/speaker-diarization-3.1 pipeline.")

        diarization = pipeline(src, min_speakers=min_speakers, max_speakers=max_speakers)

        # Build speaker segments
        speaker_segments = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            speaker_segments.append({
                "start": round(float(turn.start), 3),
                "end": round(float(turn.end), 3),
                "speaker": speaker,
            })
    except Exception as exc:  # noqa: BLE001
        raise PluginFailure(
            code="DIARIZATION_FAILED",
            message=f"Speaker diarization failed: {exc}",
            reason=str(exc),
            input={"src": src},
            retryable=True,
            hint="Ensure pyannote.audio is installed and the model weights are downloaded.",
        )

    # Step 3: Match whisper segments to speakers
    def get_dominant_speaker(start: float, end: float) -> str | None:
        """Find the speaker who occupies the majority of the time range."""
        best_speaker = None
        best_overlap = 0.0
        for spk in speaker_segments:
            overlap_start = max(start, spk["start"])
            overlap_end = min(end, spk["end"])
            overlap = max(0, overlap_end - overlap_start)
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = spk["speaker"]
        return best_speaker

    for seg in whisper_segments:
        seg["speaker"] = get_dominant_speaker(seg["start"], seg["end"])

    # Collect unique speakers
    speakers = sorted({s["speaker"] for s in whisper_segments if s["speaker"]})

    dest = out_path(ctx, input.get("out") or "diarization.json")
    payload = {
        "source": src,
        "model": model_name,
        "language": detected,
        "speakers": speakers,
        "speakerCount": len(speakers),
        "text": " ".join(r["text"] for r in whisper_segments).strip(),
        "segments": whisper_segments,
    }
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

    return ok(
        [artifact(dest, "data", segments=len(whisper_segments), speakers=len(speakers), language=detected)],
        [f"Detected {len(speakers)} speaker(s), language: {detected}"] if detected else [f"Detected {len(speakers)} speaker(s)"],
    )
