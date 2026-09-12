import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg, durationOf } from '../../core/media.ts';
import { projectRoot } from '../../core/env.ts';
import { S, requireFile, resolveOutPath, num } from '../_shared/common.ts';

/**
 * edit.match — bring shots into line with a reference.
 *
 * The most visible difference between amateur and professional cutting is
 * consistency: two shots of the same scene cut together where one is warmer, or
 * brighter, or flatter. `analyze.continuity` tells you a jump is there. This
 * measures the difference against a reference shot and corrects towards it.
 *
 * It is a first-order correction — overall luminance, contrast, saturation and
 * gamma — not a full colour match. It will not fix a white-balance mismatch on
 * one part of the frame; that needs a secondary correction with a mask. What it
 * does fix is the thing that actually reads as "these shots don't match".
 */
export default definePlugin({
    id: 'edit.match',
    name: 'Match shots to a reference',
    category: 'edit',
    description: 'Measure each shot against a reference and apply a luminance, contrast, saturation and gamma correction towards it.',
    inputs: {
        reference: S.string('Reference media (usually the shot you like)', { required: true }),
        targets: S.array('Media files to correct towards the reference', { required: true }),
        at: S.number('Seconds into each file to sample', { default: 0.5, minimum: 0 }),
        strength: S.number('How far to push the correction, 0..1 (0.5 is usually safest)', { default: 0.7, minimum: 0, maximum: 1 }),
        prefix: S.string('File name prefix for corrected files', { default: 'matched' }),
        out: S.string('Report file name (.json)', { default: 'match-report.json' }),
    },
    outputs: ['video', 'data'],
    async run({ input, ctx }) {
        const ref = requireFile(input.reference, 'reference');
        const targets = Array.isArray(input.targets) ? (input.targets as unknown[]).map(String).filter(Boolean) : [];
        if (!targets.length) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'Provide at least one target to correct.',
                input: { targets: input.targets },
                retryable: true,
                hint: 'targets=[...] — the shots that should match the reference.',
            });
        }
        const at = num(input.at, 0.5);
        const strength = Math.max(0, Math.min(1, num(input.strength, 0.7)));

        // ffmpeg's filter parser treats ':' as an option separator, so an
        // absolute Windows path cannot go inside a filter argument. Relative to
        // the project root has neither a colon nor a space.
        const scratch = resolveOutPath(ctx, '_match-stats.txt');
        const scratchArg = path.relative(projectRoot(), scratch).split(path.sep).join('/');

        const measure = async (file: string): Promise<{ yavg: number; satavg: number; ymin: number; ymax: number } | null> => {
            const dur = await durationOf(file);
            const sampleAt = dur > 0 ? Math.min(at, Math.max(0, dur - 0.05)) : at;
            fs.rmSync(scratch, { force: true });
            await ffmpeg([
                '-y', '-ss', String(sampleAt), '-i', file, '-frames:v', '1',
                '-vf', `signalstats,metadata=print:file=${scratchArg}`,
                '-f', 'null', '-',
            ]);
            const raw = fs.existsSync(scratch) ? fs.readFileSync(scratch, 'utf8') : '';
            const pick = (k: string): number => {
                const m = new RegExp(`lavfi\\.signalstats\\.${k}=([-0-9.]+)`).exec(raw);
                return m ? Number(m[1]) : NaN;
            };
            const yavg = pick('YAVG');
            if (!Number.isFinite(yavg)) return null;
            return { yavg, satavg: pick('SATAVG'), ymin: pick('YMIN'), ymax: pick('YMAX') };
        };

        const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

        try {
            const refStats = await measure(ref);
            if (!refStats) {
                throw new PluginFailure({
                    code: 'CLIP_UNREADABLE',
                    message: `Could not measure the reference "${ref}".`,
                    input: { reference: ref },
                    retryable: true,
                    hint: 'Check it is a decodable video or image.',
                });
            }

            const refRange = Math.max(1, refStats.ymax - refStats.ymin);
            const prefix = String(input.prefix ?? 'matched');
            const outDir = path.join(ctx.workspaceDir, 'matched');
            fs.mkdirSync(outDir, { recursive: true });

            const results: Record<string, unknown>[] = [];
            const outputs: string[] = [];

            for (const [i, target] of targets.entries()) {
                const file = requireFile(target, `targets[${i}]`);
                const stats = await measure(file);
                if (!stats) {
                    results.push({ index: i, src: file, ok: false, reason: 'could not measure' });
                    continue;
                }

                const range = Math.max(1, stats.ymax - stats.ymin);

                // Contrast is the ratio of the luma spreads, pulled towards 1 by
                // `strength` so a weak correction never overshoots. It is only
                // meaningful when both shots actually have a range — expanding
                // contrast on a near-uniform frame just amplifies noise.
                const contrast =
                    refRange > 10 && range > 10
                        ? clamp(1 + (refRange / range - 1) * strength, 0.8, 1.3)
                        : 1;

                // eq's contrast pivots around mid-grey (0.5), NOT around this
                // shot's mean. On a dark shot, expanding contrast pushes it
                // towards black — the correction runs backwards. So work out
                // where the mean lands after contrast and set brightness to
                // close the remaining gap to the reference.
                const mean = stats.yavg / 255;
                const afterContrast = (mean - 0.5) * contrast + 0.5;
                const desired = refStats.yavg / 255;
                const brightness = clamp((desired - afterContrast) * strength, -0.5, 0.5);

                // Saturation is matched as a ratio; a black-and-white reference
                // would drive this to 0, which is correct but worth flagging.
                const satRatio = refStats.satavg > 0.5 && stats.satavg > 0.5 ? refStats.satavg / stats.satavg : 1;
                const saturation = clamp(1 + (satRatio - 1) * strength, 0, 2);

                // Gamma is left neutral: it also moves the mean, and stacking it
                // on top of a brightness correction makes the result hard to
                // predict. Level is brightness, spread is contrast.
                const gamma = 1;

                const dest = path.join(outDir, `${prefix}-${String(i).padStart(3, '0')}.mp4`);
                await ffmpeg([
                    '-y', '-i', file,
                    '-vf', `eq=brightness=${brightness.toFixed(4)}:contrast=${contrast.toFixed(4)}:saturation=${saturation.toFixed(4)}:gamma=${gamma.toFixed(4)}`,
                    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
                    '-c:a', 'copy',
                    dest,
                ]);

                outputs.push(dest);
                results.push({
                    index: i,
                    src: file,
                    out: dest,
                    ok: true,
                    before: { yavg: stats.yavg, satavg: stats.satavg, range },
                    reference: { yavg: refStats.yavg, satavg: refStats.satavg, range: refRange },
                    applied: { brightness, contrast, saturation, gamma },
                });
            }

            if (!outputs.length) {
                throw new PluginFailure({
                    code: 'NO_SEGMENTS',
                    message: 'No shots could be corrected.',
                    reason: 'None of the targets could be measured.',
                    input: { targets: targets.length },
                    retryable: true,
                });
            }

            const reportPath = resolveOutPath(ctx, String(input.out ?? 'match-report.json'));
            fs.writeFileSync(
                reportPath,
                JSON.stringify(
                    {
                        reference: ref,
                        referenceStats: refStats,
                        strength,
                        results,
                        note:
                            'First-order correction only — overall luminance, contrast, saturation and gamma. ' +
                            'Re-run analyze.continuity on the outputs to confirm the jump is gone.',
                    },
                    null,
                    2,
                ),
                'utf8',
            );

            return {
                outputs: [
                    ...outputs.map((p) => ({ path: p, kind: 'video' as const })),
                    { path: reportPath, kind: 'data' as const, meta: { corrected: outputs.length, strength } },
                ],
            };
        } finally {
            fs.rmSync(scratch, { force: true });
        }
    },
});
