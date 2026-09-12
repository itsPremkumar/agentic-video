import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile } from '../_shared/common.ts';

export default definePlugin({
    id: 'video.reverse',
    name: 'Reverse video',
    category: 'video',
    description: 'Play a clip backwards (re-encodes, no audio).',
    inputs: {
        src: S.string('Source video path', { required: true }),
        out: S.string('Output file name', { default: 'reversed.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const dest = ctx.out(String(input.out ?? 'reversed.mp4'));
        await ffmpeg(['-y', '-i', src, '-vf', 'reverse', '-an', dest]);
        return { outputs: [{ path: dest, kind: 'video' }], warnings: ['Audio is dropped when reversing.'] };
    },
});
