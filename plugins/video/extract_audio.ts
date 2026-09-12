import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile } from '../_shared/common.ts';

export default definePlugin({
    id: 'video.extract_audio',
    name: 'Extract audio from video',
    category: 'video',
    description: 'Pull the audio track out of a video into an audio file.',
    inputs: {
        src: S.string('Source video path', { required: true }),
        format: S.string('Output audio format', { enum: ['mp3', 'wav', 'aac', 'm4a'], default: 'mp3' }),
        out: S.string('Output file name'),
    },
    outputs: ['audio'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const format = String(input.format ?? 'mp3');
        const dest = ctx.out(String(input.out ?? `audio.${format}`));
        const codec = format === 'wav' ? 'pcm_s16le' : format === 'aac' || format === 'm4a' ? 'aac' : 'libmp3lame';
        await ffmpeg(['-y', '-i', src, '-vn', '-c:a', codec, dest]);
        return { outputs: [{ path: dest, kind: 'audio' }] };
    },
});
