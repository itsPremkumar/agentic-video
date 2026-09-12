import * as fs from 'node:fs';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { S, requireFile, num, resolveOutPath } from '../_shared/common.ts';

/**
 * analyze.chapters — auto chapter / marker generation.
 *
 * Reads a transcript JSON (from voice.stt or voice.diarize) and generates
 * chapter markers at topic boundaries. Uses a sliding window to detect
 * significant shifts in vocabulary as chapter break points.
 *
 * Output is compatible with YouTube chapters and podcast markers.
 */
export default definePlugin({
    id: 'analyze.chapters',
    name: 'Auto chapter generator',
    category: 'analyze',
    description: 'Analyze a transcript and generate chapter markers at topic boundaries.',
    inputs: {
        transcript: S.string('Path to transcript JSON (voice.stt or voice.diarize output)', { required: true }),
        minDuration: S.number('Minimum chapter duration in seconds', { default: 30, minimum: 5 }),
        maxDuration: S.number('Maximum chapter duration in seconds', { default: 300, minimum: 30 }),
        count: S.int('Target number of chapters (0 = auto)', { default: 0, minimum: 0 }),
        out: S.string('Output JSON file name', { default: 'chapters.json' }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        const transcriptPath = requireFile(input.transcript, 'transcript');
        const minDuration = num(input.minDuration, 30);
        const maxDuration = num(input.maxDuration, 300);
        const targetCount = num(input.count, 0);

        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(fs.readFileSync(transcriptPath, 'utf8')) as Record<string, unknown>;
        } catch (err) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: `Could not read transcript from "${transcriptPath}".`,
                reason: String((err as Error)?.message ?? err),
                input: { transcript: transcriptPath },
                retryable: true,
                hint: 'Pass the JSON produced by voice.stt or voice.diarize.',
            });
        }

        const segments = Array.isArray(parsed.segments) ? (parsed.segments as Record<string, unknown>[]) : [];
        if (!segments.length) {
            throw new PluginFailure({
                code: 'EMPTY_TRANSCRIPT',
                message: 'The transcript has no segments.',
                input: { transcript: transcriptPath },
                retryable: true,
            });
        }

        // Normalize segments
        const segs = segments
            .map((s) => ({
                start: num(s?.start, 0),
                end: num(s?.end, 0),
                text: String(s?.text ?? '').trim().toLowerCase(),
            }))
            .filter((s) => s.end > s.start && s.text.length > 0);

        if (!segs.length) {
            throw new PluginFailure({
                code: 'EMPTY_TRANSCRIPT',
                message: 'No valid segments with text found.',
                input: { transcript: transcriptPath },
                retryable: true,
            });
        }

        const totalDuration = segs[segs.length - 1].end;

        // Build vocabulary vectors per segment
        const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to', 'of', 'and', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us', 'was', 'has', 'had', 'did', 'does', 'doing', 'done']);

        const tokenize = (text: string): string[] => {
            return text
                .replace(/[^\w\s]/g, ' ')
                .split(/\s+/)
                .filter((w) => w.length > 2 && !stopWords.has(w));
        };

        // Sliding window similarity to detect topic shifts
        const windowSize = Math.max(3, Math.floor(segs.length / 10));
        const similarities: Array<{ index: number; time: number; similarity: number }> = [];

        for (let i = windowSize; i < segs.length - windowSize; i++) {
            const before = segs.slice(i - windowSize, i);
            const after = segs.slice(i, i + windowSize);

            const beforeWords = new Set(before.flatMap((s) => tokenize(s.text)));
            const afterWords = new Set(after.flatMap((s) => tokenize(s.text)));

            if (beforeWords.size === 0 || afterWords.size === 0) continue;

            const intersection = new Set([...beforeWords].filter((w) => afterWords.has(w)));
            const union = new Set([...beforeWords, ...afterWords]);
            const jaccard = intersection.size / union.size;

            similarities.push({
                index: i,
                time: segs[i].start,
                similarity: jaccard,
            });
        }

        // Low similarity = topic shift = chapter boundary
        similarities.sort((a, b) => a.similarity - b.similarity);

        // Pick boundaries respecting min/max duration
        const boundaries: number[] = [0];
        const used = new Set<number>();
        used.add(0);

        const autoCount = targetCount || Math.max(3, Math.floor(totalDuration / 120));

        for (const sim of similarities) {
            if (boundaries.length >= autoCount) break;

            const lastBoundary = boundaries[boundaries.length - 1];
            const duration = sim.time - lastBoundary;

            if (duration < minDuration) continue;
            if (duration > maxDuration && boundaries.length > 1) continue;

            // Check it's not too close to any existing boundary
            const tooClose = boundaries.some((b) => Math.abs(b - sim.time) < minDuration);
            if (tooClose) continue;

            boundaries.push(sim.time);
        }

        boundaries.sort((a, b) => a - b);
        if (boundaries[boundaries.length - 1] < totalDuration - minDuration) {
            boundaries.push(totalDuration);
        }

        // Generate chapter titles from content
        const chapters = boundaries.slice(0, -1).map((start, i) => {
            const end = boundaries[i + 1];
            const chapterSegs = segs.filter((s) => s.start >= start && s.end <= end);
            const words = chapterSegs.flatMap((s) => tokenize(s.text));
            const freq: Record<string, number> = {};
            for (const w of words) {
                freq[w] = (freq[w] || 0) + 1;
            }
            const topWords = Object.entries(freq)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([w]) => w);

            const title = topWords.length > 0
                ? topWords.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
                : `Chapter ${i + 1}`;

            return {
                start: Number(start.toFixed(2)),
                end: Number(end.toFixed(2)),
                duration: Number((end - start).toFixed(2)),
                title,
            };
        });

        const dest = resolveOutPath(ctx, String(input.out ?? 'chapters.json'));
        fs.writeFileSync(dest, JSON.stringify({
            source: transcriptPath,
            totalDuration: Number(totalDuration.toFixed(2)),
            chapterCount: chapters.length,
            chapters,
            youtubeFormat: chapters.map((c) => `${formatTime(c.start)} ${c.title}`).join('\n'),
        }, null, 2));

        return {
            outputs: [
                {
                    path: dest,
                    kind: 'data',
                    meta: { chapters: chapters.length, duration: totalDuration },
                },
            ],
        };
    },
});

function formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}
