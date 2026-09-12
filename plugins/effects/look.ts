import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';

/**
 * effects.look - apply a colour grade preset to a video (or single image).
 *
 * Built-in looks:
 *   neutral    - identity, useful as a "no-op" pass / benchmark
 *   cinematic  - lifted blacks, gentle teal-orange (default warm + soft contrast)
 *   vivid      - saturation +0.3, contrast +0.1
 *   neon       - saturation +0.4, contrast +0.15, brightness +0.05
 *   tealOrange - split-tone teal shadows + orange highlights
 *   bleach     - high contrast, low saturation, lifted whites
 *   warm       - red +0.05, blue -0.05
 *   cool       - blue +0.05, red -0.05
 *   bw         - black and white
 *
 * Looks are composed from ffmpeg's `eq`, `colorbalance`, `curves`, `hue` filters.
 * Pure ffmpeg, no model.
 */
const LOOKS: Record<string, string> = {
    neutral: 'eq=1:1:1:1:1:1:1:1',
    cinematic: 'eq=contrast=1.08:brightness=0.02:saturation=0.95,colorbalance=rs=0.02:bs=-0.02:gh=0.05',
    vivid: 'eq=contrast=1.1:saturation=1.3:brightness=1.0',
    neon: 'eq=contrast=1.15:saturation=1.4:brightness=1.05',
    tealOrange: 'eq=contrast=1.1:saturation=1.1,colorbalance=rs=-0.08:bs=0.08:gh=0.05:bm=-0.03',
    bleach: 'eq=contrast=1.25:saturation=0.4:brightness=1.08,curves=preset=darker',
    warm: 'colorbalance=rs=0.05:bs=-0.05',
    cool: 'colorbalance=bs=0.05:rs=-0.05',
    bw: 'hue=s=0,format=yuv420p',
    sepia: 'colorbalance=rs=0.15:gs=0.07:bs=-0.15,eq=saturation=0.6',
    vintage: 'curves=preset=darker,eq=saturation=0.7:contrast=0.95,colorbalance=rs=0.05:bh=0.03',
};

export default definePlugin({
    id: 'effects.look',
    name: 'Apply a colour grade look',
    category: 'effects',
    description: 'Apply a named colour grade (cinematic, vivid, neon, teal-orange, bleach, warm, cool, bw, sepia, vintage) to a video or image.',
    inputs: {
        file: S.string('Path to input file (video or image)', { required: true }),
        look: S.string('Look preset', { enum: Object.keys(LOOKS), required: true }),
        out: S.string('Output file (.mp4 / .png)', { default: 'graded.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const file = requireFile(input.file, 'file');
        const look = String(input.look);
        const filter = LOOKS[look];
        if (!filter) {
            throw new (await import('../../core/define.ts')).PluginFailure({
                code: 'UNKNOWN_LOOK',
                message: 'Unknown look "' + look + '". Supported: ' + Object.keys(LOOKS).join(', '),
                input: { look },
                retryable: true,
            });
        }
        const out = ctx.out(String(input.out ?? 'graded.mp4'));
        ensureParentDir(out);

        const isImage = /\.(png|jpg|jpeg|webp|bmp|tiff)$/i.test(out);
        const args = ['-y', '-i', file, '-vf', filter];
        if (isImage) args.push('-frames:v', '1');
        args.push('-c:v', isImage ? 'png' : 'libx264', '-crf', '20', '-preset', 'medium', out);
        await ffmpeg(args);
        return { outputs: [{ path: out, kind: isImage ? 'image' as const : 'video' as const, meta: { look, filter } }] };
    },
});