import { definePlugin } from '../../core/define.ts';
import { probe } from '../../core/media.ts';
import { S, requireFile } from '../_shared/common.ts';
import * as fs from 'node:fs';

export default definePlugin({
    id: 'image.info',
    name: 'Inspect image',
    category: 'image',
    description: 'Return dimensions, format and file size for an image.',
    inputs: { src: S.string('Image path', { required: true }) },
    outputs: ['data'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const info = await probe(src);
        const stream = (info.streams ?? []).find((s: Record<string, unknown>) => s.codec_type === 'video') ?? {};
        const meta = {
            path: src,
            width: stream.width ?? null,
            height: stream.height ?? null,
            codec: stream.codec_name ?? null,
            pixFmt: stream.pix_fmt ?? null,
            bytes: fs.statSync(src).size,
        };
        const dest = ctx.out(`info_${Date.now()}.json`);
        fs.writeFileSync(dest, JSON.stringify(meta, null, 2), 'utf8');
        return { outputs: [{ path: dest, kind: 'data', meta }] };
    },
});
