import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg, durationOf } from '../../core/media.ts';
import { projectRoot } from '../../core/env.ts';
import { S, requireFile, resolveOutPath, num } from '../_shared/common.ts';

/**
 * analyze.continuity — does the cut hold together?
 *
 * Nothing in the toolkit compared shots to each other. `analyze.video` checks
 * one file for black and freeze frames; `analyze.scene_audit` checks scenes
 * against a manifest. Neither answers the question an editor actually asks
 * after assembling: *do these shots belong in the same film?*
 *
 * A jump in exposure or colour between two adjacent cuts is the most visible
 * mark of amateur editing — and it is measurable. This samples a frame from
 * each clip, reports its luminance, contrast spread and colour balance, and
 * flags the pairs that will read as a jolt. The output is what a colourist uses
 * to decide which shots need matching.
 */
export default definePlugin({
    id: 'analyze.continuity',
    name: 'Shot continuity check',
    category: 'analyze',
    description: 'Measure brightness, contrast and colour across a sequence of shots and flag the cuts that will read as a jump.',
    inputs: {
        clips: S.array('Media files to compare, in cut order'),
        timeline: S.string('...or a timeline JSON with a "clips" array'),
        at: S.number('Seconds into each clip to sample', { default: 0.5, minimum: 0 }),
        brightnessJump: S.number('Luminance difference (0-255) that counts as a jump', { default: 22, minimum: 0 }),
        colourJump: S.number('Colour-balance difference (0-255) that counts as a jump', { default: 14, minimum: 0 }),
        saturationJump: S.number('Saturation difference that counts as a jump', { default: 28, minimum: 0 }),
        out: S.string('Output file name for the report (.json)', { default: 'continuity.json' }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        let sources: string[] = [];
        if (Array.isArray(input.clips)) {
            sources = (input.clips as unknown[]).map((c) => (typeof c === 'string' ? c : String((c as Record<string, unknown>)?.src ?? '')));
        } else if (input.timeline) {
            const p = requireFile(input.timeline, 'timeline');
            const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
            const clips = Array.isArray(parsed?.clips) ? (parsed.clips as Record<string, unknown>[]) : [];
            sources = clips.map((c) => String(c?.src ?? ''));
        }
        sources = sources.filter(Boolean);
        if (sources.length < 2) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'Continuity needs at least two shots to compare.',
                input: { count: sources.length },
                retryable: true,
                hint: 'Pass clips=[...] in cut order, or a timeline JSON with a "clips" array.',
            });
        }

        const at = num(input.at, 0.5);
        const brightJump = num(input.brightnessJump, 22);
        const colourJump = num(input.colourJump, 14);
        const satJump = num(input.saturationJump, 28);

        // ffmpeg's filter parser treats ':' as an option separator, so an
        // absolute Windows path cannot go inside a filter argument. A path
        // relative to the project root has no colon and no spaces.
        const scratch = resolveOutPath(ctx, '_continuity-stats.txt');
        const scratchArg = path.relative(projectRoot(), scratch).split(path.sep).join('/');

        const shots: Record<string, unknown>[] = [];
        const warnings: string[] = [];

        try {
            for (const [i, src] of sources.entries()) {
                const file = requireFile(src, `clips[${i}]`);
                const dur = await durationOf(file);
                // Sample inside the clip, but never past its end.
                const sampleAt = dur > 0 ? Math.min(at, Math.max(0, dur - 0.05)) : at;

                fs.rmSync(scratch, { force: true });
                await ffmpeg([
                    '-y', '-ss', String(sampleAt), '-i', file, '-frames:v', '1',
                    '-vf', `signalstats,metadata=print:file=${scratchArg}`,
                    '-f', 'null', '-',
                ]);

                const raw = fs.existsSync(scratch) ? fs.readFileSync(scratch, 'utf8') : '';
                const pick = (k: string): number | null => {
                    const m = new RegExp(`lavfi\\.signalstats\\.${k}=([-0-9.]+)`).exec(raw);
                    return m ? Number(m[1]) : null;
                };

                const yavg = pick('YAVG');
                const ylow = pick('YLOW');
                const yhigh = pick('YHIGH');
                const ymin = pick('YMIN');
                const ymax = pick('YMAX');
                const satavg = pick('SATAVG');
                const uavg = pick('UAVG');
                const vavg = pick('VAVG');

                if (yavg === null) {
                    warnings.push(`clips[${i}] (${path.basename(file)}): no signal statistics — skipped.`);
                    continue;
                }

                shots.push({
                    index: i,
                    src: file,
                    at: Number(sampleAt.toFixed(3)),
                    duration: dur,
                    yavg,
                    // Spread between the 10th and 90th percentile luma — a
                    // better contrast proxy than min/max, which noise owns.
                    contrast: ylow !== null && yhigh !== null ? Number((yhigh - ylow).toFixed(2)) : null,
                    // Percentiles coincide on a near-uniform frame, which makes
                    // `contrast` read 0 and hides real range. Keep the absolute
                    // spread too, so a dark frame with bright text still shows.
                    range: ymin !== null && ymax !== null ? Number((ymax - ymin).toFixed(2)) : null,
                    satavg,
                    uavg,
                    vavg,
                });
            }

            if (shots.length < 2) {
                throw new PluginFailure({
                    code: 'NO_SEGMENTS',
                    message: 'Fewer than two shots produced measurements.',
                    reason: warnings.join(' ') || 'The inputs could not be sampled.',
                    input: { clips: sources.length },
                    retryable: true,
                    hint: 'Check the files are decodable video or images.',
                });
            }

            // Compare consecutive cuts. Colour balance is the distance between
            // the two chroma means; a shift here is what makes a cut look like
            // it came from a different camera or a different day.
            const cuts: Record<string, unknown>[] = [];
            for (let i = 1; i < shots.length; i++) {
                const a = shots[i - 1];
                const b = shots[i];
                const dBright = Math.abs(num(b.yavg, 0) - num(a.yavg, 0));
                const dSat = Math.abs(num(b.satavg, 0) - num(a.satavg, 0));
                const dColour = Math.hypot(num(b.uavg, 0) - num(a.uavg, 0), num(b.vavg, 0) - num(a.vavg, 0));
                const dContrast = Math.max(
                    Math.abs(num(b.contrast, 0) - num(a.contrast, 0)),
                    Math.abs(num(b.range, 0) - num(a.range, 0)),
                );

                const flags: string[] = [];
                if (dBright > brightJump) flags.push(`brightness jumps ${dBright.toFixed(1)} (limit ${brightJump})`);
                if (dColour > colourJump) flags.push(`colour balance shifts ${dColour.toFixed(1)} (limit ${colourJump})`);
                if (dSat > satJump) flags.push(`saturation jumps ${dSat.toFixed(1)} (limit ${satJump})`);

                cuts.push({
                    from: a.index,
                    to: b.index,
                    fromSrc: path.basename(String(a.src)),
                    toSrc: path.basename(String(b.src)),
                    brightnessDelta: Number(dBright.toFixed(2)),
                    contrastDelta: Number(dContrast.toFixed(2)),
                    saturationDelta: Number(dSat.toFixed(2)),
                    colourDelta: Number(dColour.toFixed(2)),
                    // Signed, so you can see which direction to correct.
                    brightnessDirection: num(b.yavg, 0) > num(a.yavg, 0) ? 'brighter' : 'darker',
                    ok: flags.length === 0,
                    flags,
                });
            }

            const jumps = cuts.filter((c) => !c.ok);
            const worst = [...cuts].sort(
                (x, y) => num(y.brightnessDelta, 0) + num(y.colourDelta, 0) - (num(x.brightnessDelta, 0) + num(x.colourDelta, 0)),
            )[0];

            const dest = resolveOutPath(ctx, String(input.out ?? 'continuity.json'));
            fs.writeFileSync(
                dest,
                JSON.stringify(
                    {
                        shots,
                        cuts,
                        shotCount: shots.length,
                        cutCount: cuts.length,
                        jumpCount: jumps.length,
                        worstCut: worst ?? null,
                        thresholds: { brightnessJump: brightJump, colourJump, saturationJump: satJump },
                        notes: [
                            ...jumps.map((c) => `${c.fromSrc} -> ${c.toSrc}: ${(c.flags as string[]).join('; ')}`),
                            ...warnings,
                        ],
                        hint:
                            jumps.length > 0
                                ? 'Use effects.color_grade on the outlier shots to bring them into line, then re-run this to confirm.'
                                : 'No jumps over threshold. The sequence reads as continuous.',
                    },
                    null,
                    2,
                ),
                'utf8',
            );

            return {
                outputs: [
                    {
                        path: dest,
                        kind: 'data',
                        meta: { shots: shots.length, cuts: cuts.length, jumps: jumps.length },
                    },
                ],
                warnings: [
                    ...jumps.map((c) => `${c.fromSrc} -> ${c.toSrc}: ${(c.flags as string[]).join('; ')}`),
                    ...warnings,
                ],
            };
        } finally {
            fs.rmSync(scratch, { force: true });
        }
    },
});
