import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'video.crop',
    name: 'Crop video',
    category: 'video',
    description: 'Crop a video to a rectangle, or to an aspect ratio with auto-centering.',
    inputs: {
        src: S.string('Source video path', { required: true }),
        width: S.int('Crop width in pixels'),
        height: S.int('Crop height in pixels'),
        x: S.int('Left offset', { default: 0 }),
        y: S.int('Top offset', { default: 0 }),
        aspect: S.string('Instead of explicit size, crop to aspect e.g. "9:16"'),
        out: S.string('Output file name', { default: 'cropped.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const dest = ctx.out(String(input.out ?? 'cropped.mp4'));
        let vf: string;
        if (input.aspect) {
            const [aw, ah] = String(input.aspect).split(':').map(Number);
            if (!aw || !ah) {
                throw new PluginFailure({
                    code: 'INVALID_INPUT',
                    message: `aspect must look like "9:16", received "${String(input.aspect)}"`,
                    input: { aspect: input.aspect },
                    retryable: true,
                });
            }
            vf = `crop=if(gt(a,${aw / ah}),ih*${aw / ah},iw):if(gt(a,${aw / ah}),ih,iw*${ah / aw})`;
        } else {
            const w = num(input.width, 0);
            const h = num(input.height, 0);
            if (w <= 0 || h <= 0) {
                throw new PluginFailure({
                    code: 'INVALID_INPUT',
                    message: 'Provide width and height, or an aspect like "9:16".',
                    input: { width: input.width, height: input.height, aspect: input.aspect },
                    retryable: true,
                });
            }
            vf = `crop=${w}:${h}:${num(input.x, 0)}:${num(input.y, 0)}`;
        }
        await ffmpeg(['-y', '-i', src, '-vf', vf, '-c:a', 'copy', dest]);
        return { outputs: [{ path: dest, kind: 'video' }] };
    },
});
