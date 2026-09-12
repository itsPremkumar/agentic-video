import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'export.gif',
    name: 'Export GIF',
    category: 'export',
    description: 'Convert a video segment into an animated GIF.',
    inputs: {
        src: S.string('Source video path', { required: true }),
        start: S.number('Start time in seconds', { default: 0 }),
        duration: S.number('Duration in seconds', { default: 3, minimum: 0.1 }),
        fps: S.int('GIF frame rate', { default: 12 }),
        width: S.int('GIF width (-1 keeps aspect)', { default: 480 }),
        out: S.string('Output file name', { default: 'output.gif' }),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const dest = ctx.out(String(input.out ?? 'output.gif'));
        const w = num(input.width, 480);
        await ffmpeg([
            '-y', '-ss', String(num(input.start, 0)), '-t', String(num(input.duration, 3)), '-i', src,
            '-vf', `fps=${num(input.fps, 12)},scale=${w}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
            '-loop', '0', dest,
        ]);
        return { outputs: [{ path: dest, kind: 'image' }] };
    },
});
