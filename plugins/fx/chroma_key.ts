import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';

/**
 * fx.chroma_key - remove a coloured background (green/blue screen) from a video.
 * Uses ffmpeg's chromakey filter. Outputs alpha-channel WebM so the result can
 * be composited over other footage, OR a key-coloured mp4 (blacks replaced with
 * `bg` image or solid colour).
 */
export default definePlugin({
    id: 'fx.chroma_key',
    name: 'Chroma key (green/blue screen) removal',
    category: 'fx',
    description: 'Remove a colour from the background of a clip. Outputs WebM with alpha or mp4 over a coloured background.',
    inputs: {
        file: S.string('Path to input video', { required: true }),
        color: S.string('Key colour (hex, default bright green)', { default: '#00b140' }),
        similarity: S.number('How close to the key colour to start cutting (0.0-1.0)', { default: 0.05, minimum: 0, maximum: 1 }),
        blend: S.number('Smoothness of the alpha cutoff (0.0-1.0)', { default: 0.02, minimum: 0, maximum: 1 }),
        bgColor: S.string('Background colour for non-alpha output (hex)', { default: '#000000' }),
        alphaOutput: S.bool('Output PNG sequence with alpha (true) or mp4 over a solid colour (false)', { default: true }),
        out: S.string('Output file (PNG template like keyed-%04d.png or .mp4)', { default: 'keyed-%04d.png' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const file = requireFile(input.file, 'file');
        const color = String(input.color ?? '#00b140');
        const similarity = Number(input.similarity ?? 0.4);
        const blend = Number(input.blend ?? 0.1);
        const bgColor = String(input.bgColor ?? '#000000');
        const alphaOutput = input.alphaOutput !== false;

        const hex = color.startsWith('#') ? color.slice(1) : color;
        const colorArg = '0x' + hex.slice(0, 6);
        const outExt = alphaOutput ? '%04d.png' : '.mp4';
        const userOut = String(input.out ?? (alphaOutput ? 'keyed-%04d.png' : 'keyed.mp4'));
        const finalOut = alphaOutput ? userOut : userOut.replace(/\.[^.]+$/, '') + '.mp4';
        const out = ctx.out(finalOut);
        ensureParentDir(out);

        const filter = 'chromakey=' + colorArg + ':' + similarity.toFixed(3) + ':' + blend.toFixed(3);
        const args: string[] = [];

        if (alphaOutput) {
            // PNG sequence preserves alpha reliably across platforms (libvpx-vp9
            // doesn't write alpha in this ffmpeg build). The agent can later
            // composite the sequence using ffmpeg or another tool.
            args.push('-y', '-i', file, '-vf', filter + ',format=rgba', '-an', '-c:v', 'png', out);
        } else {
            args.push(
                '-y', '-i', file,
                '-filter_complex', '[0:v]chromakey=' + colorArg + ':' + similarity.toFixed(3) + ':' + blend.toFixed(3) + '[ck];color=c=' + bgColor + ':s=1280x720:d=999[bg];[bg][ck]overlay=shortest=1',
                '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-an', out,
            );
        }
        await ffmpeg(args);
        return { outputs: [{ path: out, kind: 'video' as const, meta: { color, similarity, blend, alpha: alphaOutput } }] };
    },
});