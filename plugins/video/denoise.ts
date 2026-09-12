import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';

/**
 * video.denoise - spatial+temporal denoise for video. Uses ffmpeg's hqdn3d
 * (high quality denoise 3D) — fast, model-free, great for cleaning up
 * noisy/dusty footage.
 */
export default definePlugin({
    id: 'video.denoise',
    name: 'Denoise video with hqdn3d',
    category: 'effects',
    description: 'Spatial + temporal denoise (hqdn3d). Optional chroma-only mode to keep skin tones clean.',
    inputs: {
        file: S.string('Path to input video', { required: true }),
        lumaSpatial: S.number('Luma spatial strength (0.0 - 1.0+)', { default: 4 }),
        lumaTemporal: S.number('Luma temporal strength', { default: 3 }),
        chromaSpatial: S.number('Chroma spatial strength', { default: 3 }),
        chromaTemporal: S.number('Chroma temporal strength', { default: 2 }),
        out: S.string('Output file (.mp4)', { default: 'denoised.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const file = requireFile(input.file, 'file');
        const ls = Number(input.lumaSpatial ?? 4);
        const lt = Number(input.lumaTemporal ?? 3);
        const cs = Number(input.chromaSpatial ?? 3);
        const ct = Number(input.chromaTemporal ?? 2);
        const out = ctx.out(String(input.out ?? 'denoised.mp4'));
        ensureParentDir(out);

        const filter = 'hqdn3d=' + String(ls) + ':' + String(cs) + ':' + String(lt) + ':' + String(ct);
        await ffmpeg(['-y', '-i', file, '-vf', filter, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'copy', out]);
        return { outputs: [{ path: out, kind: 'video' as const, meta: { ls, lt, cs, ct } }] };
    },
});