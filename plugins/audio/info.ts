import * as fs from 'node:fs';
import { definePlugin } from '../../core/define.ts';
import { probe } from '../../core/media.ts';
import { S, requireFile } from '../_shared/common.ts';

export default definePlugin({
    id: 'audio.info',
    name: 'Inspect audio',
    category: 'audio',
    description: 'Return duration, codec, sample rate and loudness stats for an audio file.',
    inputs: { src: S.string('Audio path', { required: true }) },
    outputs: ['data'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const info = await probe(src);
        const a = (info.streams ?? []).find((s: Record<string, unknown>) => s.codec_type === 'audio') ?? {};
        const meta = {
            path: src,
            duration: Number(info.format?.duration ?? 0),
            codec: a.codec_name ?? null,
            sampleRate: a.sample_rate ?? null,
            channels: a.channels ?? null,
            bytes: fs.statSync(src).size,
        };
        const dest = ctx.out(`info_${Date.now()}.json`);
        fs.writeFileSync(dest, JSON.stringify(meta, null, 2), 'utf8');
        return { outputs: [{ path: dest, kind: 'data', meta }] };
    },
});
