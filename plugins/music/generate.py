"""
music.generate — synthesise royalty-free background music procedurally.

Uses numpy to render a simple chord progression with a soft attack envelope.
No network, no API key, fully deterministic for a given seed.
"""
from __future__ import annotations

import math
import os
import struct
import wave

from forge_py.runtime import PluginFailure, artifact, ok, out_path

MANIFEST = {
    "id": "music.generate",
    "name": "Generate background music",
    "category": "music",
    "description": "Synthesise a simple royalty-free background track (WAV) procedurally.",
    "version": "1.0.0",
    "engine": "python",
    "inputs": {
        "duration": {"type": "number", "description": "Duration in seconds.", "default": 20},
        "bpm": {"type": "number", "description": "Tempo in beats per minute.", "default": 90},
        "key": {
            "type": "string",
            "description": "Root note: C, D, E, F, G, A, or B.",
            "default": "A",
        },
        "mood": {"type": "string", "description": "Progression mood.", "enum": ["calm", "hopeful", "tense"], "default": "calm"},
        "volume": {"type": "number", "description": "Peak amplitude 0..1.", "default": 0.25},
        "out": {"type": "string", "description": "Output file name.", "default": "music.wav"},
    },
    "outputs": [{"kind": "audio", "description": "Generated WAV music bed."}],
}

NOTE_HZ = {"C": 261.63, "D": 293.66, "E": 329.63, "F": 349.23, "G": 392.00, "A": 440.00, "B": 493.88}

# Semitone offsets from the root for each chord in the progression.
PROGRESSIONS = {
    "calm": [[0, 4, 7, 11], [-3, 2, 5, 9], [-5, 0, 4, 7], [-1, 2, 7, 11]],
    "hopeful": [[0, 4, 7], [5, 9, 12], [-3, 2, 7], [2, 7, 11]],
    "tense": [[0, 3, 6], [-1, 2, 6], [0, 5, 8], [-2, 1, 6]],
}


def run(input: dict, ctx: dict) -> dict:
    duration = float(input.get("duration") or 20)
    if duration <= 0:
        raise PluginFailure(
            code="INVALID_INPUT",
            message="duration must be greater than 0.",
            input={"duration": duration},
            retryable=True,
        )
    bpm = float(input.get("bpm") or 90)
    key = str(input.get("key") or "A").upper()
    mood = str(input.get("mood") or "calm")
    volume = float(input.get("volume") or 0.25)

    if key not in NOTE_HZ:
        raise PluginFailure(
            code="INVALID_INPUT",
            message=f'Unknown key "{key}".',
            input={"key": key},
            retryable=True,
            hint="Supported keys: " + ", ".join(NOTE_HZ),
        )
    if mood not in PROGRESSIONS:
        raise PluginFailure(
            code="INVALID_INPUT",
            message=f'Unknown mood "{mood}".',
            input={"mood": mood},
            retryable=True,
            hint="Supported moods: " + ", ".join(PROGRESSIONS),
        )

    root = NOTE_HZ[key]
    chords = PROGRESSIONS[mood]
    sample_rate = 44100
    beat = 60.0 / max(1.0, bpm)
    total = int(duration * sample_rate)
    buf = [0.0] * total

    chord_index = 0
    t = 0.0
    while t < duration:
        chord = chords[chord_index % len(chords)]
        chord_index += 1
        for semitone in chord:
            freq = root * (2 ** (semitone / 12.0))
            start = int(t * sample_rate)
            length = int(min(beat * 2, duration - t) * sample_rate)
            if length <= 0:
                break
            for i in range(length):
                progress = i / length
                # Soft attack, long release — gentle pad.
                env = math.sin(math.pi * progress) ** 1.5
                if env <= 0:
                    continue
                phase_i = start + i
                if phase_i >= total:
                    break
                value = math.sin(2 * math.pi * freq * (i / sample_rate))
                # Add a quiet octave and fifth for warmth.
                value += 0.4 * math.sin(2 * math.pi * freq * 2 * (i / sample_rate))
                value += 0.2 * math.sin(2 * math.pi * freq * 1.5 * (i / sample_rate))
                buf[phase_i] += value * env * (volume / max(1, len(chord)))
        t += beat * 2

    # Soft clip to avoid harsh clipping.
    peak = max(1e-6, max(abs(v) for v in buf))
    scale = min(1.0, volume / peak)

    dest = out_path(ctx, input.get("out") or "music.wav")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with wave.open(dest, "w") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        frames = bytearray()
        for v in buf:
            sample = int(max(-1.0, min(1.0, v * scale)) * 32767)
            frames += struct.pack("<h", sample)
        wav.writeframes(bytes(frames))

    return ok([artifact(dest, "audio", durationSeconds=duration, bpm=bpm, key=key, mood=mood)])
