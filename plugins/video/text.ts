import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'video.text',
    name: 'Add text to video',
    category: 'video',
    description: 'Burn text onto a video, optionally only during a time window.',
    inputs: {
        src: S.string('Source video path', { required: true }),
        text: S.string('Text to draw', { required: true }),
        x: S.string('X expression', { default: '(w-text_w)/2' }),
        y: S.string('Y expression', { default: 'h-th-120' }),
        fontSize: S.int('Font size', { default: 56 }),
        color: S.string('Text colour', { default: 'white' }),
        boxColor: S.string('Box colour with alpha, e.g. black@0.5 (empty = none)', { default: '' }),
        start: S.number('Show from this time in seconds', { default: 0 }),
        end: S.number('Hide after this time in seconds (omit = end of clip)'),
        fontFile: S.string('Path to a .ttf/.otf font file (optional)'),
        out: S.string('Output file name', { default: 'text.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const raw = String(input.text);
        const escaped = raw.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
        const font = input.fontFile ? `fontfile='${String(input.fontFile)}':` : '';
        const box = input.boxColor ? `:box=1:boxcolor=${String(input.boxColor)}:boxborderw=${num(input.fontSize, 56) / 3}` : '';
        const enable =
            input.end !== undefined
                ? `:enable='between(t,${num(input.start, 0)},${num(input.end, 0)})'`
                : num(input.start, 0) > 0
                  ? `:enable='gte(t,${num(input.start, 0)})'`
                  : '';
        const vf = `drawtext=${font}text='${escaped}':x=${String(input.x ?? '(w-text_w)/2')}:y=${String(input.y ?? 'h-th-120')}:fontsize=${num(input.fontSize, 56)}:fontcolor=${String(input.color ?? 'white')}${box}${enable}`;
        const dest = ctx.out(String(input.out ?? 'text.mp4'));
        await ffmpeg(['-y', '-i', src, '-vf', vf, '-c:a', 'copy', dest]);
        return { outputs: [{ path: dest, kind: 'video' }] };
    },
});
