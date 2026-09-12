import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'image.grade',
    name: 'Colour grade image',
    category: 'image',
    description: 'Adjust brightness, contrast, saturation and gamma of an image.',
    inputs: {
        src: S.string('Source image path', { required: true }),
        brightness: S.number('Brightness, -1..1 (0 = neutral)', { default: 0, minimum: -1, maximum: 1 }),
        contrast: S.number('Contrast, 0..3 (1 = neutral)', { default: 1, minimum: 0, maximum: 3 }),
        saturation: S.number('Saturation, 0..3 (1 = neutral)', { default: 1, minimum: 0, maximum: 3 }),
        gamma: S.number('Gamma, 0.1..3 (1 = neutral)', { default: 1, minimum: 0.1, maximum: 3 }),
        out: S.string('Output file name'),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const dest = ctx.out(String(input.out ?? `grade_${Date.now()}.png`));
        const vf = `eq=brightness=${num(input.brightness, 0)}:contrast=${num(input.contrast, 1)}:saturation=${num(input.saturation, 1)}:gamma=${num(input.gamma, 1)}`;
        await ffmpeg(['-y', '-i', src, '-vf', vf, dest]);
        return { outputs: [{ path: dest, kind: 'image' }] };
    },
});
