import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num, resolveOutPath } from '../_shared/common.ts';

/**
 * video.mask — cut a shape out of a shot.
 *
 * The VFX gap. `fx.chroma_key` removes a colour and `image.remove_bg` works on
 * stills; neither lets you mask a region of a moving shot. This builds a matte
 * — rectangle or ellipse, optionally feathered and optionally animated — and
 * composites the masked clip over a background (or leaves it transparent).
 *
 * Keyframes use the same clamped-ramp expressions as `video.transform`, so the
 * mask can move with a subject. It is shape masking, not rotoscoping: it will
 * not follow an actor on its own. That needs tracking, which needs a model.
 */
export default definePlugin({
    id: 'video.mask',
    name: 'Shape mask',
    category: 'video',
    description: 'Mask a rectangle or ellipse out of a clip, with feathering, optional keyframed motion, and a background to composite over.',
    inputs: {
        src: S.string('Source video', { required: true }),
        shape: S.string('Mask shape', { enum: ['rect', 'ellipse'], default: 'rect' }),
        keyframes: S.array('Array of {time, x, y, w, h} in seconds and pixels — omit for a static mask', { default: [] }),
        x: S.number('Static mask left edge in pixels', { default: 100 }),
        y: S.number('Static mask top edge in pixels', { default: 100 }),
        w: S.number('Static mask width in pixels', { default: 400 }),
        h: S.number('Static mask height in pixels', { default: 300 }),
        feather: S.number('Edge softness in pixels', { default: 12, minimum: 0 }),
        invert: S.bool('Keep everything EXCEPT the shape', { default: false }),
        background: S.string('Background colour behind the masked clip', { default: '#000000' }),
        transparent: S.bool('Leave the masked region transparent instead of compositing (.webm)', { default: false }),
        duration: S.number('Output duration in seconds (0 = source duration)', { default: 0, minimum: 0 }),
        fps: S.int('Frame rate, used to convert keyframe times to frame numbers', { default: 30, minimum: 1 }),
        out: S.string('Output file name (.mp4, or .webm when transparent)', { default: 'masked.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const shape = String(input.shape ?? 'rect');
        const feather = Math.max(0, num(input.feather, 12));
        const invert = input.invert === true;
        const transparent = input.transparent === true;
        const bg = String(input.background ?? '#000000');

        const rawKeys = Array.isArray(input.keyframes) ? (input.keyframes as Record<string, unknown>[]) : [];
        const animated = rawKeys.length > 0;

        const fallback = (name: 'x' | 'y' | 'w' | 'h'): number =>
            name === 'w' ? 400 : name === 'h' ? 300 : 100;

        // geq has NO `t` variable (same class of limitation as colorchannelmixer),
        // but it does have `N`, the frame number. So time is expressed as N/fps.
        const fps = num(input.fps, 0) || 30;
        const T = `(N/${fps})`;

        /** Same clamped-ramp technique as video.transform, in frames not seconds. */
        const prop = (name: 'x' | 'y' | 'w' | 'h'): string => {
            if (!animated) return String(num(input[name], fallback(name)));
            const keys = rawKeys
                .map((k) => ({ time: num(k?.time, 0), value: num(k?.[name], fallback(name)) }))
                .sort((a, b) => a.time - b.time);
            let out = String(keys[0].value);
            for (let i = 1; i < keys.length; i++) {
                const delta = keys[i].value - keys[i - 1].value;
                if (Math.abs(delta) < 1e-9) continue;
                const t0 = keys[i - 1].time;
                const span = keys[i].time - t0;
                const u = span > 0 ? `min(max((${T}-${t0})/${span},0),1)` : '1';
                const smooth = `(${u}*${u}*(3-2*${u}))`;
                out += `+(${delta})*${smooth}`;
            }
            return out;
        };

        const X = prop('x');
        const Y = prop('y');
        const W = prop('w');
        const H = prop('h');

        // Build the matte with geq ON A COPY of the source so it inherits the
        // source's dimensions. A separate `color` canvas would need the size
        // handed to it, and "iw x ih" is not a valid size expression.
        const cx = `((${X})+(${W})/2)`;
        const cy = `((${Y})+(${H})/2)`;
        const rx = `((${W})/2)`;
        const ry = `((${H})/2)`;
        const inside =
            shape === 'ellipse'
                ? `if(lte(((X-${cx})/max(${rx},1))*((X-${cx})/max(${rx},1))+((Y-${cy})/max(${ry},1))*((Y-${cy})/max(${ry},1)),1),255,0)`
                : `if(lte(X,(${X})),0,if(lte(X,(${X})+(${W})),if(lte(Y,(${Y})),0,if(lte(Y,(${Y})+(${H})),255,0)),0))`;

        const matteChain = [
            `geq=lum='${inside}':cb=128:cr=128`,
            // alphamerge reads the second input's luma as alpha; it needs a
            // single-plane format or the bind fails.
            'format=gray',
            ...(invert ? ['negate'] : []),
            ...(feather > 0 ? [`gblur=sigma=${feather.toFixed(2)}`] : []),
        ].join(',');

        // scale2ref sizes the background to the input, so this works at any
        // resolution without the caller telling us what it is. Its SECOND output
        // is the reference passthrough, and ffmpeg refuses to build the graph if
        // it is left dangling — hence the nullsink.
        const filter = transparent
            ? `[0:v]split=2[base][mk];[mk]${matteChain}[m];[base][m]alphamerge[out]`
            : `[0:v]split=3[base][mk][ref];[mk]${matteChain}[m];[base][m]alphamerge[cut];` +
              `color=c=${bg}:d=1[bgc];[bgc][ref]scale2ref[bg][ref2];[ref2]nullsink;` +
              `[bg][cut]overlay=0:0:format=auto,format=yuv420p[out]`;

        const dest = resolveOutPath(ctx, String(input.out ?? 'masked.mp4'));
        const duration = num(input.duration, 0);

        const args = ['-y', '-i', src, '-filter_complex', filter, '-map', '[out]'];
        if (duration > 0) args.push('-t', String(duration));
        if (transparent) {
            args.push('-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30');
        } else {
            args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p');
        }
        args.push(dest);

        await ffmpeg(args);

        return {
            outputs: [
                {
                    path: dest,
                    kind: 'video',
                    meta: { shape, feather, invert, transparent, animated, duration: duration || 'source' },
                },
            ],
            notes: [
                animated
                    ? 'Keyframed mask — this is shape masking, not tracking. A moving subject needs the keyframes set by hand.'
                    : 'Static mask.',
            ],
        };
    },
});
