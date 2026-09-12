/**
 * video.from_images — turn a set of stills into a video (the "image to video"
 * conversion from the reference project), entirely with ffmpeg.
 *
 * Two-tier design, matching the reference implementation:
 *   1. Zero-cost local path (this plugin) — Ken Burns / slideshow, no API key.
 *   2. AI motion path — see video.generate (fal.ai wan-i2v), which needs FAL_KEY.
 *
 * This plugin is the local one. It is explicit about failures: if a single
 * image cannot be turned into a clip you get the ffmpeg stderr verbatim.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg, durationOf } from '../../core/media.ts';
import { S, resolveOutPath } from '../_shared/common.ts';

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|tiff?|gif)$/i;

function collectFiles(input: Record<string, unknown>): string[] {
    const out: string[] = [];

    if (Array.isArray(input.files)) {
        for (const f of input.files as unknown[]) {
            const p = path.resolve(String(f));
            if (!fs.existsSync(p)) {
                throw new PluginFailure({
                    code: 'FILE_NOT_FOUND',
                    message: `Image not found: ${p}`,
                    input: { files: input.files },
                    retryable: true,
                    hint: 'Use absolute paths, or paths relative to the project root.',
                });
            }
            out.push(p);
        }
    }

    if (typeof input.dir === 'string' && input.dir) {
        const dir = path.resolve(input.dir);
        if (!fs.existsSync(dir)) {
            throw new PluginFailure({
                code: 'DIR_NOT_FOUND',
                message: `Directory not found: ${dir}`,
                input: { dir: input.dir },
                retryable: true,
            });
        }
        for (const name of fs.readdirSync(dir).sort()) {
            if (IMAGE_EXT.test(name)) out.push(path.join(dir, name));
        }
    }

    if (!out.length) {
        throw new PluginFailure({
            code: 'NO_INPUT_IMAGES',
            message: 'No images to convert.',
            reason: 'Pass `files` (array of paths) or `dir` (a folder of images).',
            input: { files: input.files, dir: input.dir },
            retryable: true,
        });
    }
    return out;
}

/** Cover = fill and crop; contain = fit and pad. */
function fitFilter(w: number, h: number, fit: string): string {
    return fit === 'contain'
        ? `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`
        : `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
}

/**
 * Ken Burns zoom expression. `on` is the output frame index (0..N), so the
 * ramp is linear and deterministic across the clip.
 */
function zoomExpr(direction: string, amount: number, frames: number): string {
    const z = Math.max(1, amount);
    if (direction === 'out') {
        const step = ((z - 1) / Math.max(1, frames)).toFixed(6);
        return `z='max(${z}-${step}*on,1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
    }
    const step = ((z - 1) / Math.max(1, frames)).toFixed(6);
    return `z='min(1+${step}*on,${z})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
}

export default definePlugin({
    id: 'video.from_images',
    name: 'Images to video (slideshow / Ken Burns)',
    category: 'video',
    description:
        'Convert still images into a video with optional Ken Burns motion and crossfade transitions. Local ffmpeg — no API key. (For AI motion see video.generate.)',
    inputs: {
        files: S.array('Array of image paths (in order)'),
        dir: S.string('...or a folder of images (sorted by filename)'),
        durationPerImage: S.number('Seconds each image is shown', { default: 3, minimum: 0.2 }),
        kenBurns: S.bool('Apply a Ken Burns zoom to each still', { default: true }),
        zoomDirection: S.string('Zoom direction', { default: 'in', enum: ['in', 'out'] }),
        zoomAmount: S.number('End zoom factor (1 = no zoom, 1.15 = subtle)', {
            default: 1.15,
            minimum: 1,
            maximum: 3,
        }),
        transition: S.string('Transition between images', {
            default: 'none',
            enum: ['none', 'fade', 'fadeblack', 'fadewhite'],
        }),
        transitionDuration: S.number('Transition length in seconds', { default: 0.5, minimum: 0.1 }),
        width: S.int('Output width', { default: 1080, minimum: 64 }),
        height: S.int('Output height', { default: 1920, minimum: 64 }),
        fps: S.int('Output fps', { default: 30, minimum: 1, maximum: 60 }),
        fit: S.string('How to fit images that are not the output aspect', {
            default: 'cover',
            enum: ['cover', 'contain'],
        }),
        out: S.string('Output video file (.mp4)', { default: 'slideshow.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const rec = input as Record<string, unknown>;
        const files = collectFiles(rec);

        const W = Number(input.width ?? 1080);
        const H = Number(input.height ?? 1920);
        const fps = Number(input.fps ?? 30);
        const dur = Math.max(0.2, Number(input.durationPerImage ?? 3));
        const kb = input.kenBurns !== false;
        const dir = String(input.zoomDirection ?? 'in');
        const zAmount = Number(input.zoomAmount ?? 1.15);
        const fit = String(input.fit ?? 'cover');
        const frames = Math.max(1, Math.round(dur * fps));

        const dest = resolveOutPath(ctx, String(input.out ?? 'slideshow.mp4'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });

        // 1. Render one clip per image so every clip shares codec/size/fps.
        const clips: string[] = [];
        for (let i = 0; i < files.length; i++) {
            const clipPath = ctx.out(`.clip_${String(i).padStart(3, '0')}.mp4`);
            const vf = kb
                ? `${fitFilter(W, H, fit)},zoompan=${zoomExpr(dir, zAmount, frames)}:d=${frames}:s=${W}x${H}:fps=${fps},format=yuv420p`
                : `${fitFilter(W, H, fit)},format=yuv420p`;

            const res = await ffmpeg([
                '-y',
                '-loop', '1',
                '-i', files[i],
                '-vf', vf,
                '-t', String(dur),
                '-r', String(fps),
                '-c:v', 'libx264',
                '-preset', 'veryfast',
                '-crf', '23',
                '-pix_fmt', 'yuv420p',
                clipPath,
            ]);
            if (res.code !== 0) {
                throw new PluginFailure({
                    code: 'CLIP_RENDER_FAILED',
                    message: `Could not render image ${i + 1}/${files.length} (${path.basename(files[i])}) to a clip.`,
                    reason: (res.stderr || res.stdout || '').slice(-900),
                    input: { file: files[i], filter: vf, durationPerImage: dur },
                    retryable: true,
                    hint: 'Check the image is a valid, readable file. Very large images can also exhaust memory - resize them first with image.resize.',
                });
            }
            clips.push(clipPath);
        }

        const warnings: string[] = [];
        const transition = String(input.transition ?? 'none');

        // 2. Join the clips.
        if (files.length === 1 || transition === 'none') {
            if (files.length === 1) {
                fs.copyFileSync(clips[0], dest);
            } else {
                const listPath = ctx.out('.concat_list.txt');
                fs.writeFileSync(
                    listPath,
                    clips.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
                    'utf8',
                );
                const res = await ffmpeg([
                    '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
                    '-c', 'copy',
                    dest,
                ]);
                if (res.code !== 0) {
                    throw new PluginFailure({
                        code: 'CONCAT_FAILED',
                        message: 'Rendered the clips but could not concatenate them.',
                        reason: (res.stderr || res.stdout || '').slice(-900),
                        input: { clips: clips.length },
                        retryable: true,
                    });
                }
            }
        } else {
            // xfade chain: total = N*dur - (N-1)*td
            const td = Number(input.transitionDuration ?? 0.5);
            if (td >= dur) {
                throw new PluginFailure({
                    code: 'INVALID_INPUT',
                    message: 'transitionDuration must be shorter than durationPerImage.',
                    input: { transitionDuration: td, durationPerImage: dur },
                    retryable: true,
                });
            }
            const args: string[] = ['-y'];
            for (const c of clips) args.push('-i', c);

            let chain = '';
            for (let i = 0; i < clips.length; i++) chain += `[${i}:v]settb=AVTB,fps=${fps}[s${i}];`;
            let prevLabel = 's0';
            let acc = 0;
            for (let i = 1; i < clips.length; i++) {
                const prevDur = await durationOf(clips[i - 1]);
                acc += prevDur - td;
                chain += `[${prevLabel}][s${i}]xfade=transition=${transition}:duration=${td}:offset=${Math.max(0, acc).toFixed(3)}[x${i}];`;
                prevLabel = `x${i}`;
            }
            args.push('-filter_complex', chain.replace(/;$/, ''), '-map', `[${prevLabel}]`);
            args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', dest);

            const res = await ffmpeg(args);
            if (res.code !== 0) {
                throw new PluginFailure({
                    code: 'TRANSITION_FAILED',
                    message: `Could not crossfade the clips with "${transition}".`,
                    reason: (res.stderr || res.stdout || '').slice(-900),
                    input: { clips: clips.length, transition, transitionDuration: td },
                    retryable: true,
                    hint: 'xfade needs every clip to share size, fps and pixel format - this plugin guarantees that, so the cause is usually an ffmpeg build without xfade.',
                });
            }
        }

        // 3. Clean up intermediate clips.
        for (const c of clips) {
            try {
                fs.unlinkSync(c);
            } catch {
                warnings.push('could not delete temp clip ' + path.basename(c));
            }
        }

        let seconds = 0;
        try {
            seconds = await durationOf(dest);
        } catch {
            /* non-fatal */
        }

        return {
            outputs: [
                {
                    path: dest,
                    kind: 'video',
                    meta: {
                        images: files.length,
                        durationPerImage: dur,
                        kenBurns: kb,
                        zoomDirection: dir,
                        zoomAmount: zAmount,
                        transition,
                        width: W,
                        height: H,
                        fps,
                        fit,
                        durationSeconds: seconds,
                    },
                },
            ],
            warnings,
        };
    },
});
