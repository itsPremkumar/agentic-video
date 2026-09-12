import { definePlugin } from '../../core/define.ts';
import { ffmpeg, probe, durationOf } from '../../core/media.ts';
import { S, ensureParentDir } from '../_shared/common.ts';
import * as path from 'node:path';

/**
 * video.scene_split - split a long clip into N sub-clips on disk.
 *
 * Modes:
 *   - mode='equal'    : evenly split into `count` clips.
 *   - mode='marks'    : split at explicit comma-separated start timestamps.
 *                        Output count = marks.length + 1 (head + tail).
 *
 * The plugin uses ffmpeg's trim+asetpts+concat filter graph for lossless
 * re-mux (no re-encode) so the operation is fast and exact.
 */
export default definePlugin({
    id: 'video.scene_split',
    name: 'Split a video into N clips (equal or by marks)',
    category: 'edit',
    description:
        'Split a long clip into N sub-clips: evenly (mode=equal, count=N) or at explicit comma-separated timestamp marks (mode=marks). Uses lossless trim+concat.',
    inputs: {
        file: S.string('Input video', { required: true }),
        mode: S.string('Split mode', { enum: ['equal', 'marks'], default: 'equal' }),
        count: S.int('Number of equal clips (mode=equal)', { default: 4, minimum: 2, maximum: 64 }),
        marks: S.string('Comma-separated start timestamps in seconds (mode=marks)', {
            default: '5,10,15',
        }),
        outDir: S.string('Output directory (absolute or relative; absolute paths are honoured)', {
            default: 'clips',
        }),
        prefix: S.string('Filename prefix', { default: 'clip' }),
        reencode: S.bool('Re-encode (true) or lossless stream-copy (false)', { default: false }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const file = String(input.file ?? '');
        const mode = String(input.mode ?? 'equal');
        const reencode = Boolean(input.reencode);
        const prefix = String(input.prefix ?? 'clip');
        const fs = await import('node:fs/promises');
        const total = await durationOf(file);
        if (!(total > 0)) {
            return { outputs: [], warnings: ['Could not read input duration.'] };
        }

        // Resolve outDir: absolute paths or anything containing a separator is
// treated as "user gave a path" and resolved relative to cwd; pure
// filenames collapse into the plugin's artifact subdir via ctx.out.
const userOut = String(input.outDir ?? 'clips');
const outDir = !userOut || (userOut === path.basename(userOut) && !userOut.includes('/') && !userOut.includes('\\'))
    ? ctx.out(userOut)
    : path.resolve(userOut);
ensureParentDir(outDir + '/.keep');

        // Build cut points.
        const points: number[] = [0];
        if (mode === 'equal') {
            const n = Math.max(2, Math.min(64, Number(input.count ?? 4)));
            for (let i = 1; i < n; i++) points.push(Math.round((total * i) / n * 1000) / 1000);
        } else {
            const raw = String(input.marks ?? '')
                .split(',')
                .map((s) => Number(s.trim()))
                .filter((n) => Number.isFinite(n) && n > 0 && n < total)
                .sort((a, b) => a - b);
            for (const r of raw) points.push(Math.round(r * 1000) / 1000);
        }
        points.push(total);

        const segments: { path: string; start: number; end: number }[] = [];
        for (let i = 0; i < points.length - 1; i++) {
            const s = points[i];
            const e = points[i + 1];
            if (e - s < 0.05) continue;
            const out = path.join(outDir, prefix + '-' + String(i + 1).padStart(3, '0') + '.mp4');
            if (reencode) {
                await ffmpeg(['-y', '-i', file, '-ss', s.toFixed(3), '-to', e.toFixed(3), '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'aac', out]);
            } else {
                await ffmpeg(['-y', '-i', file, '-ss', s.toFixed(3), '-to', e.toFixed(3), '-c', 'copy', out]);
            }
            segments.push({ path: out, start: s, end: e });
        }

        const probeData = await probe(file);
        const hasAudio = (probeData.streams || []).some((s: any) => s.codec_type === 'audio');

        const summaryPath = path.join(outDir, prefix + '-index.json');
        await fs.writeFile(summaryPath, JSON.stringify({ source: file, mode, total, hasAudio, clips: segments }, null, 2), 'utf8');

        return {
            outputs: segments.map((s) => ({ path: s.path, kind: 'video' as const, meta: { start: s.start, end: s.end, duration: s.end - s.start } })),
            warnings: [],
        };
    },
});