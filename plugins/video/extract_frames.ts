/**
 * video.extract_frames — the "video to images" half of the image<->video
 * conversion. Extracts stills from a clip on a fixed cadence or by timestamp.
 *
 * Complements video.from_images (images -> video) and video.thumbnail (a
 * single frame), and mirrors the reference project's `videoToImages`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg, durationOf } from '../../core/media.ts';
import { S, requireFile } from '../_shared/common.ts';

export default definePlugin({
    id: 'video.extract_frames',
    name: 'Extract frames from video',
    category: 'video',
    description:
        'Export still images from a video — every N seconds, a fixed count, or at explicit timestamps.',
    inputs: {
        src: S.string('Source video file', { required: true }),
        mode: S.string('How to choose frames', { default: 'interval', enum: ['interval', 'count', 'times'] }),
        interval: S.number('mode=interval: one frame every N seconds', { default: 1, minimum: 0.04 }),
        count: S.int('mode=count: how many evenly spaced frames', { default: 10, minimum: 1, maximum: 1000 }),
        times: S.array('mode=times: explicit timestamps in seconds, e.g. [0, 2.5, 7]'),
        start: S.number('Only extract from this timestamp (seconds)', { default: 0, minimum: 0 }),
        end: S.number('Stop extracting at this timestamp (seconds, 0 = end of video)', { default: 0, minimum: 0 }),
        format: S.string('Image format', { default: 'png', enum: ['png', 'jpg'] }),
        width: S.int('Optional output width (keeps aspect; -1 = native)', { default: -1 }),
        prefix: S.string('Filename prefix', { default: 'frame' }),
        outDir: S.string('Output directory (default: plugin artifact dir)', { default: undefined }),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');

        const mode = String(input.mode ?? 'interval');
        const format = String(input.format ?? 'png');
        const prefix = String(input.prefix ?? 'frame');
        const start = Number(input.start ?? 0);
        const endRaw = Number(input.end ?? 0);

        const total = await durationOf(src).catch(() => 0);
        const end = endRaw > 0 ? Math.min(endRaw, total || endRaw) : total || 0;

        // ── Build the list of timestamps ──────────────────────────────────
        let times: number[] = [];
        if (mode === 'times') {
            const raw = input.times;
            if (!Array.isArray(raw) || !raw.length) {
                throw new PluginFailure({
                    code: 'INVALID_INPUT',
                    message: 'mode="times" requires a non-empty `times` array.',
                    input: { times: raw },
                    retryable: true,
                    hint: 'Example: --input times=0,2.5,7  (also set mode=times)',
                });
            }
            times = (raw as unknown[]).map((t) => Number(t)).filter((t) => Number.isFinite(t) && t >= 0);
        } else if (mode === 'count') {
            const n = Math.max(1, Number(input.count ?? 10));
            if (end <= start) {
                throw new PluginFailure({
                    code: 'INVALID_INPUT',
                    message: 'mode="count" needs to know the video duration; it could not be probed.',
                    input: { src, start, end },
                    retryable: true,
                    hint: 'Use mode="interval" or mode="times" instead.',
                });
            }
            const step = (end - start) / n;
            for (let i = 0; i < n; i++) times.push(start + step * (i + 0.5));
        } else {
            const step = Math.max(0.04, Number(input.interval ?? 1));
            if (end <= start) {
                times = [start];
            } else {
                for (let t = start; t < end; t += step) times.push(Number(t.toFixed(3)));
            }
        }

        if (!times.length) {
            throw new PluginFailure({
                code: 'NO_FRAMES',
                message: 'No timestamps were produced for this extraction.',
                input: { mode, start, end, interval: input.interval, count: input.count },
                retryable: true,
                hint: 'Check start/end fall inside the video duration.',
            });
        }

        const outDir = input.outDir ? path.resolve(String(input.outDir)) : path.dirname(ctx.out('.frames'));
        fs.mkdirSync(outDir, { recursive: true });

        const scaleW = Number(input.width ?? -1);
        const vf = scaleW > 0 ? `scale=${scaleW}:-2` : null;

        const outputs: { path: string; kind: 'image'; meta: Record<string, unknown> }[] = [];
        const warnings: string[] = [];

        for (let i = 0; i < times.length; i++) {
            const t = times[i];
            const dest = path.join(outDir, `${prefix}_${String(i + 1).padStart(4, '0')}.${format}`);
            const args: string[] = ['-y', '-ss', String(t), '-i', src, '-frames:v', '1'];
            if (vf) args.push('-vf', vf);
            // -frames:v 1 must precede the output; quality flags for jpg.
            if (format === 'jpg') args.push('-q:v', '2');
            args.push(dest);

            const res = await ffmpeg(args);
            if (res.code !== 0 || !fs.existsSync(dest)) {
                warnings.push(`t=${t}s failed: ${(res.stderr || '').slice(-200)}`);
                continue;
            }
            outputs.push({ path: dest, kind: 'image', meta: { timestampSeconds: t, index: i + 1 } });
        }

        if (!outputs.length) {
            throw new PluginFailure({
                code: 'EXTRACTION_FAILED',
                message: `Could not extract any frames (${times.length} timestamp(s) tried).`,
                reason: warnings.join(' | '),
                input: { src, mode, times: times.length },
                detail: warnings.join('\n'),
                retryable: true,
            });
        }

        return {
            outputs,
            warnings,
        };
    },
});
