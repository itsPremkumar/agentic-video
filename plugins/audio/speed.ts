import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'audio.speed',
    name: 'Change audio tempo',
    category: 'audio',
    description: 'Speed up or slow down audio while preserving pitch (atempo).',
    inputs: {
        src: S.string('Source audio path', { required: true }),
        factor: S.number('Tempo multiplier (0.5 = half speed, 2 = double)', { required: true, minimum: 0.1, maximum: 10 }),
        out: S.string('Output file name', { default: 'tempo.mp3' }),
    },
    outputs: ['audio'],
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
        const dest = ctx.out(String(input.out ?? 'tempo.mp3'));
        await ffmpeg(['-y', '-i', src, '-af', chain.map((v) => `atempo=${v}`).join(','), dest]);
        return { outputs: [{ path: dest, kind: 'audio' }] };
    },
});
