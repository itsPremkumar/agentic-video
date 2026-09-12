import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';
import * as path from 'node:path';

/**
 * audio.lufs_for_platform - measure current integrated loudness then normalise
 * the audio to a platform-specific target LUFS.
 *
 * Targets:
 *   youtube     -14 LUFS, TP -1, LRA 11
 *   tiktok      -14 LUFS, TP -1, LRA 11
 *   reels       -16 LUFS, TP -1, LRA 11
 *   podcast     -16 LUFS, TP -1, LRA  9
 *   broadcast   -23 LUFS, TP -2, LRA  7 (EBU R128)
 *   music-stream-14 LUFS, TP -1, LRA 11
 *   headphones  -20 LUFS, TP -1, LRA 14
 *   custom      -> use customTargetLUFS / customTruePeak / customLRA
 *
 * Two-pass:
 *   pass 1: loudnorm print=json to measure current I / TP / LRA / threshold.
 *   pass 2: loudnorm with measured_* values + target -> second pass for accuracy.
 */
export default definePlugin({
    id: 'audio.lufs_for_platform',
    name: 'Normalise loudness to a platform-specific LUFS target',
    category: 'audio',
    description:
        'Two-pass loudnorm to platform-specific LUFS targets (YouTube -14, Reels -16, Podcast -16, Broadcast -23, Music -14, Headphones -20). Custom also supported.',
    inputs: {
        file: S.string('Input video or audio file', { required: true }),
        platform: S.string('Target platform', {
            enum: ['youtube', 'tiktok', 'reels', 'podcast', 'broadcast', 'music-stream', 'headphones', 'custom'],
            default: 'youtube',
        }),
        customTargetLUFS: S.number('Custom integrated loudness target (LUFS)', { default: -14, minimum: -30, maximum: 0 }),
        customTruePeak: S.number('Custom true peak ceiling (dBTP)', { default: -1, minimum: -9, maximum: 0 }),
        customLRA: S.number('Custom loudness range target (LU)', { default: 11, minimum: 1, maximum: 30 }),
        out: S.string('Output file', { default: 'lufs-normalised.mp4' }),
    },
    outputs: ['audio', 'video'],
    async run({ input, ctx }) {
        const file = requireFile(String(input.file ?? ''), 'file');
        const platform = String(input.platform ?? 'youtube');
        const PRESETS: Record<string, { I: number; TP: number; LRA: number }> = {
            youtube: { I: -14, TP: -1, LRA: 11 },
            tiktok: { I: -14, TP: -1, LRA: 11 },
            reels: { I: -16, TP: -1, LRA: 11 },
            podcast: { I: -16, TP: -1, LRA: 9 },
            broadcast: { I: -23, TP: -2, LRA: 7 },
            'music-stream': { I: -14, TP: -1, LRA: 11 },
            headphones: { I: -20, TP: -1, LRA: 14 },
        };
        const preset = platform === 'custom'
            ? { I: Number(input.customTargetLUFS ?? -14), TP: Number(input.customTruePeak ?? -1), LRA: Number(input.customLRA ?? 11) }
            : PRESETS[platform] || PRESETS.youtube;
        const userOut = String(input.out ?? 'lufs-normalised.mp4');
        const out = !userOut || (userOut === path.basename(userOut) && !userOut.includes('/') && !userOut.includes('\\'))
            ? ctx.out(userOut)
            : path.resolve(userOut);
        ensureParentDir(out);

        // Pass 1: measure. loudnorm prints JSON to stderr when print_format=json.
        const bin = (await import('../../core/media.ts')).resolveFfmpeg();
        const measureArgs = [
            '-hide_banner',
            '-i',
            file,
            '-af',
            'loudnorm=I=' + preset.I + ':TP=' + preset.TP + ':LRA=' + preset.LRA + ':print_format=json',
            '-f',
            'null',
            '-',
        ];
        const measureRes = await (await import('../../core/media.ts')).run(bin, measureArgs, { timeoutMs: 240_000 });

        // Extract measured_* from stderr.
        const stderr = (measureRes && (measureRes.stderr || '')) || '';
        const grab = (key: string): number => {
            const m = new RegExp('"\\s*' + key + '\\s*"\\s*:\\s*"?' + '(-?[\\d.]+)' + '"?').exec(stderr);
            return m ? Number(m[1]) : 0;
        };
        const measured_I = grab('input_i');
        const measured_TP = grab('input_tp');
        const measured_LRA = grab('input_lra');
        const measured_thresh = grab('input_thresh');

        // Pass 2: normalise with measured values (linear normalisation, much more accurate).
        const args2: string[] = [
            '-y', '-i', file,
            '-af',
            'loudnorm=I=' + preset.I +
            ':TP=' + preset.TP +
            ':LRA=' + preset.LRA +
            ':measured_I=' + measured_I +
            ':measured_TP=' + measured_TP +
            ':measured_LRA=' + measured_LRA +
            ':measured_thresh=' + measured_thresh +
            ':linear=true:print_format=summary',
        ];
        // Probe the input: if it has video, copy the video stream.
        const probe = await import('../../core/media.ts').then((m) => m.probe(file));
        const hasVideo = (probe.streams || []).some((s: any) => s.codec_type === 'video');
        if (hasVideo) {
            args2.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest');
        } else {
            args2.push('-c:a', 'pcm_s16le');
        }
        args2.push(out);
        await ffmpeg(args2);

        return {
            outputs: [{
                path: out,
                kind: (hasVideo ? 'video' : 'audio') as any,
                meta: { platform, target: preset, measured: { I: measured_I, TP: measured_TP, LRA: measured_LRA, thresh: measured_thresh } },
            }],
        };
    },
});