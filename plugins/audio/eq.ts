import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num, resolveOutPath, invalidInput } from '../_shared/common.ts';

/**
 * audio.eq — parametric EQ with optional gate and compressor.
 *
 * `audio.master` is a fixed chain (denoise → highpass → compressor → loudnorm).
 * That is the right default, but it leaves no room to actually shape a voice:
 * no way to cut a boom at 120 Hz, tame sibilance at 6 kHz, or lift presence at
 * 3 kHz. This is that missing control.
 *
 * Bands are applied in the order given, so a high-pass placed first removes
 * rumble before anything downstream amplifies it.
 */
export default definePlugin({
    id: 'audio.eq',
    name: 'Parametric EQ',
    category: 'audio',
    description: 'Shape audio with parametric EQ bands, plus optional noise gate and compressor.',
    inputs: {
        src: S.string('Source audio or video file', { required: true }),
        bands: S.array('EQ bands: array of {freq, gain, q?, type?}. type defaults to peaking.', { default: [] }),
        highpassHz: S.int('High-pass (rumble removal) corner frequency (0 = off)', { default: 0, minimum: 0 }),
        lowpassHz: S.int('Low-pass (hiss removal) corner frequency (0 = off)', { default: 0, minimum: 0 }),
        gate: S.bool('Apply a noise gate', { default: false }),
        gateThreshold: S.number('Gate threshold as a linear amplitude, e.g. 0.02', { default: 0.02, minimum: 0 }),
        compress: S.bool('Apply a compressor after the EQ', { default: false }),
        compressThreshold: S.number('Compressor threshold in dB', { default: -18 }),
        compressRatio: S.number('Compressor ratio', { default: 3, minimum: 1 }),
        normalize: S.bool('Run EBU R128 loudnorm at the end', { default: false }),
        out: S.string('Output file name', { default: 'eq.wav' }),
    },
    outputs: ['audio'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');

        const rawBands = Array.isArray(input.bands) ? (input.bands as Record<string, unknown>[]) : [];
        const filters: string[] = [];

        const highpass = num(input.highpassHz, 0);
        if (highpass > 0) filters.push(`highpass=f=${highpass}`);

        for (const [i, b] of rawBands.entries()) {
            const freq = num(b?.freq, 0);
            if (freq <= 0 || freq > 24000) {
                invalidInput(`Band ${i}: freq must be between 1 and 24000 Hz.`, {
                    field: 'bands',
                    value: b?.freq,
                    hint: 'e.g. {"freq":120,"gain":-4,"q":1.2} cuts a boom at 120 Hz',
                });
            }
            const gain = num(b?.gain, 0);
            const q = num(b?.q, 1);
            const type = String(b?.type ?? 'peaking');

            switch (type) {
                case 'peaking':
                    filters.push(`equalizer=f=${freq}:width_type=q:width=${q}:g=${gain}`);
                    break;
                case 'lowshelf':
                    filters.push(`lowshelf=f=${freq}:g=${gain}`);
                    break;
                case 'highshelf':
                    filters.push(`highshelf=f=${freq}:g=${gain}`);
                    break;
                case 'lowpass':
                    filters.push(`lowpass=f=${freq}`);
                    break;
                case 'highpass':
                    filters.push(`highpass=f=${freq}`);
                    break;
                case 'bandpass':
                    filters.push(`bandpass=f=${freq}:width_type=q:width=${q}`);
                    break;
                case 'notch':
                    filters.push(`bandreject=f=${freq}:width_type=q:width=${q}`);
                    break;
                default:
                    throw new PluginFailure({
                        code: 'INVALID_INPUT',
                        message: `Band ${i}: unknown type "${type}".`,
                        input: { bands: rawBands },
                        retryable: true,
                        hint: 'One of: peaking, lowshelf, highshelf, lowpass, highpass, bandpass, notch.',
                    });
            }
        }

        const lowpass = num(input.lowpassHz, 0);
        if (lowpass > 0) filters.push(`lowpass=f=${lowpass}`);

        if (input.gate === true) {
            const th = num(input.gateThreshold, 0.02);
            if (th <= 0) invalidInput('gateThreshold must be greater than 0.', { field: 'gateThreshold', value: th });
            filters.push(`agate=threshold=${th}:ratio=2:attack=20:release=250`);
        }

        if (input.compress === true) {
            filters.push(
                `acompressor=threshold=${num(input.compressThreshold, -18)}dB:ratio=${num(input.compressRatio, 3)}:attack=20:release=250`,
            );
        }

        if (input.normalize === true) {
            filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
        }

        if (!filters.length) {
            invalidInput('Nothing to do — provide at least one band, filter, gate, compressor or normalize.', {
                field: 'bands',
                hint: 'e.g. --input highpassHz=80 --input bands=\'[{"freq":3000,"gain":3}]\'',
            });
        }

        const dest = resolveOutPath(ctx, String(input.out ?? 'eq.wav'));
        const isVideo = /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(src);

        await ffmpeg(
            isVideo
                ? ['-y', '-i', src, '-af', filters.join(','), '-c:v', 'copy', '-c:a', 'aac', dest]
                : ['-y', '-i', src, '-af', filters.join(','), dest],
        );

        return {
            outputs: [{ path: dest, kind: isVideo ? 'video' : 'audio', meta: { filters: filters.length, chain: filters } }],
        };
    },
});
