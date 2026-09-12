import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg, probe, durationOf } from '../../core/media.ts';
import { S, requireFile, num, resolveOutPath, invalidInput } from '../_shared/common.ts';

/**
 * video.transform — keyframed scale / position / rotation / opacity.
 *
 * This was the biggest gap in the toolkit. Everything else could assemble and
 * process clips, but nothing could ANIMATE a clip's transform over time, which
 * is what separates assembling assets from editing them. Without it you cannot
 * do a moving picture-in-picture, a push-in on live footage, a sliding title,
 * a slow drift, or a dynamic crop.
 *
 * The animation is expressed as ffmpeg expressions in `t`, built by summing
 * clamped ramps between consecutive keyframes — so any number of keyframes
 * works without generating intermediate clips.
 *
 * Note: `x`/`y` are pixel offsets from the centre of the output canvas, not
 * absolute coordinates, so the same keyframes survive a change of resolution.
 */
export default definePlugin({
    id: 'video.transform',
    name: 'Keyframed transform',
    category: 'video',
    description: 'Animate a clip\u2019s scale, position and rotation between keyframes, composited onto a background at a constant opacity.',
    inputs: {
        src: S.string('Source video or image', { required: true }),
        keyframes: S.array('Array of {time, scale?, x?, y?, rotation?, opacity?} in seconds/px/degrees. opacity must be the same on every keyframe.', { required: true }),
        width: S.int('Output canvas width (0 = source width)', { default: 0, minimum: 0 }),
        height: S.int('Output canvas height (0 = source height)', { default: 0, minimum: 0 }),
        background: S.string('Background colour behind the transformed clip', { default: '#000000' }),
        duration: S.number('Output duration in seconds (0 = source duration)', { default: 0, minimum: 0 }),
        ease: S.string('Interpolation between keyframes', { enum: ['linear', 'smooth'], default: 'smooth' }),
        fps: S.int('Output fps (0 = source fps)', { default: 0, minimum: 0 }),
        out: S.string('Output file name (.mp4)', { default: 'transformed.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');

        const raw = Array.isArray(input.keyframes) ? (input.keyframes as Record<string, unknown>[]) : [];
        if (!raw.length) {
            invalidInput('Provide at least one keyframe.', {
                field: 'keyframes',
                hint: 'e.g. [{"time":0,"scale":1},{"time":2,"scale":1.3,"x":80}]',
            });
        }

        const keys = raw
            .map((k) => ({
                time: num(k?.time, 0),
                scale: num(k?.scale, 1),
                x: num(k?.x, 0),
                y: num(k?.y, 0),
                rotation: num(k?.rotation, 0),
                opacity: num(k?.opacity, 1),
            }))
            .sort((a, b) => a.time - b.time);

        for (const k of keys) {
            if (k.scale <= 0) {
                invalidInput('scale must be greater than 0.', { field: 'keyframes', value: k.scale });
            }
            if (k.opacity < 0 || k.opacity > 1) {
                invalidInput('opacity must be between 0 and 1.', { field: 'keyframes', value: k.opacity });
            }
        }

        // Opacity is the one property ffmpeg cannot animate cheaply here:
        // colorchannelmixer has no time variable at all, and geq would recompute
        // every pixel of every frame. Rather than quietly ignoring the keyframes,
        // say so and point at the plugin that does fades properly.
        const opacities = keys.map((k) => k.opacity);
        if (Math.max(...opacities) - Math.min(...opacities) > 1e-6) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'Animated opacity is not supported by video.transform.',
                reason:
                    'ffmpeg can only evaluate opacity as a constant here — colorchannelmixer has no `t` variable, ' +
                    'and the alternative (geq) recomputes every pixel of every frame.',
                input: { keyframes: raw },
                retryable: true,
                hint: 'Use a constant `opacity` on every keyframe, and add video.fade for fade-in / fade-out.',
            });
        }
        const opacity = keys[0].opacity;

        const ease = String(input.ease ?? 'smooth') === 'linear' ? 'linear' : 'smooth';

        /** One property, as an ffmpeg expression in `t`: base + Σ clamped ramps. */
        const ramp = (prop: 'scale' | 'x' | 'y' | 'rotation'): string => {
            let out = String(keys[0][prop]);
            for (let i = 1; i < keys.length; i++) {
                const delta = keys[i][prop] - keys[i - 1][prop];
                if (Math.abs(delta) < 1e-9) continue;
                const t0 = keys[i - 1].time;
                const span = keys[i].time - t0;
                // A zero-length segment means "jump here" — the ramp is already
                // complete the instant we reach t0.
                const u = span > 0 ? `min(max((t-${t0})/${span},0),1)` : '1';
                const shaped = ease === 'smooth' ? `(${u}*${u}*(3-2*${u}))` : u;
                out += `+(${delta})*${shaped}`;
            }
            return out;
        };

        const info = await probe(src);
        const stream = (info?.streams ?? []).find((s: Record<string, unknown>) => s?.codec_type === 'video') ?? {};
        const srcW = num(stream.width, 0);
        const srcH = num(stream.height, 0);
        if (!srcW || !srcH) {
            throw new PluginFailure({
                code: 'CLIP_UNREADABLE',
                message: `No video stream found in "${src}".`,
                reason: 'ffprobe reported no width/height for this file.',
                input: { src },
                retryable: false,
                hint: 'Pass a decodable image or video file.',
            });
        }

        const width = num(input.width, 0) || srcW;
        const height = num(input.height, 0) || srcH;
        const sourceDuration = await durationOf(src);
        const duration = num(input.duration, 0) || sourceDuration;
        if (duration <= 0) {
            throw new PluginFailure({
                code: 'CLIP_UNREADABLE',
                message: `Could not determine a duration for "${src}".`,
                input: { src },
                retryable: false,
                hint: 'Pass --input duration=<seconds> explicitly.',
            });
        }

        const fpsRaw = String(stream.r_frame_rate ?? '30/1');
        const [fpsNum, fpsDen] = fpsRaw.split('/').map(Number);
        const sourceFps = fpsDen ? fpsNum / fpsDen : 30;
        const fps = num(input.fps, 0) || (Number.isFinite(sourceFps) && sourceFps > 0 ? sourceFps : 30);

        const dest = resolveOutPath(ctx, String(input.out ?? 'transformed.mp4'));
        const bg = String(input.background ?? '#000000');

        // Rotate first (on a constant-size input, so rotw/roth are stable), then
        // animate the scale. Doing it the other way round makes the rotate
        // output size change every frame.
        const chain = [
            `[0:v]format=rgba,rotate='(${ramp('rotation')})*PI/180':c=none:ow=rotw(iw):oh=roth(ih)[rt]`,
            `[rt]scale=w='trunc(iw*(${ramp('scale')})/2)*2':h='trunc(ih*(${ramp('scale')})/2)*2':eval=frame[sc]`,
            `[sc]colorchannelmixer=aa=${opacity}[fg]`,
            `color=c=${bg}:s=${width}x${height}:r=${fps}:d=${duration}[bgc]`,
            `[bgc][fg]overlay=x='(W-w)/2+(${ramp('x')})':y='(H-h)/2+(${ramp('y')})':shortest=1:format=auto,format=yuv420p[out]`,
        ].join(';');

        await ffmpeg([
            '-y', '-i', src,
            '-filter_complex', chain,
            '-map', '[out]',
            '-t', String(duration),
            '-r', String(fps),
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18',
            dest,
        ]);

        return {
            outputs: [
                {
                    path: dest,
                    kind: 'video',
                    meta: { keyframes: keys.length, ease, opacity, width, height, duration, fps },
                },
            ],
        };
    },
});
