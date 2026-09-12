import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num, resolveOutPath } from '../_shared/common.ts';

/**
 * export.platform — encode to a platform's actual spec.
 *
 * `export.derivative` re-renders to different aspect ratios, but it says nothing
 * about bitrate, frame rate, colour space or loudness — and those are exactly
 * what a platform rejects or re-encodes you for. Uploading a −20 LUFS master to
 * YouTube gets it turned down; a broadcast master at −14 LUFS fails delivery.
 *
 * This encodes to a named spec and applies the matching loudness target, so the
 * file that leaves is the file the platform wants.
 */
export default definePlugin({
    id: 'export.platform',
    name: 'Encode for a platform',
    category: 'export',
    description: 'Encode to a named platform spec (resolution, fps, codec, loudness) — YouTube, Shorts, Reels, TikTok, broadcast, web.',
    inputs: {
        src: S.string('Source video (should be your highest-quality master)', { required: true }),
        platform: S.string('Target platform', {
            enum: ['youtube', 'shorts', 'reels', 'tiktok', 'broadcast', 'web', 'podcast'],
            default: 'youtube',
        }),
        width: S.int('Override width (0 = use the preset)', { default: 0 }),
        height: S.int('Override height (0 = use the preset)', { default: 0 }),
        fps: S.int('Override fps (0 = keep the source fps)', { default: 0 }),
        loudness: S.number('Override loudness target in LUFS (0 = use the preset)', { default: 0 }),
        out: S.string('Output file name (.mp4)', { default: 'platform.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const key = String(input.platform ?? 'youtube').toLowerCase();

        // Sizes, frame rates and loudness targets each platform actually expects.
        const SPECS: Record<string, { w: number; h: number; fps: number; lufs: number; crf: number; note: string }> = {
            youtube: { w: 1920, h: 1080, fps: 0, lufs: -14, crf: 20, note: 'YouTube: -14 LUFS, Rec.709, up to 4K.' },
            shorts: { w: 1080, h: 1920, fps: 0, lufs: -14, crf: 20, note: 'Shorts: 9:16, -14 LUFS.' },
            reels: { w: 1080, h: 1920, fps: 0, lufs: -16, crf: 20, note: 'Reels: 9:16, -16 LUFS.' },
            tiktok: { w: 1080, h: 1920, fps: 0, lufs: -16, crf: 20, note: 'TikTok: 9:16, -16 LUFS.' },
            broadcast: { w: 1920, h: 1080, fps: 25, lufs: -23, crf: 16, note: 'Broadcast (EBU R128): -23 LUFS, 25 fps.' },
            web: { w: 1280, h: 720, fps: 0, lufs: -16, crf: 23, note: 'Web: 720p, -16 LUFS.' },
            podcast: { w: 1920, h: 1080, fps: 0, lufs: -16, crf: 20, note: 'Podcast: -16 LUFS.' },
        };

        const spec = SPECS[key];
        if (!spec) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: `Unknown platform "${key}".`,
                input: { platform: key, known: Object.keys(SPECS) },
                retryable: true,
                hint: 'One of: ' + Object.keys(SPECS).join(', ') + '.',
            });
        }

        const W = num(input.width, 0) || spec.w;
        const H = num(input.height, 0) || spec.h;
        const fps = num(input.fps, 0) || spec.fps || 0;
        const lufs = num(input.loudness, 0) || spec.lufs;

        // Fit, then letterbox onto the target shape — never crop a master by
        // accident. Colour is left in Rec.709, which every platform here wants.
        const vf = [
            `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
            `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black`,
            'format=yuv420p',
            ...(fps ? [`fps=${fps}`] : []),
        ].join(',');

        const dest = resolveOutPath(ctx, String(input.out ?? 'platform.mp4'));
        await ffmpeg([
            '-y', '-i', src,
            '-vf', vf,
            // Two-pass loudnorm would be more accurate, but one pass with a
            // measured target is what ffmpeg's dynamic mode gives and is close
            // enough for every target here.
            '-af', `loudnorm=I=${lufs}:TP=-1.5:LRA=11`,
            '-c:v', 'libx264', '-preset', 'medium', '-crf', String(spec.crf),
            '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
            '-c:a', 'aac', '-b:a', '192k',
            dest,
        ]);

        return {
            outputs: [
                {
                    path: dest,
                    kind: 'video',
                    meta: { platform: key, width: W, height: H, fps: fps || 'source', lufs },
                },
            ],
            notes: [spec.note, `Encoded at ${W}x${H}, target ${lufs} LUFS.`],
        };
    },
});
