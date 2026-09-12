import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

/**
 * render.timeline — the final assembly step.
 *
 * Takes an explicit timeline description (clips with optional trims, plus
 * optional audio and subtitle files) and renders it. It only uses what the
 * caller supplies — it never acquires or substitutes anything.
 */
interface TimelineClip {
    src: string;
    start?: number;
    duration?: number;
    transition?: string;
    transitionDuration?: number;
}

/** Formats ffmpeg treats as a single still rather than a stream. */
const STILL_EXT = /\.(jpe?g|png|webp|bmp|tiff?|gif)$/i;
const isStill = (p: string): boolean => STILL_EXT.test(path.extname(p));

/**
 * Default length for a still that arrives without an explicit `duration`.
 * A still has no intrinsic length, so without this the timeline would have
 * a zero-duration segment and every downstream xfade offset would collapse.
 */
const DEFAULT_STILL_SECONDS = 3;

export default definePlugin({
    id: 'render.timeline',
    name: 'Render final timeline',
    category: 'render',
    description: 'Assemble an explicit list of clips (+ optional audio and subtitles) into the final video.',
    inputs: {
        clips: S.array('Array of {src, start, duration, transition, transitionDuration}', { required: true }),
        width: S.int('Output width', { default: 1080 }),
        height: S.int('Output height', { default: 1920 }),
        fps: S.int('Frames per second', { default: 30 }),
        audio: S.string('Optional audio file (voiceover / music bed)'),
        audioVolume: S.number('Audio volume multiplier', { default: 1 }),
        subtitles: S.string('Optional .srt/.ass file to burn in'),
        out: S.string('Output file name', { default: 'final.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const clips = Array.isArray(input.clips) ? (input.clips as TimelineClip[]) : [];
        if (!clips.length) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'clips must be a non-empty array of {src, ...}.',
                input: { clips: input.clips },
                retryable: true,
            });
        }
        const W = num(input.width, 1080);
        const H = num(input.height, 1920);
        const fps = num(input.fps, 30);
        const tmp = path.join(ctx.workspaceDir, '_timeline');
        fs.mkdirSync(tmp, { recursive: true });

        // 1. Normalise each clip to identical codec / size / fps.
        const parts: string[] = [];
        for (let i = 0; i < clips.length; i++) {
            const c = clips[i];
            const src = requireFile(c.src, `clips[${i}].src`);
            const part = path.join(tmp, `c${i}.mp4`);
            const still = isStill(src);
            const args = ['-y'];
            // A still must be looped or ffmpeg emits a single frame (and, for
            // some sources, a file with no video stream at all). Seeking is
            // meaningless on a still, so `-ss` is skipped for them too.
            if (still) args.push('-loop', '1');
            else if (c.start) args.push('-ss', String(c.start));
            args.push('-i', src);
            const dur = c.duration ?? (still ? DEFAULT_STILL_SECONDS : undefined);
            if (dur) args.push('-t', String(dur));
            args.push(
                '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,fps=${fps},settb=AVTB`,
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
                '-an', part,
            );
            await ffmpeg(args);
            parts.push(part);
        }

        const dest = ctx.out(String(input.out ?? 'final.mp4'));
        const { durationOf } = await import('../../core/media.ts');

        // 2. Chain xfade transitions (or plain concat when none are requested).
        const anyTransition = clips.slice(1).some((c) => c.transition && c.transition !== 'cut');
        let videoOut = 'vout';
        const filterParts: string[] = [];
        const extraInputs: string[] = [];

        if (anyTransition) {
            let offset = 0;
            let prev = '0:v';
            parts.forEach((_, i) => {
                filterParts.push(`[${i}:v]settb=AVTB,fps=${fps}[s${i}];`);
            });
            let chain = filterParts.join('');
            let prevLabel = 's0';
            for (let i = 1; i < parts.length; i++) {
                const t = clips[i].transition ?? 'cut';
                const td = Number(clips[i].transitionDuration ?? 0.5);
                if (!t || t === 'cut') {
                    chain += `[${prevLabel}][s${i}]concat=n=2:v=1:a=0[cc${i}];`;
                    prevLabel = `cc${i}`;
                } else {
                    const prevDur = 0; // computed below via async pass
                    void prevDur;
                    // @@ delimiters: a bare OFF1 token would also match OFF10
                    // once a timeline has more than nine transitions.
                    chain += `[${prevLabel}][s${i}]xfade=transition=${t}:duration=${td}:offset=@@OFF${i}@@[x${i}];`;
                    prevLabel = `x${i}`;
                }
            }
            // Resolve offsets (needs durations, so do it before running).
            let acc = 0;
            for (let i = 1; i < parts.length; i++) {
                const prevDur = await durationOf(parts[i - 1]);
                // A zero-length part makes every later offset collapse to 0,
                // which renders as "matches no streams" deep inside ffmpeg —
                // an unreadable failure. Catch it here and name the clip.
                if (!(prevDur > 0)) {
                    throw new PluginFailure({
                        code: 'CLIP_UNREADABLE',
                        message: `clips[${i - 1}] produced no usable video (0s, ${clips[i - 1].src}).`,
                        reason: 'The clip could not be normalised — it is probably not a media file ffmpeg can decode.',
                        input: { index: i - 1, src: clips[i - 1].src },
                        retryable: true,
                        hint: 'Check the file is a valid video or image. Stills are supported; give each one an explicit `duration`.',
                    });
                }
                const t = clips[i].transition ?? 'cut';
                const td = Number(clips[i].transitionDuration ?? 0.5);
                acc += t && t !== 'cut' ? prevDur - td : prevDur;
                chain = chain.replace(`@@OFF${i}@@`, Math.max(0, acc).toFixed(3));
            }
            const args = ['-y'];
            for (const p of parts) args.push('-i', p);
            if (input.audio) args.push('-i', String(input.audio));
            args.push('-filter_complex', chain.replace(/;$/, ''), '-map', `[${prevLabel}]`);
            if (input.audio) {
                args.push('-map', `${parts.length}:a`, '-c:a', 'aac', '-shortest');
            }
            args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', dest);
            await ffmpeg(args);
        } else {
            const listFile = path.join(tmp, 'list.txt');
            fs.writeFileSync(listFile, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
            const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile];
            if (input.audio) args.push('-i', String(input.audio), '-shortest');
            if (input.subtitles) {
                const subs = requireFile(input.subtitles, 'subtitles');
                args.push('-vf', `subtitles='${subs.replace(/\\/g, '/').replace(/:/g, '\\:')}'`);
            }
            args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p');
            if (input.audio) args.push('-c:a', 'aac');
            args.push(dest);
            await ffmpeg(args);
            videoOut = dest;
        }

        return {
            outputs: [{ path: dest, kind: 'video', meta: { clips: clips.length, width: W, height: H, transitioned: anyTransition } }],
            warnings: anyTransition && input.subtitles ? ['Subtitles are only burned in the non-transition path; call subtitle.burn afterwards if needed.'] : [],
        };
    },
});
