import { definePlugin } from '../../core/define.ts';
import { ffmpeg, durationOf } from '../../core/media.ts';
import { S, requireFile, num, invalidInput } from '../_shared/common.ts';

export default definePlugin({
    id: 'video.fade',
    name: 'Fade video in / out',
    category: 'video',
    description: 'Add a fade from/to black at the start and/or end of a clip.',
    inputs: {
        src: S.string('Source video path', { required: true }),
        fadeIn: S.number('Fade-in duration in seconds (0 = none)', { default: 0, minimum: 0 }),
        fadeOut: S.number('Fade-out duration in seconds (0 = none)', { default: 0, minimum: 0 }),
        color: S.string('Fade colour', { default: 'black' }),
        out: S.string('Output file name', { default: 'faded.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const total = await durationOf(src);
        const fin = num(input.fadeIn, 0);
        const fout = num(input.fadeOut, 0);
        if (fin <= 0 && fout <= 0) {
            invalidInput('Provide a positive fadeIn and/or fadeOut.', { field: 'fadeIn', value: input.fadeIn });
        }
        const color = String(input.color ?? 'black');
        const parts: string[] = [];
        if (fin > 0) parts.push(`fade=t=in:st=0:d=${fin}:color=${color}`);
        if (fout > 0) parts.push(`fade=t=out:st=${Math.max(0, total - fout).toFixed(3)}:d=${fout}:color=${color}`);
        const dest = ctx.out(String(input.out ?? 'faded.mp4'));
        await ffmpeg(['-y', '-i', src, '-vf', parts.join(','), '-c:a', 'copy', dest]);
        return { outputs: [{ path: dest, kind: 'video' }] };
    },
});
