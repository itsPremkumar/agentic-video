import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num, invalidInput } from '../_shared/common.ts';

export default definePlugin({
    id: 'image.resize',
    name: 'Resize image',
    category: 'image',
    description: 'Resize an image to an explicit width/height (or fit within a box).',
    inputs: {
        src: S.string('Source image path', { required: true }),
        width: S.int('Target width in pixels (-1 keeps aspect)', { default: -1 }),
        height: S.int('Target height in pixels (-1 keeps aspect)', { default: -1 }),
        fit: S.string('When both width and height are set, how to fit', {
            enum: ['stretch', 'contain'],
            default: 'stretch',
        }),
        out: S.string('Output file name (inside the plugin workspace)'),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const width = num(input.width, -1);
        const height = num(input.height, -1);
        if (width <= 0 && height <= 0) {
            invalidInput('Provide a positive width and/or height.', { field: 'width', value: input.width });
        }
        const dest = ctx.out(String(input.out ?? `resized_${Date.now()}.png`));

        const scale =
            width > 0 && height > 0
                ? input.fit === 'contain'
                    ? `scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease`
                    : `scale=${width}:${height}`
                : `scale=${width > 0 ? width : -1}:${height > 0 ? height : -1}`;

        await ffmpeg(['-y', '-i', src, '-vf', scale, dest]);
        return { outputs: [{ path: dest, kind: 'image' }] };
    },
});
