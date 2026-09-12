import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';

/**
 * motion.effect - camera-motion effects applied to a still image or a clip:
 *
 *   kenBurns   - slow zoom + optional pan (the classic photo-motion look)
 *   shake      - handheld camera shake
 *   parallax   - layered drift (simulated with zoom + crop offset)
 *   punchIn    - hold, then a fast snap-zoom to emphasise a moment
 *   punchOut   - normal, then zoom out
 */
export default definePlugin({
    id: 'motion.effect',
    name: 'Camera motion effects (Ken Burns, shake, parallax, punch)',
    category: 'render',
    description: 'Ken Burns zoom/pan, handheld shake, parallax drift, punch-in/out. Works on stills (with duration) or clips.',
    inputs: {
        file: S.string('Path to input (image or video)', { required: true }),
        effect: S.string('Effect', { enum: ['kenBurns', 'shake', 'parallax', 'punchIn', 'punchOut'], required: true }),
        duration: S.number('Output duration in seconds (needed for stills)', { default: 5 }),
        fps: S.int('Output fps', { default: 30, minimum: 1, maximum: 60 }),
        width: S.int('Output width', { default: 1080 }),
        height: S.int('Output height', { default: 1920 }),
        zoomFrom: S.number('Ken Burns start zoom (1.0 = fit)', { default: 1.0 }),
        zoomTo: S.number('Ken Burns end zoom', { default: 1.15 }),
        panX: S.number('Horizontal pan -1..1', { default: 0 }),
        panY: S.number('Vertical pan -1..1', { default: 0 }),
        shakeAmount: S.number('Shake amplitude in pixels', { default: 6 }),
        shakeFrequency: S.number('Shake frequency (Hz)', { default: 6 }),
        punchAt: S.number('Punch start time in seconds', { default: 1.5 }),
        punchZoom: S.number('Punch zoom level', { default: 1.4 }),
        out: S.string('Output file (.mp4)', { default: 'motion.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const file = requireFile(input.file, 'file');
        const effect = String(input.effect ?? '');
        const duration = Math.max(0.1, Number(input.duration ?? 5));
        const fps = Math.max(1, Math.min(60, Number(input.fps ?? 30)));
        const width = Number(input.width ?? 1080);
        const height = Number(input.height ?? 1920);
        const frames = Math.max(1, Math.round(duration * fps));
        const out = ctx.out(String(input.out ?? 'motion.mp4'));
        ensureParentDir(out);

        const zoomFrom = Math.max(0.1, Number(input.zoomFrom ?? 1.0));
        const zoomTo = Math.max(0.1, Number(input.zoomTo ?? 1.15));
        const panX = Number(input.panX ?? 0);
        const panY = Number(input.panY ?? 0);
        const shakeAmount = Math.max(0, Number(input.shakeAmount ?? 6));
        const shakeFreq = Math.max(0.1, Number(input.shakeFrequency ?? 6));
        const punchAt = Math.max(0, Number(input.punchAt ?? 1.5));
        const punchZoom = Math.max(1, Number(input.punchZoom ?? 1.4));

        let filter = '';
        switch (effect) {
            case 'kenBurns': {
                // zoompan animates z over `d` frames; x/y keep the frame centred
                // unless a pan is requested.
                const zExpr = "min(zoom+" + String(((zoomTo - zoomFrom) / frames).toFixed(6)) + ",5)";
                const xExpr = panX === 0 ? 'iw/2-(iw/zoom/2)' : ('iw/2-(iw/zoom/2)+(' + panX.toFixed(3) + '*on/2)');
                const yExpr = panY === 0 ? 'ih/2-(ih/zoom/2)' : ('ih/2-(ih/zoom/2)+(' + panY.toFixed(3) + '*on/2)');
                filter =
                    'scale=' + String(width * 2) + ':' + String(height * 2) +
                    ',zoompan=z=' + String(zoomFrom) +
                    ":d=" + String(frames) +
                    ":x='" + xExpr + "'" +
                    ":y='" + yExpr + "'" +
                    ":s=" + String(width) + 'x' + String(height) +
                    ",fps=" + String(fps) +
                    ",trim=duration=" + String(duration);
                void zExpr;
                break;
            }
            case 'shake': {
                // crop's x/y DO accept time-varying expressions; pad with constant
                // margin so the offset doesn't reveal black edges.
                const ax = shakeAmount.toFixed(2);
                const ay = (shakeAmount * 0.7).toFixed(2);
                const fx = shakeFreq.toFixed(3);
                const fy = (shakeFreq * 0.77).toFixed(3);
                const m = Math.ceil(shakeAmount * 2 + 4);
                filter =
                    'crop=iw-' + String(m) + ':ih-' + String(m) +
                    ":x='" + ax + "*sin(2*PI*" + fx + "*t)'" +
                    ":y='" + ay + "*cos(2*PI*" + fy + "*t)'" +
                    ",pad=iw:" + String(m * 2 + (1920 - m * 2)) + ":0:0" + '?x=4:y=4';
                // simpler: don't pad, just let it stay inside the cropped region
                filter =
                    'crop=iw-' + String(m) + ':ih-' + String(m) +
                    ":x='" + ax + "*sin(2*PI*" + fx + "*t)'" +
                    ":y='" + ay + "*cos(2*PI*" + fy + "*t)'" +
                    ',pad=iw:ih:' + String(Math.ceil(m / 2)) + ':' + String(Math.ceil(m / 2)) +
                    ':color=black';
                break;
            }
            case 'parallax': {
                // Slow vertical drift + slight zoom, evoking a layered scene.
                filter =
                    'scale=' + String(width * 2) + ':' + String(height * 2) +
                    ',zoompan=z=1.08:d=' + String(frames) +
                    ":y='ih/2-(ih/zoom/2)+(on*0.4)'" +
                    ":x='iw/2-(iw/zoom/2)'" +
                    ':s=' + String(width) + 'x' + String(height) +
                    ',fps=' + String(fps) +
                    ',trim=duration=' + String(duration);
                break;
            }
            case 'punchIn':
            case 'punchOut': {
                const isIn = effect === 'punchIn';
                const hold = isIn ? punchAt : 0;
                const zoomExpr = isIn
                    ? "if(lte(on," + String(Math.round(punchAt * fps)) + "),1,min(1+((on-" + String(Math.round(punchAt * fps)) + ")/" + String(frames) + ")*" + String(punchZoom - 1) + "," + String(punchZoom) + "))"
                    : "min(1+((on)/" + String(frames) + ")*" + String(punchZoom - 1) + "," + String(punchZoom) + ")";
                filter =
                    'scale=' + String(width * 2) + ':' + String(height * 2) +
                    ',zoompan=z=' + String(zoomFrom) +
                    ":d=" + String(frames) +
                    ":z='" + zoomExpr + "'" +
                    ":x='iw/2-(iw/zoom/2)'" +
                    ":y='ih/2-(ih/zoom/2)'" +
                    ':s=' + String(width) + 'x' + String(height) +
                    ',fps=' + String(fps) +
                    ',trim=duration=' + String(duration);
                void hold;
                break;
            }
            default:
                throw new (await import('../../core/define.ts')).PluginFailure({
                    code: 'INVALID_INPUT',
                    message: 'Unknown effect "' + effect + '".',
                    input: { effect },
                    retryable: true,
                });
        }

        // Stills need -loop + -t; videos already have their own timeline.
        const isImage = /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(file);
        const args = ['-y'];
        if (isImage) args.push('-loop', '1', '-t', String(duration), '-i', file);
        else args.push('-i', file);
        args.push('-vf', filter, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-t', String(duration), out);

        await ffmpeg(args);
        return { outputs: [{ path: out, kind: 'video' as const, meta: { effect, duration, fps, width, height } }] };
    },
});