import * as fs from 'node:fs';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { S, requireFile, resolveOutPath, num } from '../_shared/common.ts';

/**
 * edit.transcript_cut — cut picture by what was SAID.
 *
 * This is the defining move of agentic editing: instead of scrubbing a
 * timeline, you read the transcript and decide. "Drop every um and ah."
 * "Keep only the part about pricing." "Tighten the pauses."
 *
 * `voice.stt` already produces per-segment timings; this turns those plus your
 * criteria into an explicit clip list for render.timeline. It decides nothing on
 * its own — you choose what to keep, and the same transcript plus the same rules
 * always produces the same cut.
 *
 * Output is a plan, not a render, so you can read the cut before committing to it.
 */
export default definePlugin({
    id: 'edit.transcript_cut',
    name: 'Cut by transcript',
    category: 'edit',
    description: 'Turn a transcript into a clip list: drop filler words, keep only matching lines, and tighten silences.',
    inputs: {
        transcript: S.string('Path to the JSON written by voice.stt', { required: true }),
        src: S.string('Media file the timings refer to (defaults to the file in the transcript)'),
        keep: S.string('Keep only segments whose text matches this regex (case-insensitive)'),
        drop: S.string('Drop segments whose text matches this regex (case-insensitive)'),
        removeFillers: S.bool('Drop segments that are nothing but filler words', { default: false }),
        collapseGaps: S.bool('Trim pauses longer than maxGapSeconds down to that length', { default: false }),
        maxGapSeconds: S.number('Longest pause to allow when collapsing', { default: 0.35, minimum: 0 }),
        paddingSeconds: S.number('Breathing room kept either side of each kept segment', { default: 0.06, minimum: 0 }),
        mergeWithinSeconds: S.number('Merge kept segments separated by less than this', { default: 0.12, minimum: 0 }),
        minClipSeconds: S.number('Discard kept segments shorter than this', { default: 0.2, minimum: 0 }),
        out: S.string('Output file name for the cut plan (.json)', { default: 'transcript-cut.json' }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        const transcriptPath = requireFile(input.transcript, 'transcript');
        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(fs.readFileSync(transcriptPath, 'utf8')) as Record<string, unknown>;
        } catch (err) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: `Could not read a transcript from "${transcriptPath}".`,
                reason: String((err as Error)?.message ?? err),
                input: { transcript: transcriptPath },
                retryable: true,
                hint: 'Pass the JSON produced by voice.stt — it has a "segments" array of {start, end, text}.',
            });
        }

        const rawSegments = Array.isArray(parsed.segments) ? (parsed.segments as Record<string, unknown>[]) : [];
        if (!rawSegments.length) {
            throw new PluginFailure({
                code: 'EMPTY_GRID',
                message: 'The transcript has no segments.',
                reason: 'voice.stt found no speech, or the file is not a transcript.',
                input: { transcript: transcriptPath },
                retryable: true,
                hint: 'Check the transcript JSON, or re-run voice.stt with a larger --input model.',
            });
        }

        const segments = rawSegments
            .map((s) => ({ start: num(s?.start, 0), end: num(s?.end, 0), text: String(s?.text ?? '').trim() }))
            .filter((s) => s.end > s.start)
            .sort((a, b) => a.start - b.start);

        // A segment is filler when, stripped of punctuation and case, it is only
        // hesitation sounds or discourse markers.
        const FILLER = /^(u+m+|u+h+|e+r+m*|h+m+|a+h+|o+h+|like|you know|i mean|sort of|kind of|basically|literally|actually|right|okay|ok|so|well|yeah|yep|mm+|mhm+|ah+|eh)[\s.,!?-]*$/i;
        const isFiller = (t: string) => FILLER.test(t.trim().replace(/\s+/g, ' '));

        const compile = (value: unknown, field: string): RegExp | null => {
            if (value === undefined || value === null || value === '') return null;
            try {
                return new RegExp(String(value), 'i');
            } catch (err) {
                throw new PluginFailure({
                    code: 'INVALID_INPUT',
                    message: `The "${field}" pattern is not a valid regular expression.`,
                    reason: String((err as Error)?.message ?? err),
                    input: { [field]: value },
                    retryable: true,
                    hint: 'Escape special characters, e.g. pricing\\? for a literal question mark.',
                });
            }
        };

        const keepRe = compile(input.keep, 'keep');
        const dropRe = compile(input.drop, 'drop');

        const kept: { start: number; end: number; text: string }[] = [];
        const dropped: { text: string; reason: string }[] = [];

        for (const s of segments) {
            if (input.removeFillers === true && isFiller(s.text)) {
                dropped.push({ text: s.text, reason: 'filler' });
                continue;
            }
            if (keepRe && !keepRe.test(s.text)) {
                dropped.push({ text: s.text, reason: 'not in keep pattern' });
                continue;
            }
            if (dropRe && dropRe.test(s.text)) {
                dropped.push({ text: s.text, reason: 'matched drop pattern' });
                continue;
            }
            kept.push(s);
        }

        if (!kept.length) {
            throw new PluginFailure({
                code: 'NO_SEGMENTS',
                message: 'Every segment was filtered out.',
                reason: `${segments.length} segments in, 0 survived the criteria.`,
                input: { keep: input.keep, drop: input.drop, removeFillers: input.removeFillers },
                retryable: true,
                hint: 'Loosen the keep/drop patterns, or turn off removeFillers.',
            });
        }

        const pad = num(input.paddingSeconds, 0.06);
        const mergeWithin = num(input.mergeWithinSeconds, 0.12);
        const minClip = num(input.minClipSeconds, 0.2);

        // Merge neighbours, then apply padding. Collapsing gaps happens by
        // merging across them, which is exactly what a tighter cut is.
        const collapse = input.collapseGaps === true;
        const maxGap = num(input.maxGapSeconds, 0.35);

        const ranges: { start: number; end: number }[] = [];
        for (const s of kept) {
            const prev = ranges[ranges.length - 1];
            const gap = prev ? s.start - prev.end : Infinity;
            const threshold = collapse ? maxGap : mergeWithin;
            if (prev && gap <= threshold) {
                prev.end = Math.max(prev.end, s.end);
            } else {
                ranges.push({ start: s.start, end: s.end });
            }
        }

        // voice.stt records the file it transcribed as "source".
        const srcFile = String(input.src ?? parsed.source ?? parsed.file ?? '');
        if (!srcFile) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'No source media file could be determined.',
                reason: 'The transcript has no "file" field and no src was supplied.',
                input: { transcript: transcriptPath },
                retryable: true,
                hint: 'Pass --input src=<media file> explicitly.',
            });
        }

        const clips: { src: string; start: number; duration: number }[] = [];
        for (const r of ranges) {
            const start = Math.max(0, Number((r.start - pad).toFixed(3)));
            const duration = Number((r.end - r.start + pad * 2).toFixed(3));
            if (duration < minClip) continue;
            clips.push({ src: srcFile, start, duration });
        }

        if (!clips.length) {
            throw new PluginFailure({
                code: 'NO_SEGMENTS',
                message: 'No usable clips after applying the minimum clip length.',
                reason: `minClipSeconds=${minClip}`,
                input: { minClipSeconds: minClip },
                retryable: true,
                hint: 'Lower minClipSeconds, or use a transcript with longer segments.',
            });
        }

        const total = Number(clips.reduce((a, c) => a + c.duration, 0).toFixed(3));
        const sourceEnd = segments[segments.length - 1].end;
        const plan = {
            clips,
            src: srcFile,
            segmentsIn: segments.length,
            segmentsKept: kept.length,
            dropped,
            clipCount: clips.length,
            totalSeconds: total,
            sourceSeconds: Number(sourceEnd.toFixed(3)),
            removedSeconds: Number((sourceEnd - total).toFixed(3)),
            note: 'Feed "clips" to render.timeline. Each clip carries a source in-point, so the cut is non-destructive.',
        };

        const dest = resolveOutPath(ctx, String(input.out ?? 'transcript-cut.json'));
        fs.writeFileSync(dest, JSON.stringify(plan, null, 2), 'utf8');
        return {
            outputs: [
                {
                    path: dest,
                    kind: 'data',
                    meta: { clipCount: clips.length, totalSeconds: total, removedSeconds: plan.removedSeconds },
                },
            ],
        };
    },
});
