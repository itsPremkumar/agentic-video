"""
video.eye_contact — eye gaze correction for talking-head videos.

Makes speakers appear to look directly at the camera by slightly shifting
the eye region. This is a lightweight implementation using OpenCV face
landmarks. For production quality, a dedicated ML model (e.g. NVIDIA Maxine)
would be needed, but this provides a basic working implementation.

Requires opencv-python and dlib (or mediapipe for landmarks).
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile

from forge_py.runtime import PluginFailure, artifact, ok, out_path, require_file, run_cmd

MANIFEST = {
    "id": "video.eye_contact",
    "name": "Eye contact correction",
    "category": "video",
    "description": "Correct eye gaze in talking-head videos so speakers appear to look at camera. Basic implementation using OpenCV face landmarks.",
    "version": "1.0.0",
    "engine": "python",
    "inputs": {
        "src": {"type": "string", "required": True, "description": "Source talking-head video."},
        "strength": {"type": "number", "description": "Correction strength (0.0-1.0). Higher = more aggressive correction.", "default": 0.3, "minimum": 0, "maximum": 1},
        "detectEvery": {"type": "integer", "description": "Run face detection every N frames.", "default": 2, "minimum": 1},
        "out": {"type": "string", "description": "Output video file name.", "default": "eye-contact.mp4"},
    },
    "outputs": [{"kind": "video", "description": "Video with corrected eye gaze."}],
}


def run(input: dict, ctx: dict) -> dict:
    src = require_file(str(input.get("src") or ""), "src")
    strength = float(input.get("strength") or 0.3)
    detect_every = int(input.get("detectEvery") or 2)

    try:
        import cv2
        import numpy as np
    except ImportError as exc:
        raise PluginFailure(
            code="MISSING_DEPENDENCY",
            message="opencv-python and numpy are required.",
            reason=str(exc),
            input={"src": src},
            retryable=False,
            hint="Install with:  python -m pip install opencv-python numpy",
        )

    # Try mediapipe for face landmarks (more accurate than Haar)
    try:
        import mediapipe as mp
        use_mediapipe = True
    except ImportError:
        use_mediapipe = False

    ffmpeg_bin = ctx.get("ffmpeg") or "ffmpeg"
    ffprobe_bin = ctx.get("ffprobe") or "ffprobe"

    # Get video info
    probe_res = run_cmd([
        ffprobe_bin, "-hide_banner", "-loglevel", "error",
        "-print_format", "json", "-show_streams", src,
    ])
    probe_data = json.loads(probe_res.stdout)
    video_stream = next((s for s in probe_data.get("streams", []) if s.get("codec_type") == "video"), None)
    if not video_stream:
        raise PluginFailure(code="NO_VIDEO_STREAM", message="No video stream found.", input={"src": src}, retryable=True)

    fps = eval(video_stream.get("r_frame_rate", "30/1"))
    width = int(video_stream.get("width", 1920))
    height = int(video_stream.get("height", 1080))

    # Extract frames
    tmpdir = tempfile.mkdtemp(prefix="eye_contact_")
    frames_dir = os.path.join(tmpdir, "frames")
    output_dir = os.path.join(tmpdir, "output")
    os.makedirs(frames_dir, exist_ok=True)
    os.makedirs(output_dir, exist_ok=True)

    run_cmd([
        ffmpeg_bin, "-hide_banner", "-loglevel", "error",
        "-i", src, "-q:v", "2",
        os.path.join(frames_dir, "frame_%06d.jpg"),
    ])

    frames = sorted([f for f in os.listdir(frames_dir) if f.endswith(".jpg")])
    if not frames:
        raise PluginFailure(code="NO_FRAMES", message="Could not extract frames.", input={"src": src}, retryable=True)

    # Initialize face detector
    if use_mediapipe:
        mp_face_mesh = mp.solutions.face_mesh
        face_mesh = mp_face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        # MediaPipe face mesh landmark indices for eyes
        LEFT_EYE_INDICES = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7]
        RIGHT_EYE_INDICES = [362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382]
    else:
        face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye.xml")

    prev_eyes = None

    for i, frame_name in enumerate(frames):
        frame_path = os.path.join(frames_dir, frame_name)
        img = cv2.imread(frame_path)
        if img is None:
            continue

        if use_mediapipe and i % detect_every == 0:
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            results = face_mesh.process(rgb)

            if results.multi_face_landmarks:
                landmarks = results.multi_face_landmarks[0].landmark
                h, w = img.shape[:2]

                def get_eye_center(indices):
                    pts = [(int(landmarks[idx].x * w), int(landmarks[idx].y * h)) for idx in indices]
                    xs = [p[0] for p in pts]
                    ys = [p[1] for p in pts]
                    return (sum(xs) // len(xs), sum(ys) // len(ys))

                left_center = get_eye_center(LEFT_EYE_INDICES)
                right_center = get_eye_center(RIGHT_EYE_INDICES)
                prev_eyes = (left_center, right_center)

            if prev_eyes:
                left_center, right_center = prev_eyes
                # Shift eyes slightly toward camera center
                camera_center = (w // 2, h // 3)  # Eyes are typically in upper third

                for eye_center in [left_center, right_center]:
                    dx = int((camera_center[0] - eye_center[0]) * strength * 0.3)
                    dy = int((camera_center[1] - eye_center[1]) * strength * 0.2)

                    # Define eye region
                    ex = max(0, eye_center[0] - 40)
                    ey = max(0, eye_center[1] - 25)
                    ew = min(w - ex, 80)
                    eh = min(h - ey, 50)

                    if ew > 10 and eh > 10:
                        eye_roi = img[ey:ey+eh, ex:ex+ew]
                        # Small affine shift
                        M = np.float32([[1, 0, dx], [0, 1, dy]])
                        shifted = cv2.warpAffine(eye_roi, M, (ew, eh), borderMode=cv2.BORDER_REPLICATE)
                        img[ey:ey+eh, ex:ex+ew] = shifted

        elif not use_mediapipe and i % detect_every == 0:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            faces = face_cascade.detectMultiScale(gray, 1.1, 5)

            for (fx, fy, fw, fh) in faces:
                face_roi = gray[fy:fy+fh, fx:fx+fw]
                eyes = eye_cascade.detectMultiScale(face_roi, 1.1, 5)

                for j, (ex, ey, ew, eh) in enumerate(eyes[:2]):
                    abs_ex = fx + ex
                    abs_ey = fy + ey

                    # Slight shift toward center
                    dx = int((width // 2 - (abs_ex + ew // 2)) * strength * 0.2)
                    dy = int((height // 3 - (abs_ey + eh // 2)) * strength * 0.1)

                    eye_roi = img[abs_ey:abs_ey+eh, abs_ex:abs_ex+ew]
                    M = np.float32([[1, 0, dx], [0, 1, dy]])
                    shifted = cv2.warpAffine(eye_roi, M, (ew, eh), borderMode=cv2.BORDER_REPLICATE)
                    img[abs_ey:abs_ey+eh, abs_ex:abs_ex+ew] = shifted

        out_path_frame = os.path.join(output_dir, frame_name)
        cv2.imwrite(out_path_frame, img, [int(cv2.IMWRITE_JPEG_QUALITY), 95])

    # Re-encode
    dest = out_path(ctx, input.get("out") or "eye-contact.mp4")
    run_cmd([
        ffmpeg_bin, "-hide_banner", "-loglevel", "error",
        "-y", "-framerate", str(fps),
        "-i", os.path.join(output_dir, "frame_%06d.jpg"),
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        dest,
    ])

    # Copy audio
    dest_with_audio = dest.replace(".mp4", "_audio.mp4")
    try:
        run_cmd([
            ffmpeg_bin, "-hide_banner", "-loglevel", "error",
            "-y", "-i", dest, "-i", src,
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-map", "0:v:0", "-map", "1:a:0?", "-shortest",
            dest_with_audio,
        ])
        os.replace(dest_with_audio, dest)
    except Exception:
        pass

    if use_mediapipe:
        face_mesh.close()

    shutil.rmtree(tmpdir, ignore_errors=True)

    return ok(
        [artifact(dest, "video", strength=strength, engine="mediapipe" if use_mediapipe else "opencv")],
        [f"Eye contact correction applied using {'MediaPipe' if use_mediapipe else 'OpenCV Haar'} landmarks."],
    )
