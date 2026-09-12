import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

const TRANSITIONS = [
    'fade', 'wipeleft', 'wiperight', 'wipeup', 'wipedown',
    'slideleft', 'slideright', 'slideup', 'slidedown',
    'circlecrop', 'rectcrop', 'distance', 'fadeblack', 'fadewhite',
    'radial', 'smoothleft', 'smoothright', 'smoothup', 'smoothdown',
    'circleopen', 'circleclose', 'vertopen', 'horzopen',
    'dissolve', 'pixelize', 'diagtl', 'diagbr', 'hlslice', 'hrslice',
];

export default definePlugin({
    id: 'transitions.xfade',
    name: 'Cross-fade two clips',
    category: 'transitions',
    description: 'Join two clips with an ffmpeg xfade transition.',
    inputs: {
        first: S.string('First clip path', { required: true }),
        second: S.string('Second clip path', { required: true }),
        transition: S.string('Transition name', { enum: TRANSITIONS, default: 'fade' }),
        duration: S.number('Transition duration in seconds', { default: 1, minimum: 0.1 }),
        out: S.string('Output file name', { default: 'transition.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const first = requireFile(input.first, 'first');
        const second = requireFile(input.second, 'second');
        const name = String(input.transition ?? 'fade');
        if (!TRANSITIONS.includes(name)) {
            throw new PluginFailure({
                code: 'UNKNOWN_TRANSITION',
                message: `Unsupported transition "${name}".`,
                input: { transition: name },
                retryable: true,
                hint: `Supported: ${TRANSITIONS.join(', ')}`,
            });
        }
        const dur = num(input.duration, 1);
        const dest = ctx.out(String(input.out ?? 'transition.mp4'));
        // Normalise both inputs so durations/fps line up for xfade.
        const filter =
            `[0:v]settb=AVTB,fps=30[a];[1:v]settb=AVTB,fps=30[b];` +
            `[a][b]xfade=transition=${name}:duration=${dur}:offset=OVERLAY_OFFSET[v]`;
        // xfade needs the offset; compute it from the first clip's duration.
        const { durationOf } = await import('../../core/media.ts');
        const firstDur = await durationOf(first);
        const offset = Math.max(0, firstDur - dur).toFixed(3);
        await ffmpeg([
            '-y', '-i', first, '-i', second,
            '-filter_complex', filter.replace('OVERLAY_OFFSET', offset),
            '-map', '[v]', '-c:a', 'copy', dest,
        ]);
        return { outputs: [{ path: dest, kind: 'video', meta: { transition: name, duration: dur, offset } }] };
    },
});
