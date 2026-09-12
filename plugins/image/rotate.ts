import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'image.rotate',
    name: 'Rotate image',
    category: 'image',
    description: 'Rotate an image by an arbitrary angle (or 90° steps).',
    inputs: {
        src: S.string('Source image path', { required: true }),
        angle: S.number('Rotation angle in degrees (clockwise)', { required: true }),
        background: S.string('Background colour for uncovered corners', { default: 'black' }),
        out: S.string('Output file name'),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const angle = num(input.angle, 0);
        const dest = ctx.out(String(input.out ?? `rotate_${Date.now()}.png`));
        const rad = (angle * Math.PI) / 180;
        await ffmpeg([
            '-y', '-i', src,
            '-vf', `rotate=${rad}:fillcolor=${String(input.background ?? 'black')}`,
            dest,
        ]);
        return { outputs: [{ path: dest, kind: 'image' }] };
    },
});
