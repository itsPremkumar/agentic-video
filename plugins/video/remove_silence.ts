import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'video.remove_silence',
    name: 'Remove silence from video',
    category: 'video',
    description: 'Cut silent passages out of a video (also removes the matching picture).',
    inputs: {
        src: S.string('Source video path', { required: true }),
        thresholdDb: S.number('Silence threshold in dB (e.g. -35)', { default: -35 }),
        minSilence: S.number('Minimum silence length in seconds to cut', { default: 0.5, minimum: 0.05 }),
        out: S.string('Output file name', { default: 'nosilence.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const dest = ctx.out(String(input.out ?? 'nosilence.mp4'));
        const af = `silenceremove=start_periods=-1:start_duration=${num(input.minSilence, 0.5)}:start_threshold=${num(input.thresholdDb, -35)}dB:detection=peak`;
        await ffmpeg(['-y', '-i', src, '-af', af, '-c:v', 'copy', dest]);
        return { outputs: [{ path: dest, kind: 'video' }] };
    },
});
