import * as fs from 'node:fs';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg, probe } from '../../core/media.ts';
import { S, requireFile, num, resolveOutPath } from '../_shared/common.ts';

/**
 * video.auto_reframe — content-aware aspect ratio conversion.
 *
 * Unlike export.reframe which center-crops, this plugin samples frames,
 * detects faces (if available), and positions the crop window to keep
 * subjects in frame. Falls back to center-crop if no faces are found.
 *
 * For videos with heavy subject movement, split with video.scene_split
 * first and reframe each segment separately.
 */
export default definePlugin({
    id: 'video.auto_reframe',
    name: 'Auto reframe (subject-aware)',
    category: 'video',
    description: 'Content-aware reframing that detects faces and positions the crop window to keep subjects in frame. Converts 16:9 → 9:16 and other ratios.',
    inputs: {
        src: S.string('Source video path', { required: true }),
        aspect: S.string('Target aspect ratio', { enum: ['9:16', '16:9', '1:1', '4:5'], required: true }),
        mode: S.string('Tracking priority', { enum: ['face', 'center'], default: 'face' }),
        samples: S.int('Frames to sample for face detection (0 = auto)', { default: 0, minimum: 0 }),
        out: S.string('Output file name', { default: 'auto-reframed.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const aspect = String(input.aspect);
        const mode = String(input.mode ?? 'face');

        const PRESETS: Record<string, { w: number; h: number }> = {
            '9:16': { w: 1080, h: 1920 },
            '16:9': { w: 1920, h: 1080 },
            '1:1': { w: 1080, h: 1080 },
            '4:5': { w: 1080, h: 1350 },
        };

        const target = PRESETS[aspect];
        if (!target) {
            throw new PluginFailure({
                code: 'UNKNOWN_ASPECT',
                message: `Unsupported aspect "${aspect}".`,
                input: { aspect },
                retryable: true,
                hint: `Supported: ${Object.keys(PRESETS).join(', ')}`,
            });
        }

        const info = await probe(src);
        const videoStream = (info.streams ?? []).find((s: any) => s.codec_type === 'video');
        if (!videoStream) {
            throw new PluginFailure({
                code: 'NO_VIDEO',
                message: 'No video stream found.',
                input: { src },
                retryable: true,
            });
        }

        const srcW = Number(videoStream.width ?? 1920);
        const srcH = Number(videoStream.height ?? 1080);
        const duration = Number(info.format?.duration ?? 0);
        const targetRatio = target.w / target.h;
        const srcRatio = srcW / srcH;

        // Determine crop dimensions
        let cropW: number, cropH: number;
        if (srcRatio > targetRatio) {
            cropH = srcH;
            cropW = Math.round(cropH * targetRatio);
        } else {
            cropW = srcW;
            cropH = Math.round(cropW / targetRatio);
        }

        let cropX = Math.round((srcW - cropW) / 2);
        let cropY = Math.round((srcH - cropH) / 2);
        let faceDetected = false;

        if (mode === 'face' && duration > 0) {
            const sampleCount = num(input.samples, 0) || Math.min(20, Math.max(5, Math.floor(duration / 5)));
            const interval = duration / (sampleCount + 1);
            const faceCenters: Array<{ x: number; y: number; weight: number }> = [];

            const tmpDir = resolveOutPath(ctx, 'reframe-frames');
            fs.mkdirSync(tmpDir, { recursive: true });

            for (let i = 1; i <= sampleCount; i++) {
                const t = i * interval;
                const framePath = `${tmpDir}/frame_${String(i).padStart(4, '0')}.jpg`;
                try {
                    await ffmpeg(['-ss', String(t), '-i', src, '-vframes', '1', '-q:v', '2', '-y', framePath]);
                } catch {
                    continue;
                }

                // Try ffmpeg facedetect filter (non-standard build)
                try {
                    const faceRes = await ffmpeg([
                        '-i', framePath,
                        '-vf', 'facedetect',
                        '-f', 'null', '-',
                    ]);
                    const matches = [...faceRes.stderr.matchAll(/face:\s*x=(\d+)\s*y=(\d+)\s*w=(\d+)\s*h=(\d+)/g)];
                    for (const m of matches) {
                        const fx = Number(m[1]) + Number(m[3]) / 2;
                        const fy = Number(m[2]) + Number(m[4]) / 2;
                        const area = Number(m[3]) * Number(m[4]);
                        faceCenters.push({ x: fx, y: fy, weight: area });
                    }
                } catch {
                    // facedetect not available in this ffmpeg build
                }
            }

            if (faceCenters.length > 0) {
                // Weighted average of face centers
                const totalWeight = faceCenters.reduce((s, f) => s + f.weight, 0);
                const avgX = faceCenters.reduce((s, f) => s + f.x * f.weight, 0) / totalWeight;
                const avgY = faceCenters.reduce((s, f) => s + f.y * f.weight, 0) / totalWeight;

                // Position crop so faces are in upper-center (rule of thirds)
                const halfCropW = cropW / 2;
                const halfCropH = cropH / 2;
                cropX = Math.max(0, Math.min(srcW - cropW, Math.round(avgX - halfCropW)));
                cropY = Math.max(0, Math.min(srcH - cropH, Math.round(avgY - halfCropH * 0.8)));
                faceDetected = true;
            }
        }

        const dest = resolveOutPath(ctx, String(input.out ?? 'auto-reframed.mp4'));

        // Single-pass crop + scale — robust and fast
        const vf = `crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${target.w}:${target.h}:flags=lanczos`;

        await ffmpeg([
            '-y', '-i', src,
            '-vf', vf,
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '192k',
            dest,
        ]);

        return {
            outputs: [
                {
                    path: dest,
                    kind: 'video',
                    meta: {
                        aspect,
                        sourceResolution: `${srcW}x${srcH}`,
                        targetResolution: `${target.w}x${target.h}`,
                        cropWindow: `${cropW}x${cropH}+${cropX}+${cropY}`,
                        faceDetected,
                        trackingMode: mode,
                    },
                },
            ],
            notes: faceDetected
                ? [`Face detected; crop positioned at ${cropX},${cropY}`]
                : ['No faces detected; used center-crop. For moving subjects, split first with video.scene_split.'],
        };
    },
});
