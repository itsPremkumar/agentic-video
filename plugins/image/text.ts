import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'image.text',
    name: 'Draw text on image',
    category: 'image',
    description: 'Burn text onto an image (title card, caption, lower third).',
    inputs: {
        src: S.string('Source image path', { required: true }),
        text: S.string('Text to draw', { required: true }),
        x: S.string('X expression (ffmpeg), e.g. "(w-text_w)/2"', { default: '(w-text_w)/2' }),
        y: S.string('Y expression (ffmpeg), e.g. "h-th-80"', { default: 'h-th-80' }),
        fontSize: S.int('Font size in pixels', { default: 64 }),
        color: S.string('Text colour', { default: 'white' }),
        boxColor: S.string('Box colour with alpha, e.g. black@0.5 (empty = none)', { default: '' }),
        fontFile: S.string('Path to a .ttf/.otf font file (optional)'),
        out: S.string('Output file name'),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const text = String(input.text).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
        const font = input.fontFile ? `fontfile='${String(input.fontFile)}':` : '';
        const box = input.boxColor
            ? `:box=1:boxcolor=${String(input.boxColor)}:boxborderw=${num(input.fontSize, 64) / 3}`
            : '';
        const dest = ctx.out(String(input.out ?? `text_${Date.now()}.png`));
        const vf = `drawtext=${font}text='${text}':x=${String(input.x ?? '(w-text_w)/2')}:y=${String(input.y ?? 'h-th-80')}:fontsize=${num(input.fontSize, 64)}:fontcolor=${String(input.color ?? 'white')}${box}`;
        await ffmpeg(['-y', '-i', src, '-vf', vf, dest]);
        return { outputs: [{ path: dest, kind: 'image' }] };
    },
});
