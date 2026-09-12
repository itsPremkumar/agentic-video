import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg, probe } from '../../core/media.ts';
import { S, requireFile, num, resolveOutPath } from '../_shared/common.ts';

/** yuv420p requires even dimensions. */
function even(n: number): number {
    const v = Math.max(2, Math.round(n));
    return v % 2 === 0 ? v : v + 1;
}

/** Read the first video stream's width/height. */
async function videoSize(file: string): Promise<{ width: number; height: number }> {
    const info = await probe(file);
    const streams = Array.isArray(info?.streams) ? info.streams : [];
    const vs = streams.find((s: Record<string, any>) => s?.codec_type === 'video');
    const w = Number(vs?.width ?? 0);
    const h = Number(vs?.height ?? 0);
    if (!w || !h) {
        throw new PluginFailure({
            code: 'NO_VIDEO_STREAM',
            message: 'Could not read video dimensions from ' + file + '.',
            reason: 'ffprobe reported no usable video stream.',
            input: { src: file },
            retryable: true,
        });
    }
    return { width: w, height: h };
}

/**
 * export.reframe — fit a video into a target aspect ratio.
 * mode=pad keeps everything visible (adds bars); mode=crop fills the frame
 * (loses edges). The agent chooses explicitly.
 */
const PRESETS: Record<string, { w: number; h: number }> = {
    '9:16': { w: 1080, h: 1920 },
    '16:9': { w: 1920, h: 1080 },
    '1:1': { w: 1080, h: 1080 },
    '4:5': { w: 1080, h: 1350 },
};

export default definePlugin({
    id: 'export.reframe',
    name: 'Reframe to aspect ratio',
    category: 'export',
    description: 'Fit a video into 9:16 / 16:9 / 1:1 / 4:5 by padding or cropping.',
    inputs: {
        src: S.string('Source video path', { required: true }),
        aspect: S.string('Target aspect', { enum: Object.keys(PRESETS), required: true }),
        mode: S.string('pad = letterbox (keep all), crop = fill frame', { enum: ['pad', 'crop'], default: 'pad' }),
        padColor: S.string('Padding colour', { default: 'black' }),
        out: S.string('Output file name', { default: 'reframed.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const aspect = String(input.aspect);
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
        void num;
        const mode = String(input.mode ?? 'pad');

        // Build the scale target in TypeScript instead of using ffmpeg's
        // if(gt(a,...)) expressions: commas inside a filter argument are
        // parsed as filter separators, which silently splits the graph
        // ("No such filter: '0.5625)'"). Plain numbers are always safe.
        const vf = await (async (): Promise<string> => {
            if (mode !== 'crop') {
                return (
                    `scale=${target.w}:${target.h}:force_original_aspect_ratio=decrease,` +
                    `pad=${target.w}:${target.h}:(ow-iw)/2:(oh-ih)/2:color=${String(input.padColor ?? 'black')}`
                );
            }
            const { width: sw, height: sh } = await videoSize(src);
            // Cover the target box, then centre-crop down to it.
            const f = Math.max(target.w / sw, target.h / sh);
            return `scale=${even(sw * f)}:${even(sh * f)},crop=${target.w}:${target.h}`;
        })();

        const dest = resolveOutPath(ctx, String(input.out ?? 'reframed.mp4'));
        const res = await ffmpeg(['-y', '-i', src, '-vf', vf, '-c:a', 'copy', dest]);
        if (res.code !== 0) {
            throw new PluginFailure({
                code: 'REFRAME_FAILED',
                message: `Could not reframe the video to ${aspect} (mode=${mode}).`,
                reason: (res.stderr || res.stdout || '').slice(-900),
                input: { src, aspect, mode, filter: vf },
                retryable: true,
                hint: 'Check the source has a valid video stream; mode=crop upscales small sources, which can be slow but should still work.',
            });
        }
        return {
            outputs: [
                { path: dest, kind: 'video', meta: { aspect, mode, width: target.w, height: target.h, filter: vf } },
            ],
        };
    },
});
