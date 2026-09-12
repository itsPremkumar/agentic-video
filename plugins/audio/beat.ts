import * as fs from 'node:fs';
import { definePlugin } from '../../core/define.ts';
import { probe, resolveFfmpeg, run } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';

/**
 * audio.beat - detect BPM, onsets, and a beat grid from a music/audio track.
 *
 * Deterministic (no model, no deps): ffmpeg's `astats` emits a per-frame
 * Peak_level; onsets are frames whose peak crosses a threshold; the median
 * inter-onset interval gives the tempo; the beat grid is then regularised
 * onto 60/BPM spacing so downstream plugins can snap cuts to it.
 *
 * Outputs a JSON file with:
 *   tempo           - BPM (rounded)
 *   confidence      - 0..1 (how regular the detected intervals are)
 *   onsets[]        - raw detected onset times (seconds)
 *   beats[]         - regularised beat grid (seconds)
 *   beatDuration    - seconds per beat
 *   firstBeatOffset - seconds from 0 to the first beat
 */
export default definePlugin({
    id: 'audio.beat',
    name: 'Detect BPM, onsets and a beat grid',
    category: 'audio',
    description: 'Deterministic beat/BPM/onset detection via ffmpeg astats. Outputs a regularised beat grid for beat-synced cutting.',
    inputs: {
        file: S.string('Path to audio/video file', { required: true }),
        threshold: S.number('Onset peak threshold in dB (e.g. -20)', { default: -20 }),
        minInterval: S.number('Minimum seconds between onsets', { default: 0.15 }),
        out: S.string('Output JSON path', { default: 'beats.json' }),
    },
    outputs: ['json'],
    async run({ input, ctx }) {
        const file = requireFile(input.file, 'file');
        const threshold = Number(input.threshold ?? -20);
        const minInterval = Number(input.minInterval ?? 0.15);

        const info = await probe(file);
        const duration = Number(info.format?.duration ?? 0);

        // IMPORTANT: astats metadata is emitted at `info` level, so we must NOT
        // pass -loglevel error here. Use the raw runner with -v info.
        const res = await run(resolveFfmpeg(), [
            '-hide_banner', '-v', 'info',
            '-i', file,
            '-af', 'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.Peak_level',
            '-f', 'null', '-',
        ], { timeoutMs: 300_000 });

        const raw: number[] = [];
        for (const line of res.stderr.split(/\r?\n/)) {
            const m = /lavfi\.astats\.Overall\.Peak_level=([-\d.]+)/.exec(line);
            if (m) {
                const db = Number(m[1]);
                if (Number.isFinite(db)) raw.push(db);
            }
        }
        // astats frame rate is derived, not fixed: frames / duration.
        const fps = duration > 0 && raw.length > 0 ? raw.length / duration : 100;
        const peaks: Array<{ t: number; db: number }> = raw.map((db, i) => ({ t: i / fps, db }));

        // Onsets = frames crossing the threshold, after a local minimum window.
        const onsets: number[] = [];
        let last = -Infinity;
        for (let i = 1; i < peaks.length; i++) {
            const prev = peaks[i - 1].db;
            const cur = peaks[i].db;
            const t = peaks[i].t;
            // rising edge crossing the threshold
            if (prev < threshold && cur >= threshold && t - last >= minInterval) {
                onsets.push(Number(t.toFixed(3)));
                last = t;
            }
        }

        const intervals: number[] = [];
        for (let i = 1; i < onsets.length; i++) intervals.push(onsets[i] - onsets[i - 1]);
        const median = intervals.slice().sort((a, b) => a - b)[Math.floor(intervals.length / 2)] ?? 0;
        let tempo = median > 0 ? 60 / median : 0;
        // Fold into the musical range 60..180 BPM by doubling/halving.
        while (tempo > 0 && tempo < 60) tempo *= 2;
        while (tempo > 180) tempo /= 2;
        tempo = Math.round(tempo);

        const beatDuration = tempo > 0 ? 60 / tempo : 0;
        const firstBeat = onsets.length > 0 ? onsets[0] : 0;
        const beats: number[] = [];
        if (beatDuration > 0) {
            for (let b = firstBeat; b <= duration + beatDuration; b += beatDuration) {
                beats.push(Number(b.toFixed(3)));
            }
        }

        // Confidence = how tight the interval distribution is around the median.
        let confidence = 0;
        if (intervals.length > 4 && median > 0) {
            const near = intervals.filter((i) => Math.abs(i - median) < median * 0.25).length;
            confidence = Number((near / intervals.length).toFixed(3));
        }

        const report = {
            file,
            duration,
            tempo,
            confidence,
            beatDuration: Number(beatDuration.toFixed(4)),
            firstBeatOffset: Number(firstBeat.toFixed(3)),
            onsetCount: onsets.length,
            onsets: onsets.slice(0, 2000),
            beatCount: beats.length,
            beats: beats.slice(0, 2000),
            threshold,
        };

        const out = ctx.out(String(input.out ?? 'beats.json'));
        ensureParentDir(out);
        fs.writeFileSync(out, JSON.stringify(report, null, 2));

        return {
            outputs: [{
                path: out,
                kind: 'json' as const,
                meta: { tempo, confidence, beatDuration, onsetCount: onsets.length, beatCount: beats.length, duration },
            }],
            warnings: tempo === 0 ? ['no tempo detected — try lowering the threshold'] : [],
        };
    },
});