import { definePlugin } from '../../core/define.ts';
import { S } from '../_shared/common.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { dHash, hammingHex } from './_perceptual.ts';

/**
 * image.dedup - cluster a list of images by perceptual similarity.
 *
 * Same algorithm as video.dedup but for static images. Useful for "B-roll
 * library cleanup" or "remove visually-redundant generated images".
 */
export default definePlugin({
    id: 'image.dedup',
    name: 'Cluster a list of images by perceptual similarity (dHash)',
    category: 'analyze',
    description:
        'Compute dHash (9x8 grayscale, 64-bit) for each image, cluster via Hamming distance threshold. Returns groups so the agent can prune duplicates.',
    inputs: {
        files: S.array('Array of image file paths', { required: true }),
        threshold: S.int('Hamming distance threshold (lower=stricter)', {
            default: 6,
            minimum: 0,
            maximum: 32,
        }),
        out: S.string('Output JSON path', { default: 'image.dedup.json' }),
    },
    outputs: ['json'],
    async run({ input, ctx }) {
        const files: string[] = [];
        if (Array.isArray(input.files)) {
            for (const f of input.files) {
                if (typeof f === 'string') files.push(f);
            }
        } else if (typeof input.files === 'string') {
            files.push(...String(input.files).split(/[\n,]/).map((s) => s.trim()).filter(Boolean));
        }
        if (!files.length) return { outputs: [], warnings: ['No files supplied.'] };

        const threshold = Math.max(0, Math.min(32, Number(input.threshold ?? 6)));
        const out = ctx.out(String(input.out ?? 'image.dedup.json'));

        const hashes: { file: string; hash: string }[] = [];
        for (const f of files) {
            try {
                hashes.push({ file: f, hash: await dHash(f) });
            } catch (e: any) {
                hashes.push({ file: f, hash: '0000000000000000' });
                // Continue - the agent will see missing hashes in the result.
            }
        }

        const parent: number[] = new Array(hashes.length).fill(0).map((_, i) => i);
        const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
        const union = (a: number, b: number): void => {
            const ra = find(a), rb = find(b);
            if (ra !== rb) parent[ra] = rb;
        };
        for (let i = 0; i < hashes.length; i++) {
            for (let j = i + 1; j < hashes.length; j++) {
                if (hammingHex(hashes[i].hash, hashes[j].hash) <= threshold) union(i, j);
            }
        }
        const groups = new Map<number, string[]>();
        hashes.forEach((h, i) => {
            const r = find(i);
            const g = groups.get(r) || [];
            g.push(h.file);
            groups.set(r, g);
        });

        const clusters = Array.from(groups.values())
            .filter((g) => g.length > 1)
            .map((files) => ({ count: files.length, keep: files[0], remove: files.slice(1) }))
            .sort((a, b) => b.count - a.count);

        const result = {
            count: hashes.length,
            threshold,
            duplicateGroups: clusters.length,
            clusters,
        };
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, JSON.stringify(result, null, 2), 'utf8');
        return { outputs: [{ path: out, kind: 'json' as const, meta: { groups: clusters.length } }] };
    },
});