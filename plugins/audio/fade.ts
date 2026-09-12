import { definePlugin } from '../../core/define.ts';
import { ffmpeg, durationOf } from '../../core/media.ts';
import { S, requireFile, num, invalidInput } from '../_shared/common.ts';

export default definePlugin({
    id: 'audio.fade',
    name: 'Fade audio in / out',
    category: 'audio',
    description: 'Add fade-in and/or fade-out to an audio file.',
    inputs: {
        src: S.string('Source audio path', { required: true }),
        fadeIn: S.number('Fade-in seconds (0 = none)', { default: 0, minimum: 0 }),
        fadeOut: S.number('Fade-out seconds (0 = none)', { default: 0, minimum: 0 }),
        out: S.string('Output file name', { default: 'faded.mp3' }),
    },
    outputs: ['audio'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const total = await durationOf(src);
        const fin = num(input.fadeIn, 0);
        const fout = num(input.fadeOut, 0);
        if (fin <= 0 && fout <= 0)
            invalidInput('Provide a positive fadeIn and/or fadeOut.', { field: 'fadeIn', value: input.fadeIn });
        const parts: string[] = [];
        if (fin > 0) parts.push(`afade=t=in:st=0:d=${fin}`);
        if (fout > 0) parts.push(`afade=t=out:st=${Math.max(0, total - fout).toFixed(3)}:d=${fout}`);
        const dest = ctx.out(String(input.out ?? 'faded.mp3'));
        await ffmpeg(['-y', '-i', src, '-af', parts.join(','), dest]);
        return { outputs: [{ path: dest, kind: 'audio' }] };
    },
});
