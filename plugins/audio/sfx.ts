import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, ensureParentDir } from '../_shared/common.ts';

/**
 * audio.sfx - generate procedural sound effects with ffmpeg's signal sources.
 * No samples, no download, fully deterministic. Handy for UI accents, risers,
 * impacts and transitions when you have no SFX library available.
 */
const SFX: Record<string, string> = {
    // Short tonal blips / UI
    blip: 'sine=frequency=880:duration=0.08',
    click: 'sine=frequency=2000:duration=0.03',
    beep: 'sine=frequency=1000:duration=0.2',
    // Sweeps
    whoosh: 'anoisesrc=duration=0.6:color=brown:amplitude=0.6,lowpass=f=800,highpass=f=120',
    riser: 'sine=frequency=200:duration=2,lowpass=f=2000',
    downlifter: 'sine=frequency=800:duration=1.5',
    // Impacts
    impact: 'anoisesrc=duration=0.5:color=white:amplitude=0.9,lowpass=f=200,highpass=f=40',
    boom: 'sine=frequency=60:duration=1.2,lowpass=f=150',
    // Tonal textures
    chime: 'sine=frequency=1320:duration=1.2,aecho=0.8:0.9:400|800:0.25|0.15',
    pad: 'sine=frequency=220:duration=3,aecho=0.8:0.88:600|1100:0.4|0.3',
    // Noise beds
    wind: 'anoisesrc=duration=4:color=pink:amplitude=0.35,lowpass=f=700,highpass=f=80',
    rain: 'anoisesrc=duration=4:color=white:amplitude=0.4,highpass=f=800',
    static: 'anoisesrc=duration=1:color=white:amplitude=0.3',
    // Transitions
    swoosh: 'anoisesrc=duration=0.4:color=brown:amplitude=0.7,bandpass=f=1200:w=800',
    glitch: 'anoisesrc=duration=0.3:color=white:amplitude=0.5',
    laser: 'sine=frequency=2000:duration=0.4',
};

export default definePlugin({
    id: 'audio.sfx',
    name: 'Generate a procedural sound effect',
    category: 'audio',
    description: 'Deterministic SFX from ffmpeg signal sources (blip, click, whoosh, riser, impact, boom, chime, pad, wind, rain, swoosh, glitch, laser, ...).',
    inputs: {
        effect: S.string('Effect name', { enum: Object.keys(SFX), required: true }),
        volume: S.number('Output volume 0.0 - 1.0', { default: 0.6, minimum: 0, maximum: 1 }),
        fadeIn: S.number('Fade-in seconds', { default: 0.01 }),
        fadeOut: S.number('Fade-out seconds', { default: 0.05 }),
        out: S.string('Output file (.wav or .m4a)', { default: 'sfx.wav' }),
    },
    outputs: ['audio'],
    async run({ input, ctx }) {
        const effect = String(input.effect ?? '');
        const base = SFX[effect];
        if (!base) {
            throw new (await import('../../core/define.ts')).PluginFailure({
                code: 'UNKNOWN_EFFECT',
                message: 'Unknown effect "' + effect + '". Supported: ' + Object.keys(SFX).join(', '),
                input: { effect },
                retryable: true,
            });
        }
        const volume = Math.max(0, Math.min(1, Number(input.volume ?? 0.6)));
        const fadeIn = Math.max(0, Number(input.fadeIn ?? 0.01));
        const fadeOut = Math.max(0, Number(input.fadeOut ?? 0.05));
        const out = ctx.out(String(input.out ?? 'sfx.wav'));
        ensureParentDir(out);

        // Build one lavfi expression: source -> fades -> volume
        const chain = [
            base,
            fadeIn > 0 ? 'afade=t=in:st=0:d=' + fadeIn.toFixed(3) : null,
            fadeOut > 0 ? 'afade=t=out:st=0:d=' + fadeOut.toFixed(3) : null,
        ].filter(Boolean).join(',');

        const args = [
            '-y', '-f', 'lavfi', '-i', chain,
            '-af', 'volume=' + volume.toFixed(3),
            '-ar', '48000', '-ac', '1',
        ];
        if (/\.m4a$/i.test(out)) args.push('-c:a', 'aac', '-b:a', '192k');
        args.push(out);

        await ffmpeg(args);
        return { outputs: [{ path: out, kind: 'audio' as const, meta: { effect, volume, fadeIn, fadeOut, source: base } }] };
    },
});