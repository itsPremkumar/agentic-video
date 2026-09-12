import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'audio.volume',
    name: 'Change audio volume',
    category: 'audio',
    description: 'Scale the volume of an audio file (dB gain or multiplier).',
    inputs: {
        src: S.string('Source audio path', { required: true }),
        db: S.number('Gain in dB (e.g. -6 halves the amplitude)', { default: 0 }),
        multiplier: S.number('Alternative linear multiplier (1 = unchanged)', { default: 1, minimum: 0 }),
        out: S.string('Output file name', { default: 'volume.mp3' }),
    },
    outputs: ['audio'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const mult = num(input.multiplier, 1);
        const filter = mult !== 1 ? `volume=${mult}` : `volume=${num(input.db, 0)}dB`;
        const dest = ctx.out(String(input.out ?? 'volume.mp3'));
        await ffmpeg(['-y', '-i', src, '-af', filter, dest]);
        return { outputs: [{ path: dest, kind: 'audio' }] };
    },
});
