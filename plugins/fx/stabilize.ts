import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';

/**
 * fx.stabilize - two-pass video stabilisation using ffmpeg's vidstab filters.
 * Pass 1 detects motion (writes transform data to a file).
 * Pass 2 applies the inverse transform to smooth the clip.
 */
export default definePlugin({
    id: 'fx.stabilize',
    name: 'Stabilise shaky video footage',
    category: 'fx',
    description: 'Two-pass vidstab stabilisation (detect + transform) for handheld clips.',
    inputs: {
        file: S.string('Path to input video', { required: true }),
        shakiness: S.int('Shakiness (1=low, 10=high)', { default: 6, minimum: 1, maximum: 10 }),
        accuracy: S.int('Detection accuracy (1=low, 15=high)', { default: 9, minimum: 1, maximum: 15 }),
        smoothing: S.int('Smoothing strength (1-100)', { default: 15, minimum: 1, maximum: 100 }),
        zoom: S.int('Zoom percent to compensate for movement (0-20)', { default: 0, minimum: 0, maximum: 20 }),
        out: S.string('Output file (.mp4)', { default: 'stabilized.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const file = requireFile(input.file, 'file');
        const shakiness = Number(input.shakiness ?? 6);
        const accuracy = Number(input.accuracy ?? 9);
        const smoothing = Number(input.smoothing ?? 15);
        const zoom = Number(input.zoom ?? 0);
        const out = ctx.out(String(input.out ?? 'stabilized.mp4'));
        ensureParentDir(out);

        const workdir = fs.mkdtempSync('/tmp/vf-stab-');
        const transforms = '/tmp/vf-stab-transforms-' + path.basename(workdir) + '.trf';
        try {
            // Pass 1 - detect
            await ffmpeg([
                '-y', '-i', file,
                '-vf', 'vidstabdetect=shakiness=' + String(shakiness) + ':accuracy=' + String(accuracy) + ':result=' + transforms,
                '-f', 'null', '-',
            ]);
            // Pass 2 - transform
            const transformFilter = 'vidstabtransform=input=' + transforms + ':smoothing=' + String(smoothing) + ':zoom=' + String(zoom) + ':optzoom=1:interpol=bicubic';
            await ffmpeg(['-y', '-i', file, '-vf', transformFilter, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'copy', out]);
        } finally {
            try { fs.rmSync(workdir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
        return { outputs: [{ path: out, kind: 'video' as const, meta: { shakiness, accuracy, smoothing, zoom } }] };
    },
});