import * as fs from 'node:fs';
import { definePlugin } from '../../core/define.ts';
import { probe } from '../../core/media.ts';
import { S, requireFile } from '../_shared/common.ts';

export default definePlugin({
    id: 'video.info',
    name: 'Inspect video',
    category: 'video',
    description: 'Return duration, dimensions, codecs and streams for a video file.',
    inputs: { src: S.string('Video path', { required: true }) },
    outputs: ['data'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const info = await probe(src);
        const video = (info.streams ?? []).find((s: Record<string, unknown>) => s.codec_type === 'video') ?? {};
        const audio = (info.streams ?? []).find((s: Record<string, unknown>) => s.codec_type === 'audio');
        const meta = {
            path: src,
            duration: Number(info.format?.duration ?? 0),
            width: video.width ?? null,
            height: video.height ?? null,
            videoCodec: video.codec_name ?? null,
            fps: video.r_frame_rate ?? null,
            hasAudio: Boolean(audio),
            audioCodec: audio?.codec_name ?? null,
            bytes: fs.statSync(src).size,
        };
        const dest = ctx.out(`info_${Date.now()}.json`);
        fs.writeFileSync(dest, JSON.stringify(meta, null, 2), 'utf8');
        return { outputs: [{ path: dest, kind: 'data', meta }] };
    },
});
