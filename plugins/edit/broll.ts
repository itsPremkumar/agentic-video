import * as fs from 'node:fs';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { S, requireFile, num, resolveOutPath } from '../_shared/common.ts';

/**
 * edit.broll — automatic B-roll insertion.
 *
 * Reads a transcript and identifies narrative/descriptive segments
 * that would benefit from B-roll coverage. Searches stock libraries
 * and returns a timeline specification with B-roll clips overlaid
 * at matching timecodes.
 *
 * The agent can then feed the timeline spec into render.timeline.
 */
export default definePlugin({
    id: 'edit.broll',
    name: 'Auto B-roll insertion',
    category: 'edit',
    description: 'Read a transcript, identify narrative segments, search stock libraries, and return a timeline with B-roll clips overlaid at matching timecodes.',
    inputs: {
        transcript: S.string('Path to transcript JSON (voice.stt or voice.diarize)', { required: true }),
        src: S.string('Primary video file (the talking-head footage)', { required: true }),
        maxClips: S.int('Maximum B-roll clips to insert', { default: 10, minimum: 1 }),
        minSegmentDuration: S.number('Minimum segment duration to qualify for B-roll', { default: 3, minimum: 1 }),
        out: S.string('Output JSON file name', { default: 'broll-timeline.json' }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        const transcriptPath = requireFile(input.transcript, 'transcript');
        const src = requireFile(input.src, 'src');
        const maxClips = num(input.maxClips, 10);
        const minDuration = num(input.minSegmentDuration, 3);

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

        // Score each segment for B-roll potential
        // Descriptive/narrative segments (containing visual words) get higher scores
        const visualWords = new Set([
            'show', 'see', 'look', 'watch', 'display', 'image', 'picture', 'video', 'scene',
            'place', 'location', 'building', 'city', 'country', 'world', 'nature', 'animal',
            'person', 'people', 'group', 'crowd', 'ocean', 'mountain', 'forest', 'sky',
            'water', 'fire', 'light', 'dark', 'color', 'red', 'blue', 'green', 'yellow',
            'big', 'small', 'huge', 'tiny', 'beautiful', 'ugly', 'old', 'new', 'ancient',
            'modern', 'fast', 'slow', 'moving', 'running', 'walking', 'flying', 'driving',
            'eating', 'drinking', 'working', 'playing', 'dancing', 'singing', 'talking',
            'happy', 'sad', 'angry', 'excited', 'scared', 'surprised', 'love', 'hate',
            'war', 'peace', 'battle', 'fight', 'construction', 'destruction', 'growth',
            'technology', 'computer', 'phone', 'screen', 'camera', 'machine', 'robot',
            'car', 'plane', 'train', 'boat', 'bike', 'road', 'bridge', 'house', 'room',
            'table', 'chair', 'door', 'window', 'wall', 'floor', 'ceiling', 'roof',
            'tree', 'flower', 'grass', 'leaf', 'river', 'lake', 'sea', 'beach', 'sand',
            'rock', 'stone', 'metal', 'wood', 'glass', 'paper', 'cloth', 'fabric',
        ]);

        const scoredSegments = segments
            .map((s) => {
                const start = num(s?.start, 0);
                const end = num(s?.end, 0);
                const text = String(s?.text ?? '').trim().toLowerCase();
                const words = text.split(/\s+/);
                const visualScore = words.filter((w) => visualWords.has(w.replace(/[^\w]/g, ''))).length;
                const duration = end - start;
                // Segments with visual words and reasonable duration score highest
                const score = visualScore * Math.min(duration, 10);
                return { start, end, duration, text, score, visualScore };
            })
            .filter((s) => s.duration >= minDuration)
            .sort((a, b) => b.score - a.score);

        const topSegments = scoredSegments.slice(0, maxClips);
        topSegments.sort((a, b) => a.start - b.start);

        // Generate B-roll suggestions (queries only — agent downloads separately)
        const brollSuggestions = topSegments.map((seg, i) => {
            const words = seg.text.split(/\s+/)
                .map((w) => w.replace(/[^\w]/g, ''))
                .filter((w) => w.length > 3 && visualWords.has(w))
                .slice(0, 3);

            const query = words.length > 0 ? words.join(' ') : seg.text.split(/\s+/).slice(0, 3).join(' ');

            return {
                id: `broll_${i + 1}`,
                start: seg.start,
                end: seg.end,
                duration: seg.duration,
                query,
                reason: seg.text.slice(0, 100),
            };
        });

        // Build timeline spec
        const timeline = {
            source: src,
            baseTrack: {
                src,
                start: 0,
                duration: segments.length > 0 ? num(segments[segments.length - 1]?.end, 0) : 0,
            },
            suggestions: brollSuggestions,
            note: 'Use image.download or video.download with each query, then assemble with render.timeline or video.overlay.',
        };

        const dest = resolveOutPath(ctx, String(input.out ?? 'broll-timeline.json'));
        fs.writeFileSync(dest, JSON.stringify(timeline, null, 2));

        return {
            outputs: [
                {
                    path: dest,
                    kind: 'data',
                    meta: {
                        suggestions: brollSuggestions.length,
                        segmentsAnalyzed: segments.length,
                    },
                },
            ],
        };
    },
});
