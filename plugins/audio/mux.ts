import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile } from '../_shared/common.ts';

export default definePlugin({
    id: 'audio.mux',
    name: 'Set / replace video audio',
    category: 'audio',
    description: 'Replace a video\'s audio track, and optionally keep the original audio mixed underneath.',
    inputs: {
        video: S.string('Video path', { required: true }),
        audio: S.string('Audio path to use', { required: true }),
        keepOriginal: S.bool('Mix the original audio underneath at low volume', { default: false }),
        originalVolume: S.number('Volume of the original track when kept', { default: 0.15, minimum: 0, maximum: 1 }),
        out: S.string('Output file name', { default: 'muxed.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const video = requireFile(input.video, 'video');
        const audio = requireFile(input.audio, 'audio');
        const dest = ctx.out(String(input.out ?? 'muxed.mp4'));

        const args = ['-y', '-i', video, '-i', audio];
        if (input.keepOriginal) {
            args.push(
                '-filter_complex',
                `[1:a]aformat=sample_rates=48000:channel_layouts=stereo[new];` +
                    `[0:a]volume=${input.originalVolume ?? 0.15}[orig];` +
                    `[new][orig]amix=inputs=2:duration=first[a]`,
                '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-shortest',
            );
        } else {
            args.push('-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-shortest');
        }
        args.push(dest);
        await ffmpeg(args);
        return { outputs: [{ path: dest, kind: 'video' }] };
    },
});
