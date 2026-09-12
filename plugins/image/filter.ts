import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num, invalidInput } from '../_shared/common.ts';

const FILTERS: Record<string, (i: Record<string, unknown>) => string> = {
    blur: (i) => `boxblur=${num(i.strength, 4)}:1`,
    sharpen: () => 'unsharp=5:5:1.0:5:5:0.0',
    grayscale: () => 'hue=s=0',
    sepia: () => 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131',
    vignette: () => 'vignette=PI/4',
    noise: (i) => `noise=alls=${num(i.strength, 10)}:allf=t+u`,
    emboss: () => 'convolution=1 1 1 1 -7 1 1 1 1:1 1 1 1 -7 1 1 1 1:1 1 1 1 -7 1 1 1 1:5',
    edge: () => 'edgedetect=low=0.1:high=0.4',
    pixelate: (i) => `scale=iw/${num(i.blockSize, 10)}:ih/${num(i.blockSize, 10)},scale=iw*${num(i.blockSize, 10)}:ih*${num(i.blockSize, 10)}:flags=neighbor`,
    invert: () => 'negate',
    posterize: (i) => `posterize=levels=${num(i.levels, 4)}`,
};

export default definePlugin({
    id: 'image.filter',
    name: 'Image effect / filter',
    category: 'image',
    description: `Apply a named visual filter. Supported: ${Object.keys(FILTERS).join(', ')}`,
    inputs: {
        src: S.string('Source image path', { required: true }),
        filter: S.string('Filter name', { required: true, enum: Object.keys(FILTERS) }),
        strength: S.number('Strength for blur/noise (default depends on filter)'),
        blockSize: S.number('Block size for pixelate', { default: 10 }),
        levels: S.number('Levels for posterize', { default: 4 }),
        out: S.string('Output file name'),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const name = String(input.filter);
        const build = FILTERS[name];
        if (!build) {
            invalidInput(`Unsupported filter "${name}". Supported: ${Object.keys(FILTERS).join(', ')}`, {
                field: 'filter',
                value: name,
                hint: `Pick one of: ${Object.keys(FILTERS).join(', ')}.`,
            });
        }
        const dest = ctx.out(String(input.out ?? `${name}_${Date.now()}.png`));
        await ffmpeg(['-y', '-i', src, '-vf', build(input), dest]);
        return { outputs: [{ path: dest, kind: 'image' }] };
    },
});
