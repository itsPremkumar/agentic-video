import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'video.thumbnail',
    name: 'Extract video frame',
    category: 'video',
    description: 'Grab a single frame from a video as an image.',
    inputs: {
        src: S.string('Source video path', { required: true }),
        time: S.number('Time in seconds to capture', { default: 1 }),
        format: S.string('Image format', { enum: ['png', 'jpg'], default: 'png' }),
        width: S.int('Optional width (-2 keeps aspect)'),
        out: S.string('Output file name'),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const format = String(input.format ?? 'png');
        const dest = ctx.out(String(input.out ?? `frame_${Date.now()}.${format}`));
        const args = ['-y', '-ss', String(num(input.time, 1)), '-i', src, '-frames:v', '1'];
        if (input.width) args.push('-vf', `scale=${num(input.width, -2)}:-2`);
        args.push(dest);
        await ffmpeg(args);
        return { outputs: [{ path: dest, kind: 'image' }] };
    },
});
