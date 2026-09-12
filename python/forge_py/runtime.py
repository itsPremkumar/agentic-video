"""
forge_py.runtime — shared helpers for Agentic Video Python plugins.

Every Python plugin module exposes:

    MANIFEST = { "id": ..., "name": ..., "category": ..., "description": ...,
                 "version": ..., "engine": "python",
                 "inputs": { "text": {"type": "string", "required": True} },
                 "outputs": [{"kind": "audio"}] }

    def run(input: dict, ctx: dict) -> dict:
        return {"outputs": [{"path": "...", "kind": "audio"}], "warnings": []}

Raising PluginFailure produces a structured FAILED acknowledgement. There is no
fallback: if a plugin cannot do what was asked, it fails loudly.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from typing import Any

MIME = {
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
    ".mkv": "video/x-matroska", ".gif": "image/gif",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".bmp": "image/bmp",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".aac": "audio/aac",
    ".m4a": "audio/mp4", ".flac": "audio/flac", ".ogg": "audio/ogg",
    ".srt": "application/x-subrip", ".vtt": "text/vtt",
    ".json": "application/json", ".txt": "text/plain",
}


class PluginFailure(Exception):
    """Structured, reportable failure. Never retried or worked around."""

    def __init__(
        self,
        code: str,
        message: str,
        reason: str | None = None,
        input: Any = None,
        detail: str | None = None,
        retryable: bool = False,
        hint: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.reason = reason
        self.input = input
        self.detail = detail
        self.retryable = retryable
        self.hint = hint

    def as_dict(self) -> dict:
        return {
            "code": self.code,
            "message": self.message,
            "reason": self.reason,
            "input": self.input,
            "detail": self.detail,
            "retryable": self.retryable,
            "hint": self.hint,
        }


def mime_for(path: str) -> str | None:
    return MIME.get(os.path.splitext(path)[1].lower())


def artifact(path: str, kind: str, **meta: Any) -> dict:
    out = {"path": os.path.abspath(path), "kind": kind, "mime": mime_for(path)}
    if meta:
        out["meta"] = meta
    return out


def ok(outputs: list[dict] | None = None, warnings: list[str] | None = None) -> dict:
    return {"ok": True, "outputs": outputs or [], "warnings": warnings or []}


def out_path(ctx: dict, name: str) -> str:
    """Deterministic output path for this plugin.

    Mirrors the TypeScript `makeOut()` rules in core/artifacts.ts so TS and
    Python plugins behave identically:

      - empty / missing       -> `<pluginDir>/output`
      - absolute path         -> used as-is
      - contains a separator  -> resolved relative to cwd (the caller gave a
                                 real path; do NOT nest it inside
                                 `<pluginDir>`, which produces the classic
                                 `artifacts/<plugin>/workspace/...` bug)
      - bare filename         -> `<pluginDir>/<name>`
    """
    base = ctx.get("workspaceDir") or os.path.join(os.getcwd(), "workspace")
    plugin_id = str(ctx.get("pluginId") or "python").replace(".", "_")
    directory = os.path.join(base, "artifacts", plugin_id)
    os.makedirs(directory, exist_ok=True)

    n = str(name or "").strip()
    if not n:
        return os.path.join(directory, "output")
    if os.path.isabs(n):
        return n
    # Normalise both separator styles so a forward-slash path still counts.
    if "/" in n or "\\" in n:
        return os.path.abspath(n)
    return os.path.join(directory, n)


def which(binary: str) -> str:
    found = shutil.which(binary)
    if not found:
        raise PluginFailure(
            code="MISSING_BINARY",
            message=f'Required binary "{binary}" was not found on PATH.',
            reason="The executable could not be located.",
            retryable=False,
            hint=f"Install {binary} and ensure it is on PATH, or set its path in .env.",
        )
    return found


def run_cmd(
    cmd: list[str],
    timeout: int = 600,
) -> subprocess.CompletedProcess[str]:
    """Run a subprocess, capturing output. Non-zero exit raises PluginFailure."""
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise PluginFailure(
            code="TIMEOUT",
            message=f"Command timed out after {timeout}s: {' '.join(cmd[:4])}",
            retryable=True,
            hint="Reduce the input size or raise the timeout.",
        )
    except FileNotFoundError as exc:
        raise PluginFailure(
            code="MISSING_BINARY",
            message=f"Could not execute: {cmd[0]}",
            reason=str(exc),
            retryable=False,
            hint=f"Install {cmd[0]} and ensure it is on PATH.",
        )
    if proc.returncode != 0:
        raise PluginFailure(
            code="COMMAND_FAILED",
            message=f"Command failed with exit code {proc.returncode}: {' '.join(cmd[:6])}",
            reason=(proc.stderr or proc.stdout or "").strip().split("\n")[-1][:400],
            detail=(proc.stderr or proc.stdout or "").strip(),
            retryable=True,
        )
    return proc


def ffmpeg(ctx: dict, args: list[str], timeout: int = 600) -> subprocess.CompletedProcess[str]:
    binary = ctx.get("ffmpeg") or which("ffmpeg")
    return run_cmd([binary, "-hide_banner", "-loglevel", "error", *args], timeout=timeout)


def ffprobe(ctx: dict, args: list[str], timeout: int = 120) -> subprocess.CompletedProcess[str]:
    binary = ctx.get("ffprobe") or which("ffprobe")
    return run_cmd([binary, "-hide_banner", "-loglevel", "error", *args], timeout=timeout)


def require_file(path: str, label: str = "input file") -> str:
    if not path or not os.path.exists(path):
        raise PluginFailure(
            code="FILE_NOT_FOUND",
            message=f"{label} not found: {path}",
            reason="The path does not exist on disk.",
            input={label: path},
            retryable=True,
            hint="Pass an absolute path to an existing file.",
        )
    return os.path.abspath(path)


def dump(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)
