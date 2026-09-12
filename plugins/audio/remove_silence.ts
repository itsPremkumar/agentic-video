import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'audio.remove_silence',
    name: 'Remove silence from audio',
    category: 'audio',
    description: 'Cut silent passages out of an audio file.',
    inputs: {
        src: S.string('Source audio path', { required: true }),
        thresholdDb: S.number('Silence threshold in dB', { default: -35 }),
        minSilence: S.number('Minimum silence length in seconds to cut', { default: 0.4, minimum: 0.05 }),
        out: S.string('Output file name', { default: 'nosilence.mp3' }),
    },
    outputs: ['audio'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const dest = ctx.out(String(input.out ?? 'nosilence.mp3'));
        const af = `silenceremove=start_periods=-1:start_duration=${num(input.minSilence, 0.4)}:start_threshold=${num(input.thresholdDb, -35)}dB:detection=peak`;
        await ffmpeg(['-y', '-i', src, '-af', af, dest]);
        return { outputs: [{ path: dest, kind: 'audio' }] };
    },
});
