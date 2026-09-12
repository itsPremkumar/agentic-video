import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg, probe, durationOf } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';

/**
 * fx.transition_effect - stylised transition "hits" applied to a clip:
 *
 *   glitch     - RGB displacement + block slice slides + noise burst
 *   lightLeak  - warm bloom sweeping across the frame
 *   whipPan    - motion-blurred whip (frame mixing)
 *   flash      - brief white/coloured flash (spike + decay)
 *   rgbSplit   - time-varying chromatic aberration
 *   zoomBlur   - radial zoom punch
 *
 * The effect is applied over a window (start .. start+duration).
 *
 * IMPLEMENTATION NOTE
 * -------------------
 * Several ffmpeg filters (`zoompan`, `minterpolate`) have no timeline support
 * (no `T` flag in `ffmpeg -filters`), so an `enable='between(t,..)'` option
 * fails with "Not yet implemented in FFmpeg, patches welcome". Also `rgbashift`
 * accepts only constant integers, not expressions.
 *
 * So instead of gating with `enable=`, this plugin SPLITS the clip into three
 * pieces (head / window / tail), filters only the middle piece, then concats.
 * Audio is copied untouched, so timing never drifts. As a bonus, `setpts` reset
 * makes `t` inside the window start at 0, so ramps are expressed naturally.
 */
export default definePlugin({
    id: 'fx.transition_effect',
    name: 'Stylised transition hit (glitch / light leak / whip pan / flash)',
    category: 'fx',
    description:
        'Time-windowed transition effects: glitch, lightLeak, whipPan, flash, rgbSplit, zoomBlur. Split-concat windowing means every filter works, even ones without timeline support.',
    inputs: {
        file: S.string('Path to input video', { required: true }),
        effect: S.string('Effect', {
            enum: ['glitch', 'lightLeak', 'whipPan', 'flash', 'rgbSplit', 'zoomBlur'],
            required: true,
        }),
        start: S.number('Effect start time in seconds', { default: 0 }),
        duration: S.number('Effect duration in seconds', { default: 0.4 }),
        intensity: S.number('Intensity 0.0 - 1.0', { default: 0.6, minimum: 0, maximum: 1 }),
        color: S.string('Colour for flash / lightLeak (hex)', { default: '#ffcc88' }),
        out: S.string('Output file (.mp4)', { default: 'transition-fx.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const file = requireFile(input.file, 'file');
        const effect = String(input.effect ?? '');
        const intensity = Math.max(0, Math.min(1, Number(input.intensity ?? 0.6)));
        const color = String(input.color ?? '#ffcc88');
        const out = ctx.out(String(input.out ?? 'transition-fx.mp4'));
        ensureParentDir(out);

        const total = await durationOf(file);
        if (!(total > 0)) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'Could not determine input video duration.',
                input: { file },
                retryable: false,
            });
        }

        let start = Math.max(0, Number(input.start ?? 0));
        let dur = Math.max(0.05, Number(input.duration ?? 0.4));
        if (start >= total) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message:
                    'Effect start (' + start.toFixed(3) + 's) is at or beyond the clip duration (' +
                    total.toFixed(3) + 's).',
                input: { start, duration: total },
                retryable: true,
            });
        }
        const end = Math.min(start + dur, total);
        dur = end - start;

        const info = await probe(file);
        const vs = (info.streams || []).find((s: any) => s.codec_type === 'video') || {};
        const W = Number(vs.width) || 1920;
        const H = Number(vs.height) || 1080;
        const rate = String(vs.r_frame_rate || '30/1');
        const [rn, rd] = rate.split('/').map((v) => Number(v));
        const fps = rd && rn ? rn / rd : 30;
        const winFrames = Math.max(1, Math.round(dur * fps));

        // Local progress 0..1 across the window (t restarts at 0 after setpts reset).
        const D = dur.toFixed(4);
        // Triangle ramp 0 -> 1 -> 0, for "hit then recover" effects.
        const tri = '(1-abs(2*t/' + D + '-1))';

        const A = Math.max(1, Math.round(intensity * 40)); // slice slide amplitude (px)
        const N = Math.max(1, Math.round(intensity * 30)); // noise strength
        const RS = Math.max(1, Math.round(intensity * 8)); // constant rgb shift (px)
        const bandY0 = 0;
        const bandY1 = Math.round(H / 3);
        const bandH = Math.max(1, Math.round(H / 3));

        let filter = '';
        switch (effect) {
            case 'glitch': {
                // Two horizontal bands slide in opposite directions + noise + rgb shift.
                filter =
                    'split=3[base][b1s][b2s];' +
                    '[b1s]crop=iw:' + bandH + ':0:' + bandY0 + '[bd1];' +
                    '[b2s]crop=iw:' + bandH + ':0:' + bandY1 + '[bd2];' +
                    '[base][bd1]overlay=x=' + A + '*sin(2*PI*9*t):y=' + bandY0 + '[o1];' +
                    '[o1][bd2]overlay=x=-' + A + '*sin(2*PI*7*t):y=' + bandY1 + '[o2];' +
                    '[o2]noise=alls=' + N + ':allf=t+u,rgbashift=rh=' + RS + ':bh=-' + RS;
                break;
            }
            case 'lightLeak': {
                const [rr, gg, bb] = hexToMultipliers(color);
                filter =
                    'colorchannelmixer=rr=' + rr.toFixed(3) + ':gg=' + gg.toFixed(3) + ':bb=' + bb.toFixed(3) + ',' +
                    'vignette=angle=PI/' + (6 - intensity * 3).toFixed(2) + ',' +
                    'eq=brightness=' + (intensity * 0.25).toFixed(3) + '*' + tri;
                break;
            }
            case 'whipPan': {
                // tmix averages N successive frames -> directional motion smear.
                const frames = Math.max(2, Math.min(12, Math.round(intensity * 10)));
                filter = 'tmix=frames=' + frames;
                break;
            }
            case 'flash': {
                const [rr, gg, bb] = hexToMultipliers(color);
                filter =
                    'eq=brightness=' + (intensity * 0.9).toFixed(3) + '*' + tri + ',' +
                    'colorchannelmixer=rr=' + rr.toFixed(3) + ':gg=' + gg.toFixed(3) + ':bb=' + bb.toFixed(3) + ',' +
                    'colorbalance=rs=' + (intensity * 0.2).toFixed(3) + ':gs=' + (intensity * 0.2).toFixed(3);
                break;
            }
            case 'rgbSplit': {
                // geq gives a genuinely time-varying chromatic aberration.
                // format=gbrp forces RGB planes so r()/g()/b() sampling is valid.
                const amp = Math.max(1, Math.round(intensity * 18));
                filter =
                    'format=gbrp,' +
                    "geq=r='r(X+" + amp + "*sin(2*PI*3*T),Y)':g='g(X,Y)':b='b(X-" + amp + "*sin(2*PI*3*T),Y)'," +
                    'format=yuv420p';
                break;
            }
            case 'zoomBlur': {
                // zoompan has no timeline support -> safe because we only feed it the window.
                // `on` is the output frame index (0..winFrames).
                const z = (intensity * 0.5).toFixed(4);
                filter =
                    "zoompan=z='min(1+" + z + "*on/" + winFrames + ",2)':d=1" +
                    ":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'" +
                    ':s=' + W + 'x' + H + ':fps=' + fps;
                break;
            }
            default:
                throw new PluginFailure({
                    code: 'INVALID_INPUT',
                    message:
                        'Unknown effect "' + effect +
                        '". Use one of glitch, lightLeak, whipPan, flash, rgbSplit, zoomBlur.',
                    input: { effect },
                    retryable: true,
                });
        }

        const hasAudio = (info.streams || []).some((s: any) => s.codec_type === 'audio');
        const args: string[] = ['-y', '-i', file];

        if (start <= 0.001 && end >= total - 0.001) {
            // Window covers the whole clip - no splitting needed.
            args.push('-vf', filter, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium');
            args.push(hasAudio ? '-c:a' : '-an', hasAudio ? 'aac' : '');
        } else {
            // head [0,start) | window [start,end) | tail [end,total)
            const fc =
                '[0:v]trim=start=0:end=' + start.toFixed(4) + ',setpts=PTS-STARTPTS[v0];' +
                '[0:v]trim=start=' + start.toFixed(4) + ':end=' + end.toFixed(4) + ',setpts=PTS-STARTPTS,' + filter + '[v1];' +
                '[0:v]trim=start=' + end.toFixed(4) + ',setpts=PTS-STARTPTS[v2];' +
                '[v0][v1][v2]concat=n=3:v=1:a=0[v]';
            args.push('-filter_complex', fc, '-map', '[v]');
            if (hasAudio) args.push('-map', '0:a', '-c:a', 'copy');
            else args.push('-an');
            args.push('-c:v', 'libx264', '-crf', '20', '-preset', 'medium');
        }
        args.push('-movflags', '+faststart', out);

        await ffmpeg(args);

        return {
            outputs: [
                {
                    path: out,
                    kind: 'video' as const,
                    meta: {
                        effect,
                        start,
                        duration: dur,
                        end,
                        intensity,
                        color,
                        filter,
                        windowed: !(start <= 0.001 && end >= total - 0.001),
                        size: W + 'x' + H,
                        fps,
                    },
                },
            ],
        };
    },
});

/** '#ffcc88' -> per-channel multipliers centred on 1.0 (neutral = 1,1,1). */
function hexToMultipliers(hex: string): [number, number, number] {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return [1, 1, 1];
    const n = parseInt(m[1], 16);
    const r = ((n >> 16) & 0xff) / 255;
    const g = ((n >> 8) & 0xff) / 255;
    const b = (n & 0xff) / 255;
    // Map 0..1 -> 0.7..1.3 so a mid grey is neutral rather than dark.
    return [0.7 + r * 0.6, 0.7 + g * 0.6, 0.7 + b * 0.6];
}
