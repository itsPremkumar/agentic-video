import { definePlugin } from '../../core/define.ts';
import { S, requireFile } from '../_shared/common.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { probe } from '../../core/media.ts';

/**
 * image.aesthetic - heuristic aesthetic / quality score for an image asset.
 *
 * Based on three objective signals (no LLM):
 *   +2 pts  resolution >= 1280 x 720
 *   +1 pt   resolution >= 1920 x 1080 (HD-ready)
 *   +1 pt   aspect ratio between 0.4 and 2.5 (i.e. sane, not extreme)
 *   +1 pt   filesize > 200 KB
 *   +1 pt   non-zero actual pixel bit depth (>=8bpc)
 *
 * Score 0-5. 0 = clearly placeholder, 5 = production-grade still.
 */
export default definePlugin({
    id: 'image.aesthetic',
    name: 'Heuristic aesthetic / quality score for an image',
    category: 'analyze',
    description:
        'Returns a 0-5 score: +2 resolution >= 1280x720, +1 >= 1920x1080, +1 sane aspect ratio, +1 file size > 200KB, +1 valid bit-depth. No LLM.',
    inputs: {
        file: S.string('Image file path', { required: true }),
        out: S.string('Output JSON path', { default: 'aesthetic.json' }),
    },
    outputs: ['json'],
    async run({ input, ctx }) {
        const file = requireFile(String(input.file ?? ''), 'file');
        const out = ctx.out(String(input.out ?? 'aesthetic.json'));
        const stat = await fs.stat(file);
        const info = await probe(file);
        const streams = (info.streams || []).filter((s: any) => s.codec_type === 'video');
        const s = streams[0] || {};
        const W = Number(s.width) || 0;
        const H = Number(s.height) || 0;
        const bits = Number(s.bits_per_raw_sample ?? s.bits_per_sample ?? 8);
        const ar = W && H ? W / H : 0;

        const checks: { name: string; pass: boolean; pts: number }[] = [
            { name: 'min_hd_720p', pass: W >= 1280 && H >= 720, pts: 2 },
            { name: 'full_hd_1080p', pass: W >= 1920 && H >= 1080, pts: 1 },
            { name: 'sane_aspect_ratio', pass: ar >= 0.4 && ar <= 2.5, pts: 1 },
            { name: 'filesize_200kb', pass: stat.size > 200_000, pts: 1 },
            { name: 'valid_bit_depth', pass: bits >= 8, pts: 1 },
        ];
        const score = checks.reduce((a, c) => a + (c.pass ? c.pts : 0), 0);
        const rating = score >= 4 ? 'production' : score >= 3 ? 'good' : score >= 2 ? 'draft' : 'placeholder';
        const result = {
            file,
            width: W,
            height: H,
            aspectRatio: +ar.toFixed(3),
            filesizeBytes: stat.size,
            bitsPerChannel: bits,
            score,
            rating,
            checks,
        };
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, JSON.stringify(result, null, 2), 'utf8');
        return { outputs: [{ path: out, kind: 'json' as const, meta: { score, rating } }] };
    },
});