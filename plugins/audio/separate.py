"""
audio.separate — stem separation (voice, music, SFX).

Separates a mixed audio track into individual stems using Demucs.
Useful for repurposing content: isolate voice, replace background music,
remove crowd noise, etc.

Requires demucs. If not installed, fails with MISSING_DEPENDENCY.
"""
from __future__ import annotations

import json
import os
import shutil

from forge_py.runtime import PluginFailure, artifact, ok, out_path, require_file, run_cmd

MANIFEST = {
    "id": "audio.separate",
    "name": "Audio stem separation",
    "category": "audio",
    "description": "Separate mixed audio into voice, music, and SFX stems using Demucs.",
    "version": "1.0.0",
    "engine": "python",
    "inputs": {
        "src": {"type": "string", "required": True, "description": "Audio or video file to separate."},
        "model": {"type": "string", "description": "Demucs model.", "enum": ["htdemucs", "htdemucs_ft", "mdx_extra", "mdx_extra_q"], "default": "htdemucs"},
        "stems": {"type": "string", "description": "Which stems to output.", "enum": ["all", "vocals", "drums", "bass", "other"], "default": "all"},
        "out": {"type": "string", "description": "Output directory name.", "default": "stems"},
    },
    "outputs": [{"kind": "audio", "description": "Separated audio stems."}],
}


def run(input: dict, ctx: dict) -> dict:
    src = require_file(str(input.get("src") or ""), "src")
    model = str(input.get("model") or "htdemucs")
    stems_filter = str(input.get("stems") or "all")

    # Check demucs
    demucs_path = shutil.which("demucs")
    if not demucs_path:
        raise PluginFailure(
            code="MISSING_DEPENDENCY",
            message="demucs is not installed or not on PATH.",
            reason="The demucs command was not found.",
            input={"src": src},
            retryable=False,
            hint="Install it with:  python -m pip install demucs",
        )

    out_dir = out_path(ctx, input.get("out") or "stems")
    os.makedirs(out_dir, exist_ok=True)

    # Run demucs
    try:
        run_cmd([
            demucs_path,
            "--model", model,
            "--out", out_dir,
            "--filename", "{stem}.{ext}",
            src,
        ], timeout=1800)
    except Exception as exc:  # noqa: BLE001
        raise PluginFailure(
            code="SEPARATION_FAILED",
            message=f"Stem separation failed: {exc}",
            reason=str(exc),
            input={"src": src, "model": model},
            retryable=True,
            hint="Ensure the audio file is valid and not corrupted.",
        )

    # Find output files
    # Demucs creates: out_dir/model_name/basename/stem.wav
    stem_files = []
    for root, _dirs, files in os.walk(out_dir):
        for f in files:
            if f.endswith(".wav"):
                stem_name = f.replace(".wav", "")
                if stems_filter != "all" and stem_name != stems_filter:
                    continue
                stem_files.append({
                    "stem": stem_name,
                    "path": os.path.join(root, f),
                })

    if not stem_files:
        raise PluginFailure(
            code="NO_OUTPUT",
            message="No stem files were produced.",
            input={"src": src, "model": model},
            retryable=True,
            hint="Check demucs output in the workspace directory.",
        )

    outputs = []
    for sf in stem_files:
        outputs.append(artifact(sf["path"], "audio", stem=sf["stem"]))

    # Also create a manifest
    manifest_path = os.path.join(out_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump({
            "source": src,
            "model": model,
            "stems": [{"name": sf["stem"], "path": sf["path"]} for sf in stem_files],
        }, fh, indent=2)

    outputs.append(artifact(manifest_path, "data"))

    return ok(
        outputs,
        [f"Separated into {len(stem_files)} stem(s) using {model} model."],
    )
