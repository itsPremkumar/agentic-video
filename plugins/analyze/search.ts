import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { S, requireFile, resolveOutPath, num } from '../_shared/common.ts';

/**
 * analyze.search — find the shot, not just cut it.
 *
 * The other half of transcript-driven editing. `edit.transcript_cut` cuts once
 * you know what you want; this is how you find it. Given transcripts from
 * `voice.stt` across any number of files, it finds every place a phrase occurs
 * and returns the timecodes — "where does she mention pricing?", "find every
 * take where the name is wrong".
 *
 * This is text search, not semantic search. It will not find "the bit about
 * cost" when the speaker said "price". That limitation is deliberate: it is
 * deterministic, needs no model, and always returns the same answer. A caller
 * that wants meaning can pass a regex.
 */
export default definePlugin({
    id: 'analyze.search',
    name: 'Search transcripts',
    category: 'analyze',
    description: 'Find a phrase across one or more transcripts and return the timecodes where it occurs.',
    inputs: {
        transcripts: S.array('Paths to transcript JSON files from voice.stt'),
        transcript: S.string('...or a single transcript path'),
        query: S.string('Text or pattern to search for', { required: true }),
        regex: S.bool('Treat the query as a regular expression', { default: false }),
        caseSensitive: S.bool('Case-sensitive match', { default: false }),
        contextSegments: S.int('Segments of surrounding context to include', { default: 1, minimum: 0 }),
        maxResults: S.int('Maximum matches to return (0 = all)', { default: 0 }),
        out: S.string('Output file name (.json)', { default: 'search-results.json' }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        const list: string[] = [];
        if (Array.isArray(input.transcripts)) list.push(...(input.transcripts as unknown[]).map(String));
        if (input.transcript) list.push(String(input.transcript));
        const files = list.filter(Boolean);
        if (!files.length) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'Provide at least one transcript.',
                input: { transcripts: input.transcripts, transcript: input.transcript },
                retryable: true,
                hint: 'Pass the JSON written by voice.stt.',
            });
        }

        const query = String(input.query ?? '').trim();
        if (!query) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'query is required.',
                input: { query },
                retryable: true,
            });
        }

        const isRegex = input.regex === true;
        const flags = input.caseSensitive === true ? 'g' : 'gi';
        let matcher: RegExp;
        try {
            // A plain query is a literal string, so metacharacters must not
            // silently become a pattern the caller did not ask for.
            const pattern = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            matcher = new RegExp(pattern, flags);
        } catch (err) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'The query is not a valid regular expression.',
                reason: String((err as Error)?.message ?? err),
                input: { query, regex: isRegex },
                retryable: true,
                hint: 'Escape special characters, or set regex=false for a literal search.',
            });
        }

        const context = num(input.contextSegments, 1);
        const max = num(input.maxResults, 0);

        type Hit = Record<string, unknown>;
        const hits: Hit[] = [];
        const searched: Record<string, unknown>[] = [];

        for (const file of files) {
            const p = requireFile(file, 'transcripts');
            let parsed: Record<string, unknown>;
            try {
                parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
            } catch (err) {
                throw new PluginFailure({
                    code: 'INVALID_INPUT',
                    message: `Could not read a transcript from "${p}".`,
                    reason: String((err as Error)?.message ?? err),
                    input: { file: p },
                    retryable: true,
                    hint: 'Pass the JSON written by voice.stt — it has a "segments" array.',
                });
            }

            const segments = Array.isArray(parsed.segments) ? (parsed.segments as Record<string, unknown>[]) : [];
            // The transcript records the media it came from, so timings can be
            // resolved back to a real file.
            const media = String(parsed.source ?? parsed.file ?? '');
            let count = 0;

            for (const [i, seg] of segments.entries()) {
                const text = String(seg?.text ?? '');
                matcher.lastIndex = 0;
                if (!matcher.test(text)) continue;

                const before: string[] = [];
                const after: string[] = [];
                for (let j = Math.max(0, i - context); j < i; j++) before.push(String(segments[j]?.text ?? ''));
                for (let j = i + 1; j <= Math.min(segments.length - 1, i + context); j++) after.push(String(segments[j]?.text ?? ''));

                hits.push({
                    file: p,
                    media: media || null,
                    segmentIndex: i,
                    start: num(seg?.start, 0),
                    end: num(seg?.end, 0),
                    text: text.trim(),
                    match: query,
                    contextBefore: before,
                    contextAfter: after,
                });
                count++;
            }

            searched.push({ file: p, media: media || null, segments: segments.length, matches: count });
        }

        const limited = max > 0 ? hits.slice(0, max) : hits;
        const dest = resolveOutPath(ctx, String(input.out ?? 'search-results.json'));
        fs.writeFileSync(
            dest,
            JSON.stringify(
                {
                    query,
                    regex: isRegex,
                    caseSensitive: input.caseSensitive === true,
                    searched,
                    matchCount: hits.length,
                    results: limited,
                    hint:
                        hits.length > 0
                            ? 'Feed start/end to video.trim, or build clips for render.timeline.'
                            : 'No matches. Try regex=true with a looser pattern, or check the transcripts cover this footage.',
                },
                null,
                2,
            ),
            'utf8',
        );

        return {
            outputs: [{ path: dest, kind: 'data', meta: { matches: hits.length, files: files.length } }],
            notes: [hits.length ? `Found ${hits.length} match(es).` : `No matches for "${query}".`],
        };
    },
});
