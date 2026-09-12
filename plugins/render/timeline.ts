import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg, probe } from '../../core/media.ts';
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
    /**
     * Static framing within the output canvas. `scale` is relative to "fitted"
     * (1 = fills the frame, letterboxed); `x`/`y` are pixel offsets from centre.
     * Animated framing belongs in `video.transform`, not here.
     */
    transform?: { scale?: number; x?: number; y?: number; rotation?: number; background?: string };
    /** Retime this clip. 2 = twice as fast. Audio is retimed with it. */
    speed?: number;
    /** Per-clip audio level, so one shot can sit under another. */
    volume?: number;
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

/**
 * `atempo` only accepts 0.5–2.0, so anything outside that has to be chained.
 * 4x becomes atempo=2,atempo=2; 0.25x becomes atempo=0.5,atempo=0.5.
 */
function atempoChain(speed: number): string {
    const steps: string[] = [];
    let s = speed;
    while (s > 2) {
        steps.push('atempo=2');
        s /= 2;
    }
    while (s < 0.5) {
        steps.push('atempo=0.5');
        s /= 0.5;
    }
    steps.push(`atempo=${Number(s.toFixed(6))}`);
    return steps.join(',');
}

export default definePlugin({
    id: 'render.timeline',
    name: 'Render final timeline',
    category: 'render',
    description: 'Assemble an explicit list of clips (+ optional audio and subtitles) into the final video.',
    inputs: {
        clips: S.array(
            'Array of {src, start, duration, transition, transitionDuration, transform:{scale,x,y,rotation,background}, speed, volume}',
            { required: true },
        ),
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

        // 1. Normalise each clip to identical codec / size / fps / audio layout.
        //
        // Every part gets an audio track — silence when the source has none —
        // so the concat steps downstream never have to care. That is what makes
        // per-clip `volume` and `speed` work across mixed stills and clips.
        const parts: string[] = [];
        for (let i = 0; i < clips.length; i++) {
            const c = clips[i];
            const src = requireFile(c.src, `clips[${i}].src`);
            const part = path.join(tmp, `c${i}.mp4`);
            const still = isStill(src);
            const speed = num(c.speed, 1) || 1;
            if (speed <= 0) {
                throw new PluginFailure({
                    code: 'INVALID_INPUT',
                    message: `clips[${i}].speed must be greater than 0.`,
                    input: { index: i, speed: c.speed },
                    retryable: true,
                    hint: '2 = twice as fast, 0.5 = half speed.',
                });
            }

            let hasAudio = false;
            try {
                const info = await probe(src);
                hasAudio = ((info?.streams ?? []) as Record<string, unknown>[]).some((s) => s?.codec_type === 'audio');
            } catch {
                hasAudio = false;
            }

            const args = ['-y'];
            // A still must be looped or ffmpeg emits a single frame (and, for
            // some sources, a file with no video stream at all). Seeking is
            // meaningless on a still, so `-ss` is skipped for them too.
            if (still) args.push('-loop', '1');
            else if (c.start) args.push('-ss', String(c.start));
            args.push('-i', src);

            const dur = c.duration ?? (still ? DEFAULT_STILL_SECONDS : undefined);
            const outDur = dur !== undefined ? dur / speed : undefined;

            // --- video chain -------------------------------------------------
            const t = c.transform;
            const framed = t && (t.scale !== undefined || t.x !== undefined || t.y !== undefined || t.rotation);
            const vf: string[] = [];
            if (framed) {
                // Fit first, so scale 1 means "fills the frame" and the offsets
                // are relative to a known baseline rather than the raw source.
                vf.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`);
                if (t?.rotation) vf.push(`rotate=${t.rotation}*PI/180:c=none:ow=rotw(iw):oh=roth(ih)`);
                const sc = num(t?.scale, 1);
                if (sc !== 1) vf.push(`scale=w=trunc(iw*${sc}/2)*2:h=trunc(ih*${sc}/2)*2`);
                vf.push(
                    `pad=${W}:${H}:x='(ow-iw)/2+${num(t?.x, 0)}':y='(oh-ih)/2+${num(t?.y, 0)}':color=${t?.background ?? 'black'}`,
                );
            } else {
                vf.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black`);
            }
            if (speed !== 1) vf.push(`setpts=PTS/${speed}`);
            vf.push(`fps=${fps}`, 'settb=AVTB');

            // --- audio chain ------------------------------------------------
            const af: string[] = [];
            if (speed !== 1) af.push(atempoChain(speed));
            if (c.volume !== undefined) af.push(`volume=${num(c.volume, 1)}`);
            af.push('aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo');

            if (hasAudio) {
                args.push('-map', '0:v:0', '-map', '0:a:0');
            } else {
                // Silence long enough to cover the retimed picture, then let
                // -shortest trim it to exactly the video length.
                args.push('-f', 'lavfi', '-t', String(outDur ?? DEFAULT_STILL_SECONDS), '-i', 'anullsrc=r=48000:cl=stereo');
                args.push('-map', '0:v:0', '-map', '1:a:0');
            }
            if (outDur !== undefined) args.push('-t', String(outDur));

            args.push(
                '-vf', vf.join(','),
                '-af', af.join(','),
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-ar', '48000', '-ac', '2',
                '-shortest',
                part,
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
            // Mirror the video chain on audio so the two stay in sync: a cut
            // concatenates, a transition acrossfades by the same duration. Skip
            // it entirely when an external audio bed replaces the clip audio.
            let audioChain = '';
            let prevAudio = 'sa0';
            if (!input.audio) {
                for (let i = 0; i < parts.length; i++) {
                    audioChain += `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[sa${i}];`;
                }
                for (let i = 1; i < parts.length; i++) {
                    const t = clips[i].transition ?? 'cut';
                    const td = Number(clips[i].transitionDuration ?? 0.5);
                    if (!t || t === 'cut') {
                        audioChain += `[${prevAudio}][sa${i}]concat=n=2:v=0:a=1[aa${i}];`;
                    } else {
                        audioChain += `[${prevAudio}][sa${i}]acrossfade=d=${td}:c1=tri:c2=tri[aa${i}];`;
                    }
                    prevAudio = `aa${i}`;
                }
            }

            let fullChain = chain.replace(/;$/, '');
            if (audioChain) fullChain += ';' + audioChain.replace(/;$/, '');

            const args = ['-y'];
            for (const p of parts) args.push('-i', p);
            if (input.audio) {
                args.push('-i', String(input.audio));
                const vol = num(input.audioVolume, 1);
                fullChain += `;[${parts.length}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo${vol !== 1 ? `,volume=${vol}` : ''}[aext]`;
            }
            args.push('-filter_complex', fullChain, '-map', `[${prevLabel}]`);
            args.push('-map', input.audio ? '[aext]' : `[${prevAudio}]`, '-c:a', 'aac', '-shortest');
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
            // The concat demuxer already carries each clip's audio, so an
            // external bed has to be mapped explicitly or ffmpeg may keep the
            // clip audio instead of the one that was asked for.
            if (input.audio) {
                args.push('-map', '0:v:0', '-map', '1:a:0');
                const vol = num(input.audioVolume, 1);
                if (vol !== 1) args.push('-af', `volume=${vol}`);
            } else {
                args.push('-map', '0:v:0', '-map', '0:a:0?');
            }
            args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac');
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
