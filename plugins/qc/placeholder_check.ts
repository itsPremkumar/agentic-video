import { definePlugin } from '../../core/define.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { run, resolveFfmpeg } from '../../core/media.ts';

/**
 * qc.placeholder_check - flag visually-blank or "placeholder-looking" assets.
 *
 * Detection signal: ffmpeg `signalstats` on a 64x64 grayscale downscale gives
 * YAVG (mean luma) and YSTD (luma stddev). A real image has YSTD > 8; solid
 * colour / very flat placeholders have YSTD <= 8.
 *
 * Returns PASS / WARN / FAIL plus per-file stats.
 */
export default definePlugin({
    id: 'qc.placeholder_check',
    name: 'Detect blank/placeholder-looking image or video frames',
    category: 'qc',
    description:
        'Downscale to 64x64 grayscale, read signalstats YSTD. YSTD <= 8 = placeholder (FAIL). 8 < YSTD <= 14 = low-information (WARN). Otherwise PASS.',
    inputs: {
        files: S.array('Array of image or video file paths', { required: true }),
        placeholderStddev: S.number('YSTD <= this is FAIL (placeholder)', { default: 8, minimum: 0, maximum: 32 }),
        warnStddev: S.number('YSTD <= this (and > placeholder) is WARN', { default: 14, minimum: 0, maximum: 64 }),
        out: S.string('Output JSON path', { default: 'placeholder-check.json' }),
    },
    outputs: ['json'],
    async run({ input, ctx }) {
        const files: string[] = [];
        if (Array.isArray(input.files)) {
            for (const f of input.files) if (typeof f === 'string') files.push(f);
        } else if (typeof input.files === 'string') {
            files.push(...String(input.files).split(/[\n,]/).map((s) => s.trim()).filter(Boolean));
        }
        if (!files.length) return { outputs: [], warnings: ['No files supplied.'] };

        const placeholderStddev = Number(input.placeholderStddev ?? 8);
        const warnStddev = Number(input.warnStddev ?? 14);
        const out = ctx.out(String(input.out ?? 'placeholder-check.json'));

        const bin = resolveFfmpeg();
        const results: { file: string; status: 'PASS' | 'WARN' | 'FAIL'; mean: number; stddev: number; range: number; reason?: string }[] = [];

        for (const f of files) {
            try {
                requireFile(f, 'file');
            } catch {
                results.push({ file: f, status: 'FAIL', mean: 0, stddev: 0, range: 0, reason: 'FILE_NOT_FOUND' });
                continue;
            }
            // Downscale to 64x64 grayscale, dump raw bytes, compute mean/stddev/range in TS.
            const args = [
                '-hide_banner',
                '-loglevel',
                'error',
                '-i',
                f,
                '-vf',
                'scale=64:64:force_original_aspect_ratio=decrease,pad=64:64:(ow-iw)/2:(oh-ih)/2,format=gray',
                '-frames:v',
                '1',
                '-pix_fmt',
                'gray',
                '-f',
                'rawvideo',
                '-',
            ];
            const r = await run(bin, args, { timeoutMs: 30_000 });
            if (r.code !== 0) {
                results.push({ file: f, status: 'FAIL', mean: 0, stddev: 0, range: 0, reason: 'FFMPEG_FAILED' });
                continue;
            }
            const buf = Buffer.from(r.stdout, 'binary');
            if (buf.length < 64 * 64 * 0.5) {
                results.push({ file: f, status: 'FAIL', mean: 0, stddev: 0, range: 0, reason: 'EMPTY_FRAME' });
                continue;
            }
            let sum = 0;
            let min = 255;
            let max = 0;
            for (const byte of buf) {
                sum += byte;
                if (byte < min) min = byte;
                if (byte > max) max = byte;
            }
            const n = buf.length;
            const mean = sum / n;
            let varSum = 0;
            for (const byte of buf) varSum += (byte - mean) * (byte - mean);
            const stddev = Math.sqrt(varSum / n);
            const range = max - min;

            let status: 'PASS' | 'WARN' | 'FAIL';
            let reason: string | undefined;
            if (stddev <= placeholderStddev) { status = 'FAIL'; reason = 'PLACEHOLDER'; }
            else if (stddev <= warnStddev) { status = 'WARN'; reason = 'LOW_INFORMATION'; }
            else status = 'PASS';
            results.push({ file: f, status, mean, stddev, range, ...(reason ? { reason } : {}) });
        }

        const summary = {
            count: results.length,
            pass: results.filter((r) => r.status === 'PASS').length,
            warn: results.filter((r) => r.status === 'WARN').length,
            fail: results.filter((r) => r.status === 'FAIL').length,
            placeholderStddev,
            warnStddev,
            results,
        };
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, JSON.stringify(summary, null, 2), 'utf8');
        return { outputs: [{ path: out, kind: 'json' as const, meta: { pass: summary.pass, fail: summary.fail, warn: summary.warn } }] };
    },
});