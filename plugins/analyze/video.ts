import * as fs from 'node:fs';
import { definePlugin } from '../../core/define.ts';
import { ffmpeg, probe } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';

/**
 * analyze.video - quality-control report for a video file.
 *
 * Detects:
 *   - black frames (long silent/black spans that may indicate broken assets)
 *   - frozen frames (freezedetect)
 *   - audio clipping (volumedetect peaks)
 *   - duration / size / codec / resolution / aspect / fps
 *
 * Returns a JSON report. Does NOT mutate the input file.
 */
export default definePlugin({
    id: 'analyze.video',
    name: 'Analyse a video file',
    category: 'analyze',
    description: 'QC report: black frames, freeze frames, audio peaks, codec/duration/aspect/fps.',
    inputs: {
        file: S.string('Path to video file', { required: true }),
        blackThreshold: S.number('Luma threshold for black frame (0.0 - 1.0)', { default: 0.05 }),
        blackMinDuration: S.number('Minimum duration (s) to count as a black segment', { default: 0.5 }),
        out: S.string('Output JSON report path', { default: 'video-report.json' }),
    },
    outputs: ['json'],
    async run({ input, ctx }) {
        const file = requireFile(input.file, 'file');
        const info = await probe(file);
        const streams = (info.streams ?? []) as Array<Record<string, unknown>>;
        const v = streams.find((s) => s.codec_type === 'video');
        const a = streams.find((s) => s.codec_type === 'audio');
        const duration = Number(info.format?.duration ?? 0);
        const size = Number(info.format?.size ?? 0);
        const bitRate = Number(info.format?.bit_rate ?? 0);

        const blackThreshold = Number(input.blackThreshold ?? 0.05);
        const blackMinDuration = Number(input.blackMinDuration ?? 0.5);

        // 1. blackdetect
        const blackFilter = 'blackdetect=d=' + String(blackMinDuration) + ':pix_th=' + String(blackThreshold);
        const blackRes = await ffmpeg(['-i', file, '-vf', blackFilter, '-f', 'null', '-']);
        const black: Array<{ start: number; end: number; duration: number }> = [];
        const lines = blackRes.stderr.split(/\r?\n/);
        let cur: { start?: number; end?: number } = {};
        for (const ln of lines) {
            const m = /black_start:([\d.]+)/.exec(ln);
            if (m) cur.start = Number(m[1]);
            const m2 = /black_end:([\d.]+)/.exec(ln);
            if (m2) cur.end = Number(m2[1]);
            if (cur.start !== undefined && cur.end !== undefined) {
                black.push({ start: cur.start, end: cur.end, duration: cur.end - cur.start });
                cur = {};
            }
        }

        // 2. audio peaks via volumedetect
        let audioPeaks: { maxVolume: number; meanVolume: number; clipping: boolean } | null = null;
        if (a) {
            const volRes = await ffmpeg(['-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
            const max = /max_volume: ([-\d.]+) dB/.exec(volRes.stderr);
            const mean = /mean_volume: ([-\d.]+) dB/.exec(volRes.stderr);
            const maxV = max ? Number(max[1]) : 0;
            const meanV = mean ? Number(mean[1]) : 0;
            audioPeaks = { maxVolume: maxV, meanVolume: meanV, clipping: maxV >= -0.1 };
        }

        // 3. freeze detection
        const frozenFrames: Array<{ start: number; end: number; duration: number }> = [];
        if (v && duration > 0) {
            const fr = await ffmpeg(['-i', file, '-vf', 'freezedetect=n=0.001:d=0.6', '-f', 'null', '-']);
            let s: number | undefined;
            for (const ln of fr.stderr.split(/\r?\n/)) {
                const a2 = /lavfi\.freezedetect\.freeze_start: ([-\d.]+)/.exec(ln);
                if (a2) s = Number(a2[1]);
                const b2 = /lavfi\.freezedetect\.freeze_end: ([-\d.]+)/.exec(ln);
                if (b2 && s !== undefined) {
                    frozenFrames.push({ start: s, end: Number(b2[1]), duration: Number(b2[1]) - s });
                    s = undefined;
                }
            }
        }

        const fps = v ? safeFps(String(v.r_frame_rate ?? '0/1')) : 0;
        const report = {
            file,
            container: info.format?.format_name,
            duration,
            size,
            bitRate,
            video: v ? { codec: v.codec_name, width: v.width, height: v.height, fps, pixelFormat: v.pix_fmt } : null,
            audio: a ? { codec: a.codec_name, sampleRate: Number(a.sample_rate ?? 0), channels: a.channels } : null,
            black,
            frozenFrames,
            audioPeaks,
            warnings: [
                ...(black.length > 0 ? [black.length + ' black segment(s)'] : []),
                ...(frozenFrames.length > 0 ? [frozenFrames.length + ' frozen-frame segment(s)'] : []),
                ...(audioPeaks?.clipping ? ['audio peaks hit 0 dB (possible clipping)'] : []),
            ],
            generatedAt: new Date().toISOString(),
        };

        const out = ctx.out(String(input.out ?? 'video-report.json'));
        ensureParentDir(out);
        fs.writeFileSync(out, JSON.stringify(report, null, 2));
        return {
            outputs: [{ path: out, kind: 'json' as const, meta: { duration, blackCount: black.length, frozenCount: frozenFrames.length, warningCount: report.warnings.length } }],
        };
    },
});

function safeFps(rate: string): number {
    const parts = rate.split('/');
    if (parts.length !== 2) return 0;
    const n = Number(parts[0]);
    const d = Number(parts[1]);
    return d === 0 ? 0 : n / d;
}