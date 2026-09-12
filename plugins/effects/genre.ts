import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';
import * as path from 'node:path';

/**
 * effects.genre - 14 genre look packs applied via a single ffmpeg filter chain.
 *
 * Each pack = a curated set of eq/color/grain/vignette/blur ops that produce
 * a coherent look. The agent picks a genre, intensity tunes strength.
 *
 * Genres: cinematic, anime, retro-80s, lofi, documentary, vintage-film,
 *         cyberpunk, vhs, scifi-clean, horror, news-broadcast, music-video,
 *         dream-soft, noir, pop-commercial.
 */
export default definePlugin({
    id: 'effects.genre',
    name: '14 genre look packs (cinematic / anime / lofi / cyberpunk / ...)',
    category: 'fx',
    description:
        'Applies a single coherent genre look via a tuned ffmpeg filter chain. 14 packs: cinematic, anime, retro-80s, lofi, documentary, vintage-film, cyberpunk, vhs, scifi-clean, horror, news-broadcast, music-video, dream-soft, noir, pop-commercial.',
    inputs: {
        file: S.string('Input video', { required: true }),
        genre: S.string('Genre pack', {
            enum: ['cinematic', 'anime', 'retro-80s', 'lofi', 'documentary', 'vintage-film', 'cyberpunk', 'vhs', 'scifi-clean', 'horror', 'news-broadcast', 'music-video', 'dream-soft', 'noir', 'pop-commercial'],
            required: true,
        }),
        intensity: S.number('Intensity 0.0 - 1.0 (applied via split+blend)', {
            default: 1,
            minimum: 0,
            maximum: 1,
        }),
        out: S.string('Output file', { default: 'genre.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const file = requireFile(String(input.file ?? ''), 'file');
        const genre = String(input.genre ?? '');
        const intensity = Math.max(0, Math.min(1, Number(input.intensity ?? 1)));
        const userOut = String(input.out ?? 'genre.mp4');
        const out = !userOut || (userOut === path.basename(userOut) && !userOut.includes('/') && !userOut.includes('\\'))
            ? ctx.out(userOut)
            : path.resolve(userOut);
        ensureParentDir(out);

        // Genre filter chains. Each is a comma-joined ffmpeg -vf pipeline.
        const PACKS: Record<string, (s: number) => string> = {
            cinematic: (s) => `eq=contrast=1.05*${s}:saturation=0.95*${s}:gamma=1.02,colorbalance=bs=${0.05 * s},vignette=PI/5,curves=preset=darker`,
            anime: (s) => `eq=contrast=1.20*${s}:saturation=1.30*${s}:gamma=0.96,unsharp=5:5:1.5*${s},colorbalance=rs=${0.04 * s}:bs=${0.06 * s}`,
            'retro-80s': (s) => `eq=saturation=1.20*${s}:contrast=1.10*${s},colorbalance=rs=${0.15 * s}:bs=${0.05 * s}:gh=${0.10 * s},gblur=sigma=${1.0 * s},curves=preset=increase_contrast`,
            lofi: (s) => `eq=saturation=0.7*${s}:contrast=0.85*${s},colorbalance=gs=${0.04 * s}:bs=${0.05 * s},gblur=sigma=${0.8 * s},noise=alls=${Math.round(8 * s)}:allf=t+u,curves=preset=darker`,
            documentary: (s) => `eq=saturation=0.85*${s}:contrast=1.05*${s},colorbalance=gh=${-0.03 * s}:bh=${-0.03 * s},vignette=PI/6`,
            'vintage-film': (s) => `curves=preset=warm,colorbalance=rs=${0.08 * s}:gs=${0.04 * s},eq=saturation=0.85*${s}:gamma=1.04,noise=alls=${Math.round(6 * s)}:allf=t+u,unsharp=3:3:0.6*${s}`,
            cyberpunk: (s) => `eq=saturation=1.4*${s}:contrast=1.15*${s},colorbalance=bs=${0.15 * s}:gh=${0.05 * s}:rs=${-0.05 * s},curves=preset=increase_contrast,gblur=sigma=${0.4 * s},vignette=PI/4`,
            vhs: (s) => `eq=saturation=1.1*${s}:contrast=1.05*${s},noise=alls=${Math.round(15 * s)}:allf=t+u,rgbashift=rh=${Math.round(3 * s)}:bh=-${Math.round(3 * s)},gblur=sigma=${0.5 * s}`,
            'scifi-clean': (s) => `eq=saturation=0.9*${s}:contrast=1.1*${s}:gamma=0.98,colorbalance=bs=${0.04 * s},curves=preset=cold,unsharp=3:3:0.7*${s}`,
            horror: (s) => `eq=saturation=0.4*${s}:contrast=1.3*${s},curves=preset=darker,colorbalance=bs=${-0.05 * s},gblur=sigma=${1.0 * s},vignette=PI/3.5,noise=alls=${Math.round(5 * s)}:allf=t+u`,
            'news-broadcast': (s) => `eq=saturation=1.15*${s}:contrast=1.1*${s},unsharp=3:3:0.6*${s},colorbalance=gs=${0.02 * s}:bs=${-0.02 * s}`,
            'music-video': (s) => `eq=saturation=1.25*${s}:contrast=1.15*${s}:gamma=1.02,curves=preset=increase_contrast,colorbalance=rs=${0.05 * s},unsharp=5:5:0.7*${s}`,
            'dream-soft': (s) => `gblur=sigma=${2.5 * s},eq=saturation=1.05*${s}:contrast=0.95*${s}:gamma=1.05,curves=preset=lighter,vignette=PI/4`,
            noir: (s) => `eq=saturation=0:saturation=0,eq=contrast=1.3*${s}:gamma=1.02,curves=preset=increase_contrast,vignette=PI/3,noise=alls=${Math.round(5 * s)}:allf=t+u`,
            'pop-commercial': (s) => `eq=saturation=1.20*${s}:contrast=1.10*${s}:gamma=1.01,unsharp=5:5:0.8*${s},colorbalance=rs=${0.03 * s}:bs=${0.04 * s}`,
        };

        const builder = PACKS[genre];
        if (!builder) {
            return {
                outputs: [],
                warnings: ['Unknown genre "' + genre + '". Use one of: ' + Object.keys(PACKS).join(', ')],
            };
        }
        const chain = builder(intensity);

        // Optional intensity blend: split into base/processed, blend all_mode=overlay at intensity.
        let vf = chain;
        if (intensity < 0.999) {
            const inv = 1 - intensity;
            vf = `split=2[base][proc];[base][proc]blend=all_mode=overlay:all_opacity=${intensity.toFixed(3)}`;
        }

        await ffmpeg(['-y', '-i', file, '-vf', vf, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'copy', out]);
        return { outputs: [{ path: out, kind: 'video' as const, meta: { genre, intensity } }] };
    },
});