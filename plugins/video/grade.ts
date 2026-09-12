import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'video.grade',
    name: 'Colour grade video',
    category: 'video',
    description: 'Adjust brightness, contrast, saturation and gamma of a video.',
    inputs: {
        src: S.string('Source video path', { required: true }),
        brightness: S.number('Brightness -1..1', { default: 0, minimum: -1, maximum: 1 }),
        contrast: S.number('Contrast 0..3', { default: 1, minimum: 0, maximum: 3 }),
        saturation: S.number('Saturation 0..3', { default: 1, minimum: 0, maximum: 3 }),
        gamma: S.number('Gamma 0.1..3', { default: 1, minimum: 0.1, maximum: 3 }),
        out: S.string('Output file name', { default: 'graded.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const vf = `eq=brightness=${num(input.brightness, 0)}:contrast=${num(input.contrast, 1)}:saturation=${num(input.saturation, 1)}:gamma=${num(input.gamma, 1)}`;
        const dest = ctx.out(String(input.out ?? 'graded.mp4'));
        await ffmpeg(['-y', '-i', src, '-vf', vf, '-c:a', 'copy', dest]);
        return { outputs: [{ path: dest, kind: 'video' }] };
    },
});
