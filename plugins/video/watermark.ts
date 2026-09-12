import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'video.watermark',
    name: 'Watermark video',
    category: 'video',
    description: 'Overlay a logo/watermark image onto a video.',
    inputs: {
        src: S.string('Source video path', { required: true }),
        watermark: S.string('Watermark image path', { required: true }),
        position: S.string('Corner placement', {
            enum: ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center'],
            default: 'bottom-right',
        }),
        margin: S.int('Margin in pixels', { default: 24 }),
        opacity: S.number('Opacity 0..1', { default: 0.8, minimum: 0, maximum: 1 }),
        scale: S.number('Scale relative to video width (0..1)', { default: 0.18, minimum: 0.01, maximum: 1 }),
        out: S.string('Output file name', { default: 'watermarked.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const wm = requireFile(input.watermark, 'watermark');
        const m = num(input.margin, 24);
        const overlay = {
            'bottom-right': `W-w-${m}:H-h-${m}`,
            'bottom-left': `${m}:H-h-${m}`,
            'top-right': `W-w-${m}:${m}`,
            'top-left': `${m}:${m}`,
            center: `(W-w)/2:(H-h)/2`,
        }[String(input.position ?? 'bottom-right')];
        const filter =
            `[1:v]format=rgba,colorchannelmixer=aa=${num(input.opacity, 0.8)},` +
            `scale=iw*${num(input.scale, 0.18)}:-1[wm];[0:v][wm]overlay=${overlay}`;
        const dest = ctx.out(String(input.out ?? 'watermarked.mp4'));
        await ffmpeg(['-y', '-i', src, '-i', wm, '-filter_complex', filter, '-c:a', 'copy', dest]);
        return { outputs: [{ path: dest, kind: 'video' }] };
    },
});
