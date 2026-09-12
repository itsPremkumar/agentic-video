import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'image.convert',
    name: 'Convert image format',
    category: 'image',
    description: 'Convert an image to another format, optionally setting JPEG quality.',
    inputs: {
        src: S.string('Source image path', { required: true }),
        format: S.string('Target format', { enum: ['png', 'jpg', 'webp', 'bmp', 'gif'], required: true }),
        quality: S.int('Quality for lossy formats (2..31 for jpg/webp, lower = better)', { default: 5, minimum: 2, maximum: 31 }),
        out: S.string('Output file name (extension optional)'),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const format = String(input.format);
        const dest = ctx.out(String(input.out ?? `converted_${Date.now()}.${format}`));
        const args = ['-y', '-i', src];
        if (format === 'jpg') args.push('-q:v', String(num(input.quality, 5)));
        args.push(dest);
        await ffmpeg(args);
        return { outputs: [{ path: dest, kind: 'image' }] };
    },
});
