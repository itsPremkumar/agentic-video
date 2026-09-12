import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'video.resize',
    name: 'Resize / scale video',
    category: 'video',
    description: 'Scale a video to an explicit size or to a target short-edge height.',
    inputs: {
        src: S.string('Source video path', { required: true }),
        width: S.int('Target width (-2 keeps aspect, must be even)', { default: -2 }),
        height: S.int('Target height (-2 keeps aspect, must be even)', { default: -2 }),
        fit: S.string('When both dimensions given', { enum: ['stretch', 'contain', 'cover'], default: 'contain' }),
        padColor: S.string('Padding colour when using contain/cover', { default: 'black' }),
        out: S.string('Output file name', { default: 'resized.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const w = num(input.width, -2);
        const h = num(input.height, -2);
        if (w <= 0 && h <= 0) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'Provide a positive width and/or height.',
                input: { width: input.width, height: input.height },
                retryable: true,
            });
        }
        const dest = ctx.out(String(input.out ?? 'resized.mp4'));
        let vf: string;
        if (w > 0 && h > 0) {
            const fit = String(input.fit ?? 'contain');
            if (fit === 'stretch') vf = `scale=${w}:${h}`;
            else if (fit === 'cover') vf = `scale=if(gt(a,${w / h}),-2,${w}):if(gt(a,${w / h}),${h},-2),crop=${w}:${h}`;
            else vf = `scale=w=${w}:h=${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${String(input.padColor ?? 'black')}`;
        } else {
            vf = `scale=${w > 0 ? w : -2}:${h > 0 ? h : -2}`;
        }
        await ffmpeg(['-y', '-i', src, '-vf', vf, '-c:a', 'copy', dest]);
        return { outputs: [{ path: dest, kind: 'video' }] };
    },
});
