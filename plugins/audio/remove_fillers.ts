import * as fs from 'node:fs';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg, probe } from '../../core/media.ts';
import { S, requireFile, num, resolveOutPath } from '../_shared/common.ts';

/**
 * audio.remove_fillers — clean audio by removing filler words.
 *
 * Takes an audio file + transcript (from voice.stt or voice.diarize)
 * and produces a cleaned audio file with filler words removed and
 * gaps tightened. Unlike edit.transcript_cut which only produces a
 * plan, this plugin renders the actual cleaned audio.
 *
 * Supported fillers: um, uh, er, hm, ah, oh, like, you know,
 * i mean, sort of, kind of, basically, literally, actually, right,
 * okay, ok, so, well, yeah, yep, mm, mhm.
 */
export default definePlugin({
    id: 'audio.remove_fillers',
    name: 'Remove filler words from audio',
    category: 'audio',
    description: 'Take audio + transcript, detect filler words, and output a cleaned audio file with gaps tightened.',
    inputs: {
        src: S.string('Source audio file', { required: true }),
        transcript: S.string('Path to transcript JSON (voice.stt or voice.diarize)', { required: true }),
        collapseGaps: S.bool('Trim pauses longer than maxGapSeconds down to that length', { default: true }),
        maxGapSeconds: S.number('Longest pause to allow when collapsing', { default: 0.35, minimum: 0 }),
        paddingSeconds: S.number('Breathing room kept either side of each kept segment', { default: 0.06, minimum: 0 }),
        mergeWithinSeconds: S.number('Merge kept segments separated by less than this', { default: 0.12, minimum: 0 }),
        minClipSeconds: S.number('Discard kept segments shorter than this', { default: 0.2, minimum: 0 }),
        out: S.string('Output file name (.mp3/.wav)', { default: 'cleaned-audio.mp3' }),
    },
    outputs: ['audio'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const transcriptPath = requireFile(input.transcript, 'transcript');

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

        const rawSegments = Array.isArray(parsed.segments) ? (parsed.segments as Record<string, unknown>[]) : [];
        if (!rawSegments.length) {
            throw new PluginFailure({
                code: 'EMPTY_TRANSCRIPT',
                message: 'The transcript has no segments.',
                input: { transcript: transcriptPath },
                retryable: true,
            });
        }

        const segments = rawSegments
            .map((s) => ({ start: num(s?.start, 0), end: num(s?.end, 0), text: String(s?.text ?? '').trim() }))
            .filter((s) => s.end > s.start)
            .sort((a, b) => a.start - b.start);

        // Filler detection regex
        const FILLER = /^(u+m+|u+h+|e+r+m*|h+m+|a+h+|o+h+|like|you know|i mean|sort of|kind of|basically|literally|actually|right|okay|ok|so|well|yeah|yep|mm+|mhm+|ah+|eh)[\s.,!?-]*$/i;
        const isFiller = (t: string) => FILLER.test(t.trim().replace(/\s+/g, ' '));

        const pad = num(input.paddingSeconds, 0.06);
        const mergeWithin = num(input.mergeWithinSeconds, 0.12);
        const minClip = num(input.minClipSeconds, 0.2);
        const collapse = input.collapseGaps !== false;
        const maxGap = num(input.maxGapSeconds, 0.35);

        // Keep non-filler segments
        const kept: { start: number; end: number; text: string }[] = [];
        const dropped: { text: string; start: number; end: number }[] = [];

        for (const s of segments) {
            if (isFiller(s.text)) {
                dropped.push({ text: s.text, start: s.start, end: s.end });
                continue;
            }
            kept.push(s);
        }

        if (!kept.length) {
            throw new PluginFailure({
                code: 'NO_SEGMENTS',
                message: 'Every segment was a filler word.',
                reason: `${segments.length} segments in, 0 survived.`,
                input: { transcript: transcriptPath },
                retryable: true,
                hint: 'Check the transcript or use a different audio file.',
            });
        }

        // Merge neighbours
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

        // Get audio info for format
        const info = await probe(src);
        const audioStream = (info.streams ?? []).find((s: any) => s.codec_type === 'audio');
        const hasAudio = !!audioStream;

        if (!hasAudio) {
            throw new PluginFailure({
                code: 'NO_AUDIO',
                message: 'The source file has no audio stream.',
                input: { src },
                retryable: true,
            });
        }

        // Build trim + concat filter
        const dest = resolveOutPath(ctx, String(input.out ?? 'cleaned-audio.mp3'));
        const clips: { start: number; duration: number }[] = [];

        for (const r of ranges) {
            const start = Math.max(0, Number((r.start - pad).toFixed(3)));
            const duration = Number((r.end - r.start + pad * 2).toFixed(3));
            if (duration < minClip) continue;
            clips.push({ start, duration });
        }

        if (!clips.length) {
            throw new PluginFailure({
                code: 'NO_CLIPS',
                message: 'No usable clips after applying minimum clip length.',
                input: { minClipSeconds: minClip },
                retryable: true,
                hint: 'Lower minClipSeconds.',
            });
        }

        // Use segment protocol for concat
        const segmentList = clips.map((c, i) => {
            return `file '${src.replace(/'/g, "'\\''")}'\ninpoint ${c.start}\noutpoint ${c.start + c.duration}`;
        }).join('\n');

        const listPath = resolveOutPath(ctx, 'segments.txt');
        fs.writeFileSync(listPath, segmentList, 'utf8');

        await ffmpeg([
            '-y', '-f', 'concat', '-safe', '0',
            '-i', listPath,
            '-c:a', 'libmp3lame', '-q:a', '2',
            '-vn',
            dest,
        ]);

        const totalKept = clips.reduce((a, c) => a + c.duration, 0);
        const originalDuration = segments[segments.length - 1].end;

        return {
            outputs: [
                {
                    path: dest,
                    kind: 'audio',
                    meta: {
                        originalDuration: Number(originalDuration.toFixed(2)),
                        cleanedDuration: Number(totalKept.toFixed(2)),
                        removedSeconds: Number((originalDuration - totalKept).toFixed(2)),
                        fillersRemoved: dropped.length,
                    },
                },
            ],
            notes: [`Removed ${dropped.length} filler segments, saved ${(originalDuration - totalKept).toFixed(1)}s`],
        };
    },
});
