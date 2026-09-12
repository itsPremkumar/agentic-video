import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'video.overlay',
    name: 'Picture-in-picture overlay',
    category: 'video',
    description: 'Overlay one video/image on top of another (PiP).',
    inputs: {
        src: S.string('Base video path', { required: true }),
        overlay: S.string('Overlay video or image path', { required: true }),
        position: S.string('Placement', {
            enum: ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center'],
            default: 'bottom-right',
        }),
        margin: S.int('Margin in pixels', { default: 24 }),
        scale: S.number('Overlay width relative to base width (0..1)', { default: 0.3, minimum: 0.05, maximum: 1 }),
        start: S.number('Overlay start time in seconds', { default: 0 }),
        out: S.string('Output file name', { default: 'overlay.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const ov = requireFile(input.overlay, 'overlay');
        const m = num(input.margin, 24);
        const overlay = {
            'bottom-right': `W-w-${m}:H-h-${m}`,
            'bottom-left': `${m}:H-h-${m}`,
            'top-right': `W-w-${m}:${m}`,
            'top-left': `${m}:${m}`,
            center: `(W-w)/2:(H-h)/2`,
        }[String(input.position ?? 'bottom-right')];
        const start = num(input.start, 0);
        const enable = start > 0 ? `:enable='gte(t,${start})'` : '';
        const filter =
            `[1:v]scale=iw*${num(input.scale, 0.3)}:-1[ov];[0:v][ov]overlay=${overlay}${enable}`;
        const dest = ctx.out(String(input.out ?? 'overlay.mp4'));
        await ffmpeg(['-y', '-i', src, '-i', ov, '-filter_complex', filter, '-c:a', 'copy', dest]);
        return { outputs: [{ path: dest, kind: 'video' }] };
    },
});
