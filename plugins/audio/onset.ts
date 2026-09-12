import { definePlugin } from '../../core/define.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { run, resolveFfmpeg } from '../../core/media.ts';

/**
 * audio.onset - onsets-per-minute + tempo-band classification from audio.
 *
 * Reuses the same signalstats peak-level approach as audio.beat but with
 * a different aggregation:
 *   - measure a denser onset grid (every 100 ms window)
 *   - rising-edge count = onset count
 *   - opm = onsets / minutes
 *   - intensity buckets:
 *       <  20 opm  : "calm"      (target BPM 80)
 *       20-60 opm  : "mid"       (target BPM 104)
 *       >= 60 opm  : "energetic" (target BPM 128)
 *
 * Returns the suggested BPM-for-intensity plus a list of onset timestamps
 * (top-50 most confident) so the agent can drive a cut sequence.
 */
export default definePlugin({
    id: 'audio.onset',
    name: 'Detect onsets per minute + intensity bucket',
    category: 'analyze',
    description:
        'Measures onsets-per-minute from an audio file, classifies the track as calm/mid/energetic, returns the matching target BPM and top-50 onset timestamps.',
    inputs: {
        file: S.string('Path to audio/video file', { required: true }),
        out: S.string('Output JSON path', { default: 'onsets.json' }),
    },
    outputs: ['json'],
    async run({ input, ctx }) {
        const file = requireFile(String(input.file ?? ''), 'file');
        const out = ctx.out(String(input.out ?? 'onsets.json'));

        const bin = resolveFfmpeg();
        // Use astats with reset=1 (per-frame) so each frame's Peak_level is printed.
        // We then derive a 100 ms onset grid by binning the per-frame events into time buckets.
        const args = [
            '-hide_banner',
            '-v',
            'info',
            '-i',
            file,
            '-vn',
            '-af',
            'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.Peak_level',
            '-f',
            'null',
            '-',
        ];
        const r = await run(bin, args, { timeoutMs: 180_000 });
        const text = (r.stdout || '') + '\n' + (r.stderr || '');

        // Parse: each line "frame:N pts:... pts_time:T" then "lavfi.astats.Overall.Peak_level=VAL".
        const events: { t: number; peak: number }[] = [];
        const re = /pts_time:([\d.]+)[^\n]*\n[^\n]*Peak_level=([-\d.e+]+)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
            events.push({ t: Number(m[1]), peak: Number(m[2]) });
        }
        if (events.length < 2) {
            await fs.mkdir(path.dirname(out), { recursive: true });
            await fs.writeFile(out, JSON.stringify({ error: 'NO_AUDIO_OR_NO_PEAKS', events: events.length }, null, 2), 'utf8');
            return { outputs: [{ path: out, kind: 'json' as const, meta: { error: 'NO_AUDIO_OR_NO_PEAKS' } }] };
        }

        // Bin per-frame peak levels into 100 ms buckets; take the max peak per bucket.
        const BUCKET = 0.1;
        const buckets = new Map<number, number>();
        for (const e of events) {
            const k = Math.floor(e.t / BUCKET) * BUCKET;
            const cur = buckets.get(k) ?? -Infinity;
            if (e.peak > cur) buckets.set(k, e.peak);
        }
        const series = [...buckets.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([t, peak]) => ({ t, peak }));
        if (series.length < 2) {
            await fs.mkdir(path.dirname(out), { recursive: true });
            await fs.writeFile(out, JSON.stringify({ error: 'BUCKETING_FAILED', events: events.length }, null, 2), 'utf8');
            return { outputs: [{ path: out, kind: 'json' as const, meta: { error: 'BUCKETING_FAILED' } }] };
        }

        const lastT = series[series.length - 1].t + BUCKET;
        const duration = lastT > 0 ? lastT : 1;
        const peaks = series.map((e) => e.peak);

        // Detect rising edges: a sample whose peak is more than X dB above the running
        // local minimum AND above a -20 dB absolute threshold. To avoid double-counting
        // a transient, also require the new peak to be at least 6 dB above the last
        // accepted onset.
        const ABS = -20;
        const REL = 3;
        const onsets: { t: number; peak: number }[] = [];
        let localMin = peaks[0];
        for (let i = 1; i < events.length; i++) {
            const p = peaks[i];
            const lastPeak = onsets.length > 0 ? onsets[onsets.length - 1].peak : -120;
            if (p > localMin + REL && p > ABS && p > lastPeak - 6) {
                onsets.push({ t: events[i].t, peak: p });
                localMin = p;
            } else if (p < localMin) {
                localMin = p;
            }
        }

        const opm = (onsets.length / duration) * 60;
        const intensity =
            opm < 20 ? 'calm' : opm < 60 ? 'mid' : 'energetic';
        const targetBpm = intensity === 'calm' ? 80 : intensity === 'mid' ? 104 : 128;

        // Top-50 highest-peak onsets.
        const top = [...onsets].sort((a, b) => b.peak - a.peak).slice(0, 50).sort((a, b) => a.t - b.t);

        const result = {
            file,
            duration: +duration.toFixed(3),
            bucketSec: BUCKET,
            windows: series.length,
            onsets: onsets.length,
            opm: +opm.toFixed(2),
            intensity,
            targetBpm,
            topOnsets: top,
        };
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, JSON.stringify(result, null, 2), 'utf8');
        return { outputs: [{ path: out, kind: 'json' as const, meta: { opm, intensity, targetBpm } }] };
    },
});