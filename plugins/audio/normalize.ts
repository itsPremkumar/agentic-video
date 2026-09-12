import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'audio.normalize',
    name: 'Normalize audio loudness',
    category: 'audio',
    description: 'Apply EBU R128 loudness normalization (loudnorm) to an audio file.',
    inputs: {
        src: S.string('Source audio path', { required: true }),
        target: S.number('Target integrated loudness in LUFS (e.g. -16 for web, -14 for social)', { default: -16 }),
        truePeak: S.number('True peak ceiling in dBTP', { default: -1.5 }),
        out: S.string('Output file name', { default: 'normalized.mp3' }),
    },
    outputs: ['audio'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const dest = ctx.out(String(input.out ?? 'normalized.mp3'));
        const af = `loudnorm=I=${num(input.target, -16)}:TP=${num(input.truePeak, -1.5)}:LRA=11`;
        await ffmpeg(['-y', '-i', src, '-af', af, dest]);
        return { outputs: [{ path: dest, kind: 'audio' }] };
    },
});
