import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile } from '../_shared/common.ts';

export default definePlugin({
    id: 'image.flip',
    name: 'Flip / mirror image',
    category: 'image',
    description: 'Flip an image horizontally or vertically.',
    inputs: {
        src: S.string('Source image path', { required: true }),
        direction: S.string('Flip direction', { enum: ['horizontal', 'vertical', 'both'], default: 'horizontal' }),
        out: S.string('Output file name'),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const dir = String(input.direction ?? 'horizontal');
        const vf = dir === 'horizontal' ? 'hflip' : dir === 'vertical' ? 'vflip' : 'hflip,vflip';
        const dest = ctx.out(String(input.out ?? `flip_${Date.now()}.png`));
        await ffmpeg(['-y', '-i', src, '-vf', vf, dest]);
        return { outputs: [{ path: dest, kind: 'image' }] };
    },
});
