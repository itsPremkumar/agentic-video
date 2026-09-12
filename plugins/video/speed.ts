import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'video.speed',
    name: 'Change video speed',
    category: 'video',
    description: 'Speed up or slow down a video (and optionally its audio).',
    inputs: {
        src: S.string('Source video path', { required: true }),
        factor: S.number('Speed multiplier: 2 = twice as fast, 0.5 = half speed', { required: true, minimum: 0.1, maximum: 10 }),
        adjustAudio: S.bool('Also tempo-shift the audio (atempo)', { default: true }),
        out: S.string('Output file name', { default: 'speed.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const factor = num(input.factor, 1);
        if (factor <= 0) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'factor must be greater than 0.',
                input: { factor },
                retryable: true,
            });
        }
        const dest = ctx.out(String(input.out ?? 'speed.mp4'));
        const vf = `setpts=${(1 / factor).toFixed(6)}*PTS`;
        const args = ['-y', '-i', src, '-vf', vf];
        if (input.adjustAudio !== false) {
            // atempo only supports 0.5..2.0 — chain it for wider ranges.
            let remaining = factor;
            const chain: number[] = [];
            while (remaining > 2.0) {
                chain.push(2.0);
                remaining /= 2.0;
            }
            while (remaining < 0.5) {
                chain.push(0.5);
                remaining /= 0.5;
            }
            chain.push(Number(remaining.toFixed(4)));
            args.push('-af', chain.map((v) => `atempo=${v}`).join(','));
        } else {
            args.push('-c:a', 'copy');
        }
        args.push(dest);
        await ffmpeg(args);
        return { outputs: [{ path: dest, kind: 'video' }] };
    },
});
