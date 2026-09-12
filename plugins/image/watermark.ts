import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'image.watermark',
    name: 'Watermark image',
    category: 'image',
    description: 'Overlay a watermark/logo image onto an image.',
    inputs: {
        src: S.string('Source image path', { required: true }),
        watermark: S.string('Watermark image path (PNG with alpha recommended)', { required: true }),
        position: S.string('Corner placement', {
            enum: ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center'],
            default: 'bottom-right',
        }),
        margin: S.int('Margin from the edge in pixels', { default: 24 }),
        opacity: S.number('Watermark opacity 0..1', { default: 0.8, minimum: 0, maximum: 1 }),
        scale: S.number('Scale watermark relative to source width (0..1)', { default: 0.2, minimum: 0.01, maximum: 1 }),
        out: S.string('Output file name'),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const wm = requireFile(input.watermark, 'watermark');
        const m = num(input.margin, 24);
        const pos = String(input.position ?? 'bottom-right');
        const overlay = {
            'bottom-right': `W-w-${m}:H-h-${m}`,
            'bottom-left': `${m}:H-h-${m}`,
            'top-right': `W-w-${m}:${m}`,
            'top-left': `${m}:${m}`,
            center: `(W-w)/2:(H-h)/2`,
        }[pos];
        const dest = ctx.out(String(input.out ?? `watermarked_${Date.now()}.png`));
        const filter =
            `[1:v]format=rgba,colorchannelmixer=aa=${num(input.opacity, 0.8)},` +
            `scale=iw*${num(input.scale, 0.2)}:-1[wm];` +
            `[0:v][wm]overlay=${overlay}`;
        await ffmpeg(['-y', '-i', src, '-i', wm, '-filter_complex', filter, dest]);
        return { outputs: [{ path: dest, kind: 'image' }] };
    },
});
