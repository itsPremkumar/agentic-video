import * as fs from 'node:fs';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { S, requireFile, resolveOutPath, num, invalidInput } from '../_shared/common.ts';

/**
 * edit.beat_cut — turn a beat grid into an explicit clip list.
 *
 * `audio.beat` detects onsets/beats and writes a JSON grid, but nothing
 * consumed it: cutting on the beat meant the caller re-deriving the arithmetic.
 * This is that arithmetic, as a plugin.
 *
 * It makes no decisions. Given the same grid and the same files it produces the
 * same clip list every time — the caller still chooses the music, the files and
 * the grid. The output is a plan for `render.timeline`, not a rendered video.
 */
export default definePlugin({
    id: 'edit.beat_cut',
    name: 'Plan a beat-synced cut',
    category: 'edit',
    description: 'Convert an audio.beat grid into an explicit clip list for render.timeline, so every cut lands on an onset (or beat).',
    inputs: {
        files: S.array('Media files to cut between, in order (cycled if fewer than segments)', { required: true }),
        beats: S.string('Path to the JSON written by audio.beat', { required: true }),
        grid: S.string('Which marks to cut on', { enum: ['onsets', 'beats'], default: 'onsets' }),
        start: S.number('Timeline start in seconds', { default: 0, minimum: 0 }),
        end: S.number('Timeline end in seconds (0 = the grid duration)', { default: 0, minimum: 0 }),
        maxClipSeconds: S.number('Split any segment longer than this (0 = never)', { default: 0, minimum: 0 }),
        minClipSeconds: S.number('Absorb segments shorter than this into the next one (avoids flash frames)', { default: 0.25, minimum: 0 }),
        out: S.string('Output file name for the clip plan (.json)', { default: 'beat-cut.json' }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        const files = Array.isArray(input.files) ? (input.files as unknown[]).map(String).filter(Boolean) : [];
        if (!files.length) invalidInput('Provide at least one file to cut between.', { field: 'files' });

        const gridPath = requireFile(input.beats, 'beats');
        let grid: Record<string, unknown>;
        try {
            grid = JSON.parse(fs.readFileSync(gridPath, 'utf8')) as Record<string, unknown>;
        } catch (err) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: `Could not read a beat grid from "${gridPath}".`,
                reason: String((err as Error)?.message ?? err),
                input: { beats: gridPath },
                retryable: true,
                hint: 'Pass the file produced by audio.beat (it must be JSON with an "onsets" or "beats" array).',
            });
        }

        const which = String(input.grid ?? 'onsets');
        const marks = Array.isArray(grid[which])
            ? (grid[which] as unknown[]).map(Number).filter((n) => Number.isFinite(n))
            : [];
        if (!marks.length) {
            throw new PluginFailure({
                code: 'EMPTY_GRID',
                message: `The beat grid has no "${which}" entries.`,
                reason: 'audio.beat found no onsets above the threshold.',
                input: { beats: gridPath, grid: which },
                retryable: true,
                hint: 'Lower the threshold on audio.beat (e.g. --input threshold=-30) or use grid=beats.',
            });
        }

        const start = num(input.start, 0);
        const gridDuration = num(grid.duration, 0) || marks[marks.length - 1];
        const end = num(input.end, 0) || gridDuration;
        if (end <= start) {
            invalidInput('end must be greater than start.', { field: 'end', value: input.end });
        }

        const minClip = num(input.minClipSeconds, 0.25);

        // Cut points strictly inside the window, plus the window bounds.
        const rawCuts = marks.filter((m) => m > start && m < end).sort((a, b) => a - b);

        // Drop any cut that would leave a segment shorter than minClip — those
        // read as flash frames. Keeping the LATER mark absorbs the sliver into
        // the following segment rather than losing a beat.
        const cuts: number[] = [];
        let last = start;
        for (const m of rawCuts) {
            if (m - last < minClip) continue;
            if (end - m < minClip) continue;
            cuts.push(m);
            last = m;
        }
        const bounds = [start, ...cuts, end];

        const maxClip = num(input.maxClipSeconds, 0);
        const clips: { src: string; duration: number }[] = [];
        let fileIndex = 0;
        const takeFile = () => files[fileIndex++ % files.length];

        for (let i = 0; i < bounds.length - 1; i++) {
            let remaining = bounds[i + 1] - bounds[i];
            if (remaining <= 0.05) continue;
            // Optional: split an over-long segment across more files, still
            // keeping the segment boundaries exactly where the marks are.
            while (maxClip > 0 && remaining > maxClip + 0.05) {
                clips.push({ src: takeFile(), duration: Number(maxClip.toFixed(3)) });
                remaining -= maxClip;
            }
            clips.push({ src: takeFile(), duration: Number(remaining.toFixed(3)) });
        }

        if (!clips.length) {
            throw new PluginFailure({
                code: 'NO_SEGMENTS',
                message: 'The window contains no usable segments.',
                reason: `start=${start}s end=${end}s, marks=${marks.length}`,
                retryable: true,
                hint: 'Widen the window, or check that the grid matches this track.',
            });
        }

        const total = Number(clips.reduce((s, c) => s + c.duration, 0).toFixed(3));
        const plan = {
            clips,
            cuts: bounds,
            grid: which,
            tempo: num(grid.tempo, 0),
            beatDuration: num(grid.beatDuration, 0),
            clipCount: clips.length,
            totalSeconds: total,
            note: 'Feed "clips" to render.timeline. Transitions are intentionally absent — beat cuts are hard cuts.',
        };

        const dest = resolveOutPath(ctx, String(input.out ?? 'beat-cut.json'));
        fs.writeFileSync(dest, JSON.stringify(plan, null, 2), 'utf8');
        return { outputs: [{ path: dest, kind: 'data', meta: { clipCount: clips.length, totalSeconds: total } }] };
    },
});
