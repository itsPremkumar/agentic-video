import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num, invalidInput } from '../_shared/common.ts';

export default definePlugin({
    id: 'image.crop',
    name: 'Crop image',
    category: 'image',
    description: 'Crop a rectangular region out of an image.',
    inputs: {
        src: S.string('Source image path', { required: true }),
        x: S.int('Left offset in pixels', { default: 0 }),
        y: S.int('Top offset in pixels', { default: 0 }),
        width: S.int('Crop width in pixels', { required: true }),
        height: S.int('Crop height in pixels', { required: true }),
        out: S.string('Output file name'),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const w = num(input.width, 0);
        const h = num(input.height, 0);
        if (w <= 0 || h <= 0) invalidInput('width and height must be positive integers.', { field: 'width', value: input.width });
        const dest = ctx.out(String(input.out ?? `crop_${Date.now()}.png`));
        await ffmpeg(['-y', '-i', src, '-vf', `crop=${w}:${h}:${num(input.x, 0)}:${num(input.y, 0)}`, dest]);
        return { outputs: [{ path: dest, kind: 'image' }] };
    },
});
