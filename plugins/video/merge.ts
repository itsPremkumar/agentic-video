import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile } from '../_shared/common.ts';

export default definePlugin({
    id: 'video.merge',
    name: 'Concatenate videos',
    category: 'video',
    description: 'Join multiple clips end to end. Re-encodes so mixed sources always work.',
    inputs: {
        sources: S.array('Array of video paths, in order', { required: true }),
        out: S.string('Output file name', { default: 'merged.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const list = Array.isArray(input.sources) ? (input.sources as unknown[]) : [];
        if (list.length < 2) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'sources must contain at least 2 video paths.',
                input: { sources: input.sources },
                retryable: true,
            });
        }
        const files = list.map((s, i) => requireFile(s, `sources[${i}]`));

        // Normalise every clip to the same codec/params, then concat safely.
        const tmpDir = path.join(ctx.workspaceDir, '_concat');
        fs.mkdirSync(tmpDir, { recursive: true });
        const normalised: string[] = [];
        for (let i = 0; i < files.length; i++) {
            const dest = path.join(tmpDir, `part_${i}.ts`);
            await ffmpeg([
                '-y', '-i', files[i],
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
                '-pix_fmt', 'yuv420p', '-r', '30',
                '-c:a', 'aac', '-ar', '48000', '-ac', '2',
                dest,
            ]);
            normalised.push(dest);
        }
        const listFile = path.join(tmpDir, 'list.txt');
        fs.writeFileSync(listFile, normalised.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
        const dest = ctx.out(String(input.out ?? 'merged.mp4'));
        await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', dest]);
        return { outputs: [{ path: dest, kind: 'video', meta: { clips: files.length } }] };
    },
});
