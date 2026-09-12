import { definePlugin } from '../../core/define.ts';
import { S } from '../_shared/common.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { dHashFrames } from '../image/_perceptual.ts';
import { durationOf } from '../../core/media.ts';

/**
 * video.dedup - find duplicate / near-duplicate frames in a video.
 *
 * Strategy:
 *   1. Sample N frames evenly spaced across the duration.
 *   2. Compute dHash (64-bit) for each frame (9x8 grayscale).
 *   3. Compare all pairs; hamming distance <= threshold -> same group.
 *   4. Return clusters with timestamps so the agent can pick the best
 *      representative and trim the rest.
 *
 * Deterministic, zero-dependency. 1 frame takes ~50-150 ms to hash.
 */
export default definePlugin({
    id: 'video.dedup',
    name: 'Find duplicate / near-duplicate frames in a video (dHash)',
    category: 'analyze',
    description:
        'Sample frames, dHash each (9x8 grayscale -> 64-bit), cluster near-duplicates via Hamming distance. Returns timestamped groups so the agent can dedup.',
    inputs: {
        file: S.string('Path to input video', { required: true }),
        frames: S.int('How many frames to sample', { default: 24, minimum: 4, maximum: 240 }),
        threshold: S.int('Hamming distance threshold (0-32, lower=stricter)', {
            default: 5,
            minimum: 0,
            maximum: 32,
        }),
        out: S.string('Output JSON path', { default: 'video.dedup.json' }),
    },
    outputs: ['json'],
    async run({ input, ctx }) {
        const file = String(input.file ?? '');
        const frames = Math.max(4, Math.min(240, Number(input.frames ?? 24)));
        const threshold = Math.max(0, Math.min(32, Number(input.threshold ?? 5)));
        const out = ctx.out(String(input.out ?? 'video.dedup.json'));

        const dur = await durationOf(file);
        if (!(dur > 0)) {
            return { outputs: [], warnings: ['Could not determine input duration.'] };
        }
        const samples = await dHashFrames(file, frames, dur);

        // Union-Find clustering by hamming distance.
        const parent = new Array(samples.length).fill(0).map((_, i) => i);
        const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
        const union = (a: number, b: number) => {
            const ra = find(a), rb = find(b);
            if (ra !== rb) parent[ra] = rb;
        };

        function hamming(a: string, b: string): number {
            let ai = BigInt('0x' + a), bi = BigInt('0x' + b), d = ai ^ bi, n = 0;
            while (d) { if (d & 1n) n++; d >>= 1n; }
            return n;
        }

        for (let i = 0; i < samples.length; i++) {
            for (let j = i + 1; j < samples.length; j++) {
                if (hamming(samples[i].hash, samples[j].hash) <= threshold) {
                    union(i, j);
                }
            }
        }

        const groups = new Map<number, { hash: string; timestamps: number[] }>();
        samples.forEach((s, i) => {
            const r = find(i);
            const g = groups.get(r) || { hash: s.hash, timestamps: [] };
            g.timestamps.push(+s.t.toFixed(3));
            groups.set(r, g);
        });

        const clusters = Array.from(groups.values())
            .filter((g) => g.timestamps.length > 1)
            .map((g) => ({
                representative: g.hash,
                count: g.timestamps.length,
                timestamps: g.timestamps,
                keep: g.timestamps[0],
            }))
            .sort((a, b) => b.count - a.count);

        const result = {
            source: file,
            duration: +dur.toFixed(3),
            sampled: samples.length,
            threshold,
            duplicateGroups: clusters.length,
            totalDuplicateFrames: clusters.reduce((s, c) => s + c.count, 0),
            clusters,
        };
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, JSON.stringify(result, null, 2), 'utf8');
        return {
            outputs: [{ path: out, kind: 'json' as const, meta: { groups: clusters.length, threshold } }],
        };
    },
});