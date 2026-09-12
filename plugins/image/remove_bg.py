"""
image.remove_bg - local rembg background removal.
Engine: python (manifest sibling `remove_bg.json`).
"""
import json
import sys
from pathlib import Path

# Make py/ importable so we can raise PluginFailure through the bridge.
_HERE = Path(__file__).resolve().parent.parent / "py"
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from forge_py.runtime import PluginFailure  # noqa: E402

MANIFEST_PATH = Path(__file__).with_suffix('.json')

def _manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

MANIFEST = _manifest()
MODULE = Path(__file__).name


def run(input: dict, ctx: dict) -> dict:
    file = input["file"]
    out = input.get("out", "no-bg.png")
    model = input.get("model", "u2net")
    try:
        from rembg import remove  # type: ignore
    except Exception as e:
        raise PluginFailure(
            code="REMBG_NOT_INSTALLED",
            message="rembg is not installed in Agentic Video's Python.",
            reason=str(e),
            input=input,
            hint="Install with: pip install rembg[gpu]   (or rembg for CPU)",
            retryable=False,
        )
    try:
        from PIL import Image  # type: ignore
    except Exception as e:
        raise PluginFailure(
            code="PIL_NOT_INSTALLED",
            message="Pillow is required by rembg.",
            reason=str(e),
            input=input,
            hint="Install with: pip install pillow",
            retryable=False,
        )

    try:
        src = Image.open(file)
        out_img = remove(src, model=model)
        out_path = Path(out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_img.save(str(out_path))
        return {
            "outputs": [
                {
                    "path": str(out_path),
                    "kind": "image",
                    "meta": {
                        "model": model,
                        "input": str(src.size),
                        "output": str(out_img.size),
                        "mode": str(out_img.mode),
                    },
                }
            ],
            "warnings": [],
        }
    except Exception as e:
        raise PluginFailure(
            code="REMBG_FAILED",
            message="Background removal failed.",
            reason=str(e),
            input=input,
            retryable=False,
        )


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "describe":
        print(json.dumps(describe()))
    elif cmd == "run":
        payload = json.loads(sys.argv[2])
        print(json.dumps(run(payload["input"], payload.get("ctx", {}))))
    else:
        print(json.dumps({"ok": False, "error": {"code": "UNKNOWN_CMD", "message": cmd}}))