import { definePlugin } from '../../core/define.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { probe } from '../../core/media.ts';

/**
 * qc.gate - pipeline gate aggregator.
 *
 * Runs a configurable set of deterministic gates against a media file and
 * returns PASS/FAIL with per-gate reasons. The external agent uses this as a
 * one-shot QA before publishing / rendering.
 *
 * Default gates:
 *   G1  file_exists       - path is on disk
 *   G2  has_video_stream  - at least one video stream
 *   G3  duration_ok       - duration within expected +/- tolerance
 *   G4  duration_cap      - below platform cap (shorts=60, tiktok=180, reels=90, youtube=600)
 *   G5  size_floor        - file size >= max(50 KB, dur*6 KB/s)
 *   G6  audio_required    - audio stream present if required
 *   G7  resolution_ok     - min(width,height) >= 360 if set
 *
 * Heuristics are intentionally conservative so PASS is meaningful.
 */
export default definePlugin({
    id: 'qc.gate',
    name: 'Pipeline gate aggregator (PASS/FAIL with reasons)',
    category: 'qc',
    description:
        'Runs deterministic gates against a media file: file exists, has video stream, duration in range, duration under platform cap, file size floor, audio stream present if required, resolution floor.',
    inputs: {
        file: S.string('Media file path', { required: true }),
        platform: S.string('Target platform (drives the duration cap)', {
            enum: ['shorts', 'tiktok', 'reels', 'youtube', 'custom'],
            default: 'youtube',
        }),
        customMaxSec: S.number('Custom duration cap in seconds (platform=custom)', {
            default: 60,
            minimum: 1,
            maximum: 3600,
        }),
        expectedDuration: S.number('Expected duration in seconds (G3). 0 = skip.', { default: 0 }),
        durationTolerance: S.number('Tolerance in seconds (G3)', { default: 2, minimum: 0, maximum: 60 }),
        durationTolerancePct: S.number('Tolerance as percent of expected (G3)', { default: 5, minimum: 0, maximum: 50 }),
        audioRequired: S.bool('Require an audio stream (G6)', { default: false }),
        minResolution: S.int('Min(width,height) in px (G7). 0 = skip.', { default: 360, minimum: 0, maximum: 7680 }),
        out: S.string('Output JSON path', { default: 'gate.json' }),
    },
    outputs: ['json'],
    async run({ input, ctx }) {
        const out = ctx.out(String(input.out ?? 'gate.json'));
        const platformCaps: Record<string, number> = { shorts: 60, tiktok: 180, reels: 90, youtube: 600 };
        const platform = String(input.platform ?? 'youtube');
        const cap = platform === 'custom' ? Number(input.customMaxSec ?? 60) : platformCaps[platform] || 600;

        type Gate = { id: string; ok: boolean; detail: string };
        const gates: Gate[] = [];

        // G1 file_exists
        let actualPath = String(input.file ?? '');
        try { actualPath = requireFile(actualPath, 'file'); gates.push({ id: 'G1_file_exists', ok: true, detail: actualPath }); }
        catch { gates.push({ id: 'G1_file_exists', ok: false, detail: 'FILE_NOT_FOUND: ' + actualPath }); }

        if (!gates[0].ok) {
            await fs.mkdir(path.dirname(out), { recursive: true });
            await fs.writeFile(out, JSON.stringify({ overall: 'FAIL', gates }, null, 2), 'utf8');
            return { outputs: [{ path: out, kind: 'json' as const, meta: { overall: 'FAIL' } }] };
        }

        // Probe.
        let info: any = {};
        try { info = await probe(actualPath); } catch (e: any) { info = {}; }
        const streams: any[] = info.streams || [];
        const videoStreams = streams.filter((s) => s.codec_type === 'video');
        const audioStreams = streams.filter((s) => s.codec_type === 'audio');
        const dur = Number(info.format?.duration || 0);
        const size = (await fs.stat(actualPath)).size;
        const w = Number(videoStreams[0]?.width || 0);
        const h = Number(videoStreams[0]?.height || 0);

        // G2 has_video_stream
        gates.push({ id: 'G2_has_video_stream', ok: videoStreams.length > 0, detail: 'video_streams=' + videoStreams.length });

        // G3 duration_ok
        const exp = Number(input.expectedDuration ?? 0);
        if (exp > 0) {
            const tol = Math.max(Number(input.durationTolerance ?? 2), exp * Number(input.durationTolerancePct ?? 5) / 100);
            const ok = Math.abs(dur - exp) <= tol;
            gates.push({ id: 'G3_duration_ok', ok, detail: 'expected=' + exp.toFixed(2) + ' actual=' + dur.toFixed(2) + ' tolerance=' + tol.toFixed(2) });
        } else {
            gates.push({ id: 'G3_duration_ok', ok: true, detail: 'skipped (no expected)' });
        }

        // G4 duration_cap
        const okCap = dur > 0 && dur <= cap;
        gates.push({ id: 'G4_duration_cap', ok: okCap, detail: 'platform=' + platform + ' cap=' + cap + 's actual=' + dur.toFixed(2) + 's' });

        // G5 size_floor
        const minSize = Math.max(50_000, dur * 6000);
        const okSize = size >= minSize;
        gates.push({ id: 'G5_size_floor', ok: okSize, detail: 'size=' + size + ' floor=' + Math.round(minSize) });

        // G6 audio_required
        const audioRequired = Boolean(input.audioRequired);
        if (audioRequired) {
            gates.push({ id: 'G6_audio_required', ok: audioStreams.length > 0, detail: 'audio_streams=' + audioStreams.length });
        } else {
            gates.push({ id: 'G6_audio_required', ok: true, detail: 'skipped (audio not required)' });
        }

        // G7 resolution_ok
        const minRes = Number(input.minResolution ?? 360);
        if (minRes > 0) {
            const okRes = Math.min(w, h) >= minRes;
            gates.push({ id: 'G7_resolution_ok', ok: okRes, detail: 'min=' + minRes + ' actual=' + w + 'x' + h });
        } else {
            gates.push({ id: 'G7_resolution_ok', ok: true, detail: 'skipped' });
        }

        const passCount = gates.filter((g) => g.ok).length;
        const overall = passCount === gates.length ? 'PASS' : 'FAIL';
        const result = {
            overall,
            platform,
            file: actualPath,
            duration: +dur.toFixed(3),
            size,
            width: w,
            height: h,
            passCount,
            totalGates: gates.length,
            gates,
        };
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, JSON.stringify(result, null, 2), 'utf8');
        return { outputs: [{ path: out, kind: 'json' as const, meta: { overall, passCount, total: gates.length } }] };
    },
});