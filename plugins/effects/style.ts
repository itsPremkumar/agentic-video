import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';

/**
 * effects.style - apply a complete named "look pack" to a video clip.
 *
 * Unlike effects.look (which is a single colour transform), each style here is a
 * full recipe: colour grading + optional grain + optional vignette + optional
 * contrast curve — the kind of thing a colourist would call a "look".
 */
interface StylePack { eq: string; extras: string[] }

const STYLES: Record<string, StylePack> = {
    noir: { eq: 'hue=s=0,eq=contrast=1.35:brightness=-0.02', extras: ['noise=alls=8:allf=t', 'vignette=PI/4'] },
    sunset: { eq: 'hue=h=18:s=1.15,eq=brightness=0.03:contrast=1.05', extras: ['vignette=PI/5'] },
    cyberpunk: { eq: 'hue=h=-22:s=1.25,eq=contrast=1.2:brightness=-0.02', extras: ['colorbalance=bs=0.06:rs=0.03', 'vignette=PI/4.5'] },
    golden: { eq: 'colorbalance=rs=0.08:gs=0.04,eq=contrast=1.06:saturation=1.05', extras: ['vignette=PI/6'] },
    arctic: { eq: 'colorbalance=bs=0.08:rs=-0.04,eq=contrast=1.1:brightness=0.02', extras: [] },
    moody: { eq: 'eq=contrast=1.18:saturation=0.75:brightness=-0.04', extras: ['vignette=PI/3.5'] },
    pastelDream: { eq: 'eq=saturation=0.6:contrast=0.85:brightness=1.08,curves=preset=lighter', extras: [] },
    horrorDesat: { eq: 'eq=saturation=0.35:contrast=1.3:brightness=-0.06', extras: ['noise=alls=12:allf=t', 'vignette=PI/3'] },
    documentary: { eq: 'eq=contrast=1.05:saturation=1.02:brightness=0.01', extras: [] },
    hdr: { eq: 'eq=contrast=1.22:saturation=1.25:brightness=1.02', extras: ['unsharp=5:5:0.6:5:5:0.0'] },
    muted: { eq: 'eq=saturation=0.55:contrast=0.95', extras: ['vignette=PI/5.5'] },
    neonNight: { eq: 'hue=h=-30:s=1.35,eq=contrast=1.25', extras: ['colorbalance=bs=0.1:gh=0.05', 'vignette=PI/4'] },
};

export default definePlugin({
    id: 'effects.style',
    name: 'Apply a complete named style pack',
    category: 'effects',
    description: 'Full look recipe (grade + grain + vignette + sharpening): noir, sunset, cyberpunk, golden, arctic, moody, pastelDream, horrorDesat, documentary, hdr, muted, neonNight.',
    inputs: {
        file: S.string('Path to input video', { required: true }),
        style: S.string('Style pack name', { enum: Object.keys(STYLES), required: true }),
        strength: S.number('Overall strength 0.0 - 1.0 (1 = full recipe)', { default: 1, minimum: 0, maximum: 1 }),
        grain: S.bool('Include grain if the pack defines it', { default: true }),
        vignette: S.bool('Include vignette if the pack defines it', { default: true }),
        out: S.string('Output file (.mp4)', { default: 'styled.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const file = requireFile(input.file, 'file');
        const style = String(input.style ?? '');
        const pack = STYLES[style];
        if (!pack) {
            throw new (await import('../../core/define.ts')).PluginFailure({
                code: 'UNKNOWN_STYLE',
                message: 'Unknown style "' + style + '". Supported: ' + Object.keys(STYLES).join(', '),
                input: { style },
                retryable: true,
            });
        }
        const strength = Math.max(0, Math.min(1, Number(input.strength ?? 1)));
        const wantGrain = input.grain !== false;
        const wantVignette = input.vignette !== false;
        const out = ctx.out(String(input.out ?? 'styled.mp4'));
        ensureParentDir(out);

        const parts: string[] = [pack.eq];
        for (const extra of pack.extras) {
            const isGrain = extra.startsWith('noise=');
            const isVignette = extra.startsWith('vignette=');
            if (isGrain && !wantGrain) continue;
            if (isVignette && !wantVignette) continue;
            parts.push(extra);
        }
        let filter = parts.join(',');
        // Strength < 1 blends the styled result back toward the original.
        if (strength < 1) {
            filter = 'split[a][b];[a]' + parts.join(',') + '[styled];[b][styled]blend=all_opacity=' + strength.toFixed(3) + ':all_mode=normal[out]';
            await ffmpeg(['-y', '-i', file, '-filter_complex', filter, '-map', '[out]', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'copy', out]);
        } else {
            await ffmpeg(['-y', '-i', file, '-vf', filter, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'copy', out]);
        }

        return { outputs: [{ path: out, kind: 'video' as const, meta: { style, strength, filter } }] };
    },
});