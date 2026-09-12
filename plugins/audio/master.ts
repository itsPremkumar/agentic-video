import * as fs from 'node:fs';
import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';

/**
 * audio.master - one-shot "final audio" pass for a single audio (or video)
 * source. Composes the standard chain an editor would normally apply:
 *
 *   1. afftdn     - FFT denoise (npl for noise profile, or default)
 *   2. highpass   - remove sub-rumble below 80Hz
 *   3. acompressor - voice polish, even out levels
 *   4. loudnorm   - EBU R128 normalisation to broadcast spec
 *   5. ducking    - optional sidechain ducking under a music bed
 *
 * Returns the rendered .m4a or .mp4 audio track. Pure ffmpeg, no model.
 */
export default definePlugin({
    id: 'audio.master',
    name: 'Master an audio (or video audio) file',
    category: 'audio',
    description: 'One-shot final audio: denoise + highpass + compressor + EBU R128 loudnorm + optional sidechain ducking.',
    inputs: {
        file: S.string('Path to audio/video file', { required: true }),
        denoise: S.bool('Apply spectral denoise', { default: true }),
        denoiseAmount: S.number('Noise floor in dB (e.g. -68), range -80 to -20', { default: -68 }),
        highpassHz: S.int('High-pass frequency in Hz (0 = off)', { default: 80 }),
        compress: S.bool('Apply voice compressor', { default: true }),
        normalize: S.bool('Apply EBU R128 loudnorm', { default: true }),
        targetI: S.number('Loudnorm target integrated loudness (LUFS)', { default: -16 }),
        targetTP: S.number('Loudnorm target true peak (dBTP)', { default: -1.5 }),
        targetLRA: S.number('Loudnorm target loudness range (LU)', { default: 11 }),
        duckUnder: S.string('Optional music/bg file to sidechain-duck against'),
        duckDb: S.number('Ducking amount in dB (e.g. -12)', { default: -12 }),
        out: S.string('Output file (.m4a or .mp4)', { default: 'mastered.m4a' }),
    },
    outputs: ['audio'],
    async run({ input, ctx }) {
        const file = requireFile(input.file, 'file');
        const denoise = input.denoise !== false;
        const compress = input.compress !== false;
        const normalize = input.normalize !== false;
        const denoiseAmount = Number(input.denoiseAmount ?? 12);
        const highpassHz = Number(input.highpassHz ?? 80);
        const duckUnderRaw = typeof input.duckUnder === 'string' ? input.duckUnder : '';
        const duckUnder = duckUnderRaw ? requireFile(input.duckUnder, 'duckUnder') : '';
        const duckDb = Number(input.duckDb ?? -12);
        const out = ctx.out(String(input.out ?? 'mastered.m4a'));
        ensureParentDir(out);

        const chain: string[] = [];
        if (denoise) chain.push('afftdn=nf=' + String(denoiseAmount));
        if (highpassHz > 0) chain.push('highpass=f=' + String(highpassHz));
        if (compress) chain.push('acompressor=threshold=-18dB:ratio=3:attack=20:release=120:makeup=2');
        if (normalize) {
            const I = String(input.targetI ?? -16);
            const TP = String(input.targetTP ?? -1.5);
            const LRA = String(input.targetLRA ?? 11);
            chain.push('loudnorm=I=' + I + ':TP=' + TP + ':LRA=' + LRA);
        }

        const filter = chain.join(',');

        const args: string[] = ['-y'];
        if (duckUnder) args.push('-i', duckUnder);
        args.push('-i', file);
        // Map: 0=bg (if any), 1=voice
        if (duckUnder) {
            // sidechain: when bg is loud, duck the voice by duckDb
            const sidechain = '[1:a]volume=' + String(duckDb) + ':enable=between(t,0,99999)[sc_in];' +
                '[0:a]volume=1[bg_out];' +
                '[sc_in][bg_out]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=200:makeup=1[ducked];' +
                (filter ? '[ducked]' + filter + '[out]' : '[ducked]anull[out]');
            args.push('-filter_complex', sidechain, '-map', '[out]');
        } else {
            args.push('-af', filter);
        }
        args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000');
        // If output extension suggests audio-only, strip video.
        if (/\.(m4a|aac|mp3|wav|ogg|opus|flac)$/i.test(out)) args.push('-vn');
        args.push(out);
        await ffmpeg(args);

        const stat = fs.statSync(out);
        return {
            outputs: [{ path: out, kind: 'audio' as const, meta: { bytes: stat.size, filterChain: chain, ducked: Boolean(duckUnder) } }],
        };
    },
});