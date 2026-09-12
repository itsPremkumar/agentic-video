import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';

/**
 * audio.denoise - spectral noise reduction for audio (or video audio track).
 * Uses ffmpeg's afftdn filter. Two modes:
 *
 *   constant   - apply a fixed noise floor (in dB) to all frequencies
 *   adaptive   - let the filter estimate the noise profile from the input
 *
 * Light + safe defaults; pair with audio.master for a full cleanup chain.
 */
export default definePlugin({
    id: 'audio.denoise',
    name: 'Denoise audio with FFT (afftdn)',
    category: 'audio',
    description: 'Spectral denoise for audio. afftdn with a fixed floor or adaptive profile.',
    inputs: {
        file: S.string('Path to audio/video file', { required: true }),
        mode: S.string('Mode', { enum: ['constant', 'adaptive'], default: 'constant' }),
        nf: S.number('Noise floor in dB (constant mode, range -80 to -20)', { default: -50 }),
        nr: S.number('Noise reduction amount in dB (constant mode, range 0.01 to 97)', { default: 12 }),
        out: S.string('Output file (.m4a or .mp4)', { default: 'denoised.m4a' }),
    },
    outputs: ['audio'],
    async run({ input, ctx }) {
        const file = requireFile(input.file, 'file');
        const mode = String(input.mode ?? 'constant');
        const nf = Number(input.nf ?? -50);
        const nr = Number(input.nr ?? 12);
        const out = ctx.out(String(input.out ?? 'denoised.m4a'));
        ensureParentDir(out);

        const af = mode === 'adaptive'
            ? 'afftdn=nf=' + String(nf) + ':tn=1'
            : 'afftdn=nf=' + String(nf) + ':nr=' + String(nr);

        const args: string[] = ['-y', '-i', file, '-af', af];
        if (/\.(m4a|aac|mp3|wav|ogg|opus|flac)$/i.test(out)) args.push('-vn');
        args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', out);
        await ffmpeg(args);
        return { outputs: [{ path: out, kind: 'audio' as const, meta: { mode, nf, nr } }] };
    },
});