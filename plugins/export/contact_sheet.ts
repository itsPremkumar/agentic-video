import { definePlugin } from '../../core/define.ts';
import { ffmpeg, durationOf } from '../../core/media.ts';
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

        // `fps=1/INTERVAL` emits one frame every INTERVAL seconds, so INTERVAL
        // must be duration / tiles for the grid to span the whole video.
        //
        // This used to be `fps=1/${Math.round(100 / (cols*rows)) / 100}`, which
        // computes a *rate* (0.06) and feeds it as an *interval* — i.e. 16.7 fps.
        // tile= then grabbed the first 16 frames, all from the opening second,
        // so every tile showed the same frame.
        const tiles = Math.max(1, cols * rows);
        const duration = await durationOf(src);
        const interval = duration > 0 ? duration / tiles : 1;
        const vf = `fps=1/${interval},scale=${tile}:-1,tile=${cols}x${rows}`;
        await ffmpeg(['-y', '-i', src, '-vf', vf, '-frames:v', '1', dest]);
        return { outputs: [{ path: dest, kind: 'image', meta: { cols, rows, tile } }] };
    },
});
