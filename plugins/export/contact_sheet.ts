import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'export.contact_sheet',
    name: 'Contact sheet / thumbnails',
    category: 'export',
    description: 'Build a grid of frames from a video (contact sheet) for visual review.',
    inputs: {
        src: S.string('Source video path', { required: true }),
        cols: S.int('Number of columns', { default: 3 }),
        rows: S.int('Number of rows', { default: 3 }),
        width: S.int('Width of each tile', { default: 320 }),
        out: S.string('Output file name', { default: 'contact_sheet.png' }),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const cols = num(input.cols, 3);
        const rows = num(input.rows, 3);
        const tile = num(input.width, 320);
        const dest = ctx.out(String(input.out ?? 'contact_sheet.png'));
        const vf = `fps=1/${Math.max(1, Math.round(100 / (cols * rows))) / 100 || 1},scale=${tile}:-1,tile=${cols}x${rows}`;
        await ffmpeg(['-y', '-i', src, '-vf', vf, '-frames:v', '1', dest]);
        return { outputs: [{ path: dest, kind: 'image', meta: { cols, rows, tile } }] };
    },
});
