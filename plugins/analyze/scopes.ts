import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin } from '../../core/define.ts';
import { projectRoot } from '../../core/env.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num, resolveOutPath } from '../_shared/common.ts';

/**
 * analyze.scopes — the measurements a colourist grades from.
 *
 * There was no way to measure a picture in this toolkit. `image.aesthetic` scores
 * a frame, but scoring is not measuring: you cannot see where the highlights
 * clip, whether the blacks are crushed, or how far the saturation sits from
 * legal. Without scopes, grading is guesswork dressed up as taste.
 *
 * Produces a stacked image (waveform / vectorscope / histogram) plus the numeric
 * signal statistics behind it, so a decision can be justified with a number.
 */
export default definePlugin({
    id: 'analyze.scopes',
    name: 'Video scopes',
    category: 'analyze',
    description: 'Render a waveform, vectorscope and histogram for a frame, plus numeric signal statistics.',
    inputs: {
        src: S.string('Video or image to measure', { required: true }),
        at: S.number('Timestamp in seconds to sample', { default: 0, minimum: 0 }),
        width: S.int('Width of each scope panel', { default: 640, minimum: 160 }),
        height: S.int('Height of each scope panel', { default: 360, minimum: 90 }),
        out: S.string('Output file name for the scopes image (.png)', { default: 'scopes.png' }),
    },
    outputs: ['image', 'data'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const at = num(input.at, 0);
        const w = num(input.width, 640);
        const h = num(input.height, 360);

        const dest = resolveOutPath(ctx, String(input.out ?? 'scopes.png'));
        // ffmpeg's filter parser treats ':' as an option separator and '\' as an
        // escape, so an absolute Windows path (C://…//PREM KUMAR\…) cannot be
        // passed inside a filter argument — escaping it does not work either.
        // Pass a path RELATIVE to the project root instead: no colon, no spaces.
        // ffmpeg inherits the process cwd, which is the project root.
        const statsFile = resolveOutPath(ctx, '_scopes-stats.txt');
        const statsArg = path.relative(projectRoot(), statsFile).split(path.sep).join('/');

        try {
            // Three panels at one width, stacked, so they read as a single scope set.
            const filter = [
                '[0:v]split=3[a][b][c]',
                `[a]waveform=filter=lowpass:scale=ire:graticule=green:flags=numbers+dots,scale=${w}:${h}[w]`,
                `[b]vectorscope=mode=color3:graticule=green:envelope=peak,scale=${w}:${h}[v]`,
                `[c]histogram=display_mode=stack:levels_mode=logarithmic:components=7,scale=${w}:${h}[hh]`,
                '[w][v][hh]vstack=inputs=3[out]',
            ].join(';');

            await ffmpeg(['-y', '-ss', String(at), '-i', src, '-frames:v', '1', '-filter_complex', filter, '-map', '[out]', dest]);

            // Numeric backing for the picture. metadata=print writes to a file so
            // we do not have to scrape ffmpeg's stderr.
            await ffmpeg([
                '-y', '-ss', String(at), '-i', src, '-frames:v', '1',
                '-vf', `signalstats,metadata=print:file=${statsArg}`,
                '-f', 'null', '-',
            ]);

            const raw = fs.existsSync(statsFile) ? fs.readFileSync(statsFile, 'utf8') : '';
            const pick = (key: string): number | null => {
                const m = new RegExp(`lavfi\\.signalstats\\.${key}=([-0-9.]+)`).exec(raw);
                return m ? Number(m[1]) : null;
            };

            const stats = {
                yavg: pick('YAVG'),
                ymin: pick('YMIN'),
                ymax: pick('YMAX'),
                ylow: pick('YLOW'),
                yhigh: pick('YHIGH'),
                satavg: pick('SATAVG'),
                satmax: pick('SATMAX'),
                hueavg: pick('HUEMED'),
                uavg: pick('UAVG'),
                vavg: pick('VAVG'),
            };

            const notes: string[] = [];
            const { ymin, ymax, yavg, satmax } = stats;
            // Broadcast-legal ranges. These are the checks a QC pass makes.
            if (ymin !== null && ymin <= 16) notes.push('black at or below legal floor (YMIN <= 16) — detail may be crushed');
            if (ymax !== null && ymax >= 235) notes.push('white at or above legal ceiling (YMAX >= 235) — highlights may clip');
            if (ymax !== null && ymax >= 254) notes.push('hard clipping present (YMAX >= 254)');
            if (yavg !== null && yavg < 40) notes.push('frame is very dark on average (YAVG < 40)');
            if (yavg !== null && yavg > 200) notes.push('frame is very bright on average (YAVG > 200)');
            if (satmax !== null && satmax > 240) notes.push('saturation near maximum (SATMAX > 240)');

            const dataFile = resolveOutPath(ctx, String(input.out ?? 'scopes.png').replace(/\.png$/i, '-stats.json'));
            fs.writeFileSync(dataFile, JSON.stringify({ src, at, stats, notes }, null, 2), 'utf8');

            return {
                outputs: [
                    { path: dest, kind: 'image', meta: { at, width: w, height: h * 3 } },
                    { path: dataFile, kind: 'data', meta: { notes: notes.length, ...stats } },
                ],
                warnings: notes,
            };
        } finally {
            fs.rmSync(statsFile, { force: true });
        }
    },
});
