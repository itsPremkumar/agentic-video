import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

/**
 * render.slideshow — turn a list of images into a video.
 * Only uses the assets handed to it; it never fetches or invents imagery.
 */
export default definePlugin({
    id: 'render.slideshow',
    name: 'Render slideshow video',
    category: 'render',
    description: 'Render a sequence of images into a video, with optional Ken Burns motion and audio.',
    inputs: {
        images: S.array('Array of image paths, in order', { required: true }),
        durations: S.array('Per-image duration in seconds (default 4 each)'),
        width: S.int('Output width', { default: 1080 }),
        height: S.int('Output height', { default: 1920 }),
        fps: S.int('Frames per second', { default: 30 }),
        kenBurns: S.bool('Slow zoom/pan on each image', { default: true }),
        audio: S.string('Optional audio file to add'),
        fade: S.number('Cross-fade seconds between images (0 = hard cut)', { default: 0.5, minimum: 0 }),
        out: S.string('Output file name', { default: 'slideshow.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const images = Array.isArray(input.images) ? (input.images as unknown[]) : [];
        if (!images.length) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'images must be a non-empty array of image paths.',
                input: { images: input.images },
                retryable: true,
            });
        }
        const files = images.map((p, i) => requireFile(p, `images[${i}]`));
        const durations = Array.isArray(input.durations)
            ? (input.durations as number[])
            : files.map(() => 4);
        const W = num(input.width, 1080);
        const H = num(input.height, 1920);
        const fps = num(input.fps, 30);
        const fade = num(input.fade, 0.5);
        const kb = input.kenBurns !== false;

        const tmp = path.join(ctx.workspaceDir, '_slideshow');
        fs.mkdirSync(tmp, { recursive: true });

        // Render each image to its own normalised clip, then concat them.
        const parts: string[] = [];
        for (let i = 0; i < files.length; i++) {
            const dur = Number(durations[i] ?? 4);
            const part = path.join(tmp, `s${i}.mp4`);
            const zoom = kb
                ? `scale=${W * 2}:${H * 2},zoompan=z='min(zoom+0.0008,1.25)':d=${Math.round(dur * fps)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${fps}`
                : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,fps=${fps}`;
            await ffmpeg([
                '-y', '-loop', '1', '-i', files[i],
                '-vf', zoom,
                '-t', String(dur),
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
                '-pix_fmt', 'yuv420p', '-r', String(fps),
                part,
            ]);
            parts.push(part);
        }

        const dest = ctx.out(String(input.out ?? 'slideshow.mp4'));

        if (fade > 0 && parts.length > 1) {
            // Chain xfade across all parts.
            const { durationOf } = await import('../../core/media.ts');
            const args = ['-y'];
            for (const p of parts) args.push('-i', p);
            // Every -i must appear before -filter_complex / -map: ffmpeg treats
            // an input option placed after an output option as an error.
            if (input.audio) args.push('-i', String(input.audio));
            let filter = '';
            let offset = 0;
            for (let i = 0; i < parts.length; i++) {
                if (i === 0) {
                    filter += `[0:v]settb=AVTB[a0];`;
                    continue;
                }
                const prevDur = await durationOf(parts[i - 1]);
                offset += prevDur - fade;
                const prevLabel = i === 1 ? 'a0' : `v${i - 1}`;
                filter += `[${i}:v]settb=AVTB[s${i}];[${prevLabel}][s${i}]xfade=transition=fade:duration=${fade}:offset=${Math.max(0, offset).toFixed(3)}[v${i}];`;
            }
            args.push('-filter_complex', filter.replace(/;$/, ''), '-map', `[v${parts.length - 1}]`);
            if (input.audio) args.push('-map', `${parts.length}:a`, '-c:a', 'aac', '-shortest');
            args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', dest);
            await ffmpeg(args);
        } else {
            const listFile = path.join(tmp, 'list.txt');
            fs.writeFileSync(listFile, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
            const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile];
            if (input.audio) args.push('-i', String(input.audio), '-shortest');
            args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p');
            if (input.audio) args.push('-c:a', 'aac');
            args.push(dest);
            await ffmpeg(args);
        }

        return { outputs: [{ path: dest, kind: 'video', meta: { clips: files.length, width: W, height: H } }] };
    },
});
