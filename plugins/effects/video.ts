import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

const EFFECTS: Record<string, (i: Record<string, unknown>) => string> = {
    'film-grain': (i) => `noise=alls=${num(i.strength, 8)}:allf=t+u`,
    vignette: () => 'vignette=PI/4',
    'letterbox': (i) => `pad=iw:ih+ih*${num(i.ratio, 0.25)}:0:ih*${num(i.ratio, 0.25) / 2}:black`,
    mirror: () => 'crop=iw/2:ih:0:0,split[l][r];[r]hflip[rf];[l][rf]hstack',
    'black-white': () => 'hue=s=0',
    'color-pop': (i) => ` hue=s=${num(i.saturation, 2)}`,
    blur: (i) => `boxblur=${num(i.strength, 6)}:1`,
    sharpen: () => 'unsharp=5:5:1.0:5:5:0.0',
    shake: (i) => `crop=iw-${num(i.amount, 10)}:ih-${num(i.amount, 10)}:${num(i.amount, 10)}/2+${num(i.amount, 10)}/2*sin(2*PI*t*8):${num(i.amount, 10)}/2+${num(i.amount, 10)}/2*sin(2*PI*t*6)`,
    'zoom-punch': () => 'zoompan=z=\'min(zoom+0.0015,1.5)\':d=1:x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\'',
    'edge-glow': () => 'edgedetect=low=0.05:high=0.2',
    'slow-shutter': () => 'tmix=frames=8:weights=1',
};

export default definePlugin({
    id: 'effects.video',
    name: 'Video effect',
    category: 'effects',
    description: `Apply a named effect to a video. Supported: ${Object.keys(EFFECTS).join(', ')}`,
    inputs: {
        src: S.string('Source video path', { required: true }),
        effect: S.string('Effect name', { required: true, enum: Object.keys(EFFECTS) }),
        strength: S.number('Strength (grain / blur)', { default: 8 }),
        amount: S.number('Amount in pixels (shake)', { default: 10 }),
        ratio: S.number('Bar ratio for letterbox', { default: 0.25 }),
        saturation: S.number('Saturation multiplier for color-pop', { default: 2 }),
        out: S.string('Output file name', { default: 'effect.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const name = String(input.effect);
        const build = EFFECTS[name];
        if (!build) {
            throw new PluginFailure({
                code: 'UNKNOWN_EFFECT',
                message: `Unsupported effect "${name}".`,
                input: { effect: name },
                retryable: true,
                hint: `Supported: ${Object.keys(EFFECTS).join(', ')}`,
            });
        }
        const dest = ctx.out(String(input.out ?? 'effect.mp4'));
        await ffmpeg(['-y', '-i', src, '-vf', build(input), '-c:a', 'copy', dest]);
        return { outputs: [{ path: dest, kind: 'video' }] };
    },
});
