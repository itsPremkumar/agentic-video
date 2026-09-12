import { definePlugin } from '../../core/define.ts';
import { ffmpeg, probe } from '../../core/media.ts';
import { S, requireFile, ensureParentDir, resolveOutPath } from '../_shared/common.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * fx.compare - side-by-side / N-up comparison sheet of multiple videos.
 *
 * Renders a 2xN (or Nx1) tiled contact sheet showing the same timestamp
 * from each input. Useful for "before/after" colour grades, A/B platform
 * encodes, and visual regression of a render.
 */
export default definePlugin({
    id: 'fx.compare',
    name: 'Side-by-side / tiled comparison sheet of multiple videos',
    category: 'fx',
    description:
        'Pick the same timestamp from N input videos, scale each to 480x270, tile into a 2-column (or N-column) contact sheet, draw each label. Deterministic, no overlay alignment needed.',
    inputs: {
        files: S.array('Video file paths (max 4)', { required: true }),
        labels: S.string('Comma-separated labels per file (optional, defaults to filenames)', { default: '' }),
        time: S.number('Common timestamp to grab from each video (seconds)', { default: 0.5, minimum: 0 }),
        cols: S.int('Number of columns in the tile grid', { default: 2, minimum: 1, maximum: 4 }),
        tileWidth: S.int('Per-tile width in pixels', { default: 480, minimum: 120, maximum: 1920 }),
        tileHeight: S.int('Per-tile height in pixels', { default: 270, minimum: 80, maximum: 1080 }),
        out: S.string('Output PNG path', { default: 'compare.png' }),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const files: string[] = [];
        if (Array.isArray(input.files)) {
            for (const f of input.files) if (typeof f === 'string') files.push(f);
        } else if (typeof input.files === 'string') {
            files.push(...String(input.files).split(/[\n,]/).map((s) => s.trim()).filter(Boolean));
        }
        if (!files.length) return { outputs: [], warnings: ['No files.'] };
        if (files.length > 4) {
            return { outputs: [], warnings: ['compare supports up to 4 files; got ' + files.length + '.'] };
        }
        const labelsIn = String(input.labels ?? '').split(',').map((s) => s.trim());
        const t = Math.max(0, Number(input.time ?? 0.5));
        const cols = Math.max(1, Math.min(4, Number(input.cols ?? 2)));
        const tw = Math.max(120, Math.min(1920, Number(input.tileWidth ?? 480)));
        const th = Math.max(80, Math.min(1080, Number(input.tileHeight ?? 270)));
        const userOut = String(input.out ?? 'compare.png');
        const out = resolveOutPath(ctx, userOut);
        ensureParentDir(out);

        // Probe each duration so we can clamp the timestamp.
        const durs: number[] = [];
        for (const f of files) {
            try { durs.push((await probe(f)).format?.duration || 0); } catch { durs.push(0); }
        }

        // First pass: extract one frame per file at min(t, dur/2).
        const framePaths: string[] = [];
        const os = await import('node:os');
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-compare-'));
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const d = durs[i] || 0;
            const ti = d > 0 ? Math.min(t, d - 0.05) : t;
            const fp = path.join(tmpDir, 'frame-' + i + '.png');
            await ffmpeg(['-y', '-ss', ti.toFixed(3), '-i', f, '-frames:v', '1', '-vf', 'scale=' + tw + ':' + th + ':force_original_aspect_ratio=decrease,pad=' + tw + ':' + th + ':(ow-iw)/2:(oh-ih)/2:black', fp]);
            framePaths.push(fp);
        }

        // Build drawtext labels on each frame.
        const labelled: string[] = [];
        for (let i = 0; i < framePaths.length; i++) {
            const lbl = labelsIn[i] || path.basename(files[i]);
            const out = path.join(tmpDir, 'label-' + i + '.png');
            await ffmpeg(['-y', '-i', framePaths[i], '-vf', 'drawtext=text=' + JSON.stringify(lbl) + ':fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6:x=8:y=8', out]);
            labelled.push(out);
        }

        // Tile: row-wise hstack then vstack the rows. Cleaner than xstack layout strings.
        const filterInputs: string[] = [];
        for (let i = 0; i < files.length; i++) filterInputs.push('-i', labelled[i]);

        let fc = '';
        const rows = Math.ceil(files.length / cols);
        // Step 1: for each row, hstack the cols.
        const rowLabels: string[] = [];
        for (let r = 0; r < rows; r++) {
            const parts: string[] = [];
            for (let c = 0; c < cols; c++) {
                const idx = r * cols + c;
                parts.push('[' + idx + ':v]');
            }
            const rowLbl = 'r' + r;
            rowLabels.push('[' + rowLbl + ']');
            fc += parts.join('') + 'hstack=inputs=' + cols + '[' + rowLbl + '];';
        }
        // Step 2: vstack the rows.
        if (rows === 1) {
            fc += rowLabels[0] + 'copy[v];';
        } else {
            fc += rowLabels.join('') + 'vstack=inputs=' + rows + '[v]';
        }

        await ffmpeg(['-y', ...filterInputs, '-filter_complex', fc, '-map', '[v]', '-frames:v', '1', out]);
        // Best-effort cleanup.
        try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

        return { outputs: [{ path: out, kind: 'image' as const, meta: { count: files.length, rows, cols, t } }] };
    },
});