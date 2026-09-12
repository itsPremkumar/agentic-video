import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, resolveOutPath } from '../_shared/common.ts';

/**
 * delivery.stems — hand over dialogue, music and effects separately.
 *
 * A broadcast or distributor requirement, and the thing that makes re-versioning
 * possible: a foreign-language dub needs the music-and-effects bed with no voice
 * in it, and a radio edit needs the dialogue clean. Mixing everything to one
 * track throws that away permanently.
 *
 * This is not source separation — it cannot pull a voice out of music. It
 * packages the elements the pipeline already knows about, which is the honest
 * and reliable version of this: if you built the mix from a voiceover, a music
 * bed and sound effects, then those three files ARE your stems.
 */
export default definePlugin({
    id: 'delivery.stems',
    name: 'Export audio stems',
    category: 'distribute',
    description: 'Package dialogue, music and effects as separate normalised stems, plus a full mix and a manifest.',
    inputs: {
        dialogue: S.string('Dialogue / voiceover stem'),
        music: S.string('Music stem'),
        effects: S.string('Effects / ambience stem'),
        sampleRate: S.int('Common sample rate for every stem', { default: 48000 }),
        mixVolume: S.number('Volume of the full mix', { default: 1 }),
        prefix: S.string('File name prefix', { default: 'stem' }),
        out: S.string('Manifest file name (.json)', { default: 'stems.json' }),
    },
    outputs: ['audio', 'data'],
    async run({ input, ctx }) {
        const requested: { role: string; value: unknown }[] = [
            { role: 'dialogue', value: input.dialogue },
            { role: 'music', value: input.music },
            { role: 'effects', value: input.effects },
        ].filter((r) => r.value !== undefined && r.value !== null && String(r.value).trim() !== '');

        if (!requested.length) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'Provide at least one stem: dialogue, music or effects.',
                input: { dialogue: input.dialogue, music: input.music, effects: input.effects },
                retryable: true,
                hint: 'These are the files your mix was built from — not channels to split out of a master.',
            });
        }

        const sr = Number(input.sampleRate ?? 48000);
        const prefix = String(input.prefix ?? 'stem');
        const outDir = path.join(ctx.workspaceDir, 'stems');
        fs.mkdirSync(outDir, { recursive: true });

        const stems: Record<string, unknown>[] = [];
        const paths: string[] = [];

        for (const { role, value } of requested) {
            const src = requireFile(value, role);
            const dest = path.join(outDir, `${prefix}-${role}.wav`);
            // Normalise rate and channel count so the stems can be recombined
            // in any DAW or NLE without drift.
            await ffmpeg(['-y', '-i', src, '-af', `aresample=${sr},aformat=sample_fmts=s16:channel_layouts=stereo`, '-ar', String(sr), '-ac', '2', dest]);
            stems.push({ role, source: src, stem: dest, bytes: fs.statSync(dest).size });
            paths.push(dest);
        }

        // A full mix is useful even when the stems are the deliverable — it is
        // the reference everyone will actually check against.
        const mixPath = path.join(outDir, `${prefix}-mix.wav`);
        if (stems.length === 1) {
            fs.copyFileSync(paths[0], mixPath);
        } else {
            const args = ['-y'];
            for (const p of paths) args.push('-i', p);
            const n = paths.length;
            const filter = paths
                .map((_, i) => `[${i}:a]aresample=${sr},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`)
                .join(';') + `;${paths.map((_, i) => `[a${i}]`).join('')}amix=inputs=${n}:duration=longest:normalize=0[out]`;
            args.push('-filter_complex', filter, '-map', '[out]', '-ar', String(sr), '-ac', '2', mixPath);
            await ffmpeg(args);
        }

        const dest = resolveOutPath(ctx, String(input.out ?? 'stems.json'));
        fs.writeFileSync(
            dest,
            JSON.stringify(
                {
                    stems,
                    mix: mixPath,
                    count: stems.length,
                    sampleRate: sr,
                    note:
                        'These are the elements the mix was built from, not source separation. ' +
                        'Keep them alongside the master so a dub, a cutdown or a re-mix stays possible.',
                },
                null,
                2,
            ),
            'utf8',
        );

        return {
            outputs: [
                ...paths.map((p) => ({ path: p, kind: 'audio' as const })),
                { path: mixPath, kind: 'audio' as const },
                { path: dest, kind: 'data' as const, meta: { count: stems.length, mix: mixPath } },
            ],
        };
    },
});
