import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'video.trim',
    name: 'Trim video',
    category: 'video',
    description: 'Cut a segment out of a video by start time and duration.',
    inputs: {
        src: S.string('Source video path', { required: true }),
        start: S.number('Start time in seconds', { default: 0, minimum: 0 }),
        duration: S.number('Duration in seconds (omit to trim to end)'),
        fast: S.bool('Copy streams without re-encoding (fast, start may snap to keyframe)', { default: true }),
        out: S.string('Output file name', { default: 'trimmed.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const start = num(input.start, 0);
        const dur = input.duration === undefined ? undefined : num(input.duration, 0);
        if (dur !== undefined && dur <= 0) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'duration must be greater than 0 seconds.',
                input: { duration: input.duration },
                retryable: true,
            });
        }
        const dest = ctx.out(String(input.out ?? 'trimmed.mp4'));
        const args = ['-y', '-ss', String(start)];
        if (input.fast !== false) args.push('-i', src, '-c', 'copy');
        else args.push('-i', src);
        if (dur !== undefined) args.push('-t', String(dur));
        args.push(dest);
        await ffmpeg(args);
        return { outputs: [{ path: dest, kind: 'video' }] };
    },
});
