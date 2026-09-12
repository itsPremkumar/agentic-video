import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'audio.trim',
    name: 'Trim audio',
    category: 'audio',
    description: 'Cut a segment out of an audio file.',
    inputs: {
        src: S.string('Source audio path', { required: true }),
        start: S.number('Start time in seconds', { default: 0, minimum: 0 }),
        duration: S.number('Duration in seconds (omit = to end)'),
        out: S.string('Output file name', { default: 'trimmed.mp3' }),
    },
    outputs: ['audio'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const dur = input.duration === undefined ? undefined : num(input.duration, 0);
        if (dur !== undefined && dur <= 0) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'duration must be greater than 0.',
                input: { duration: input.duration },
                retryable: true,
            });
        }
        const dest = ctx.out(String(input.out ?? 'trimmed.mp3'));
        const args = ['-y', '-ss', String(num(input.start, 0)), '-i', src];
        if (dur !== undefined) args.push('-t', String(dur));
        args.push(dest);
        await ffmpeg(args);
        return { outputs: [{ path: dest, kind: 'audio' }] };
    },
});
