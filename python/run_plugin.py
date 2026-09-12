#!/usr/bin/env python
"""
run_plugin.py — the Python side of the VideoForge plugin bridge.

  python py/run_plugin.py describe <module.py> [<module.py> ...]
      Prints a JSON array of plugin manifests.

  python py/run_plugin.py run <module.py> <request.json> <response.json>
      Calls the module's run(input, ctx) and writes the result JSON.

Failures are reported, never hidden: an exception becomes
{"ok": false, "error": {...}} with the traceback attached.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import traceback
from pathlib import Path

# Make `py/` importable so plugin modules can `from forge_py.runtime import ...`
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from forge_py.runtime import PluginFailure  # noqa: E402


def load_module(path: str):
    path = os.path.abspath(path)
    if not os.path.exists(path):
        raise FileNotFoundError(f"plugin module not found: {path}")
    name = "vf_plugin_" + Path(path).stem
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load plugin module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def cmd_describe(paths: list[str]) -> int:
    manifests = []
    for p in paths:
        mod = load_module(p)
        manifest = getattr(mod, "MANIFEST", None)
        if manifest is None:
            print(f"warning: {p} has no MANIFEST, skipping", file=sys.stderr)
            continue
        manifest = dict(manifest)
        manifest.setdefault("engine", "python")
        manifest.setdefault("version", "1.0.0")
        manifest.setdefault("inputs", {})
        manifest.setdefault("outputs", [])
        manifest["module"] = os.path.relpath(os.path.abspath(p), _HERE.parent)
        manifests.append(manifest)
    print(json.dumps(manifests, ensure_ascii=False))
    return 0


def cmd_run(module_path: str, request_path: str, response_path: str) -> int:
    with open(request_path, "r", encoding="utf-8") as fh:
        payload = json.load(fh)

    ctx = dict(payload.get("ctx") or {})
    inputs = payload.get("input") or {}

    # Give the plugin a deterministic output directory keyed by its own id.
    try:
        manifest = getattr(load_module(module_path), "MANIFEST", {})
        ctx["pluginId"] = manifest.get("id", Path(module_path).stem)
    except Exception:  # noqa: BLE001 - reported below
        ctx["pluginId"] = Path(module_path).stem

    result: dict
    try:
        mod = load_module(module_path)
        run_fn = getattr(mod, "run", None)
        if run_fn is None:
            raise PluginFailure(
                code="NO_RUN_FUNCTION",
                message=f"{module_path} does not define run(input, ctx).",
                retryable=False,
            )
        out = run_fn(inputs, ctx)
        if not isinstance(out, dict) or "outputs" not in out:
            raise PluginFailure(
                code="BAD_PLUGIN_RESULT",
                message="Plugin run() must return {'outputs': [...], 'warnings': [...]}.",
                retryable=False,
            )
        normalised = [
            {
                "path": os.path.abspath(str(a.get("path", ""))),
                "kind": a.get("kind", "data"),
                "mime": a.get("mime"),
                "meta": a.get("meta"),
            }
            for a in out.get("outputs", [])
            if isinstance(a, dict) and a.get("path")
        ]
        result = {"ok": True, "outputs": normalised, "warnings": out.get("warnings", [])}
    except PluginFailure as exc:
        result = {"ok": False, "error": exc.as_dict()}
    except Exception as exc:  # noqa: BLE001 - full traceback is reported
        result = {
            "ok": False,
            "error": {
                "code": "PYTHON_EXCEPTION",
                "message": str(exc),
                "reason": f"{type(exc).__name__}: {exc}",
                "detail": traceback.format_exc(),
                "retryable": False,
            },
        }

    with open(response_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False)
    return 0 if result.get("ok") else 1


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    command, rest = argv[1], argv[2:]
    if command == "describe":
        return cmd_describe(rest)
    if command == "run":
        if len(rest) != 3:
            print("usage: run_plugin.py run <module.py> <request.json> <response.json>")
            return 2
        return cmd_run(rest[0], rest[1], rest[2])
    print(f"unknown command: {command}")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
