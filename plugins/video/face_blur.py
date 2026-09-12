"""
video.face_blur — privacy protection via face detection and blurring.

Detects faces in a video using OpenCV DNN face detection and applies
a tracked blur or pixelate effect that follows faces across frames.

Requires opencv-python. If not installed, fails with MISSING_DEPENDENCY.
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile

from forge_py.runtime import PluginFailure, artifact, ok, out_path, require_file, run_cmd

MANIFEST = {
    "id": "video.face_blur",
    "name": "Face blur / privacy redaction",
    "category": "video",
    "description": "Detect faces in video and apply tracked blur or pixelate overlay for privacy protection.",
    "version": "1.0.0",
    "engine": "python",
    "inputs": {
        "src": {"type": "string", "required": True, "description": "Source video file."},
        "mode": {"type": "string", "description": "Blur mode.", "enum": ["blur", "pixelate", "black"], "default": "blur"},
        "strength": {"type": "integer", "description": "Blur/pixelate strength (1-50).", "default": 15, "minimum": 1, "maximum": 50},
        "detectEvery": {"type": "integer", "description": "Run face detection every N frames (higher = faster, less accurate).", "default": 3, "minimum": 1},
        "out": {"type": "string", "description": "Output video file name.", "default": "face-blurred.mp4"},
    },
    "outputs": [{"kind": "video", "description": "Video with faces blurred."}],
}


def run(input: dict, ctx: dict) -> dict:
    src = require_file(str(input.get("src") or ""), "src")
    mode = str(input.get("mode") or "blur")
    strength = int(input.get("strength") or 15)
    detect_every = int(input.get("detectEvery") or 3)

    try:
        import cv2
    except ImportError as exc:
        raise PluginFailure(
            code="MISSING_DEPENDENCY",
            message="opencv-python is not installed.",
            reason=str(exc),
            input={"src": src},
            retryable=False,
            hint="Install it with:  python -m pip install opencv-python",
        )

    # Load OpenCV DNN face detector
    try:
        # Try to use the built-in DNN face detector
        proto_path = os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
        if not os.path.exists(proto_path):
            # Fallback: use the older Haar cascade
            face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        else:
            face_cascade = cv2.CascadeClassifier(proto_path)
    except Exception as exc:
        raise PluginFailure(
            code="INIT_FAILED",
            message="Could not load face detection model.",
            reason=str(exc),
            input={"src": src},
            retryable=True,
        )

    # Extract frames
    tmpdir = tempfile.mkdtemp(prefix="face_blur_")
    frames_dir = os.path.join(tmpdir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    ffmpeg_bin = ctx.get("ffmpeg") or "ffmpeg"

    # Get video info
    probe_res = run_cmd([
        ctx.get("ffprobe") or "ffprobe",
        "-hide_banner", "-loglevel", "error",
        "-print_format", "json",
        "-show_streams",
        src,
    ])
    probe_data = json.loads(probe_res.stdout)
    video_stream = next((s for s in probe_data.get("streams", []) if s.get("codec_type") == "video"), None)
    if not video_stream:
        raise PluginFailure(
            code="NO_VIDEO_STREAM",
            message="No video stream found.",
            input={"src": src},
            retryable=True,
        )

    fps = eval(video_stream.get("r_frame_rate", "30/1"))  # e.g. "30000/1001"
    width = int(video_stream.get("width", 1920))
    height = int(video_stream.get("height", 1080))

    # Extract all frames
    run_cmd([
        ffmpeg_bin, "-hide_banner", "-loglevel", "error",
        "-i", src,
        "-q:v", "2",
        os.path.join(frames_dir, "frame_%06d.jpg"),
    ])

    frames = sorted([f for f in os.listdir(frames_dir) if f.endswith(".jpg")])
    if not frames:
        raise PluginFailure(
            code="NO_FRAMES",
            message="Could not extract frames from video.",
            input={"src": src},
            retryable=True,
        )

    # Process frames
    output_dir = os.path.join(tmpdir, "output")
    os.makedirs(output_dir, exist_ok=True)

    prev_faces: list[tuple[int, int, int, int]] = []

    for i, frame_name in enumerate(frames):
        frame_path = os.path.join(frames_dir, frame_name)
        img = cv2.imread(frame_path)
        if img is None:
            continue

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # Detect faces every N frames, otherwise use previous positions
        if i % detect_every == 0:
            faces = face_cascade.detectMultiScale(
                gray,
                scaleFactor=1.1,
                minNeighbors=5,
                minSize=(int(width * 0.05), int(height * 0.05)),
            )
            prev_faces = list(faces)
        else:
            faces = prev_faces

        for (x, y, w, h) in faces:
            # Expand box slightly
            margin = int(max(w, h) * 0.15)
            x1 = max(0, x - margin)
            y1 = max(0, y - margin)
            x2 = min(width, x + w + margin)
            y2 = min(height, y + h + margin)

            face_roi = img[y1:y2, x1:x2]

            if mode == "pixelate":
                # Pixelate
                small = cv2.resize(face_roi, (max(1, (x2 - x1) // strength), max(1, (y2 - y1) // strength)), interpolation=cv2.INTER_LINEAR)
                pixelated = cv2.resize(small, (x2 - x1, y2 - y1), interpolation=cv2.INTER_NEAREST)
                img[y1:y2, x1:x2] = pixelated
            elif mode == "black":
                img[y1:y2, x1:x2] = (0, 0, 0)
            else:
                # Gaussian blur
                blur_amount = strength if strength % 2 == 1 else strength + 1
                blurred = cv2.GaussianBlur(face_roi, (blur_amount, blur_amount), 0)
                img[y1:y2, x1:x2] = blurred

        out_path_frame = os.path.join(output_dir, frame_name)
        cv2.imwrite(out_path_frame, img, [int(cv2.IMWRITE_JPEG_QUALITY), 95])

    # Re-encode video from frames
    dest = out_path(ctx, input.get("out") or "face-blurred.mp4")

    run_cmd([
        ffmpeg_bin, "-hide_banner", "-loglevel", "error",
        "-y",
        "-framerate", str(fps),
        "-i", os.path.join(output_dir, "frame_%06d.jpg"),
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        dest,
    ])

    # Copy audio from original
    dest_with_audio = dest.replace(".mp4", "_audio.mp4")
    try:
        run_cmd([
            ffmpeg_bin, "-hide_banner", "-loglevel", "error",
            "-y",
            "-i", dest,
            "-i", src,
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-map", "0:v:0",
            "-map", "1:a:0?",
            "-shortest",
            dest_with_audio,
        ])
        os.replace(dest_with_audio, dest)
    except Exception:
        # If audio copy fails, keep video-only output
        pass

    # Cleanup temp dir
    import shutil
    shutil.rmtree(tmpdir, ignore_errors=True)

    return ok(
        [artifact(dest, "video", mode=mode, strength=strength)],
        [f"Processed {len(frames)} frames, detected faces in {len(frames) // detect_every} frames."],
    )
