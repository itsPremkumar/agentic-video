import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { captureFrames } from '../../core/browser.ts';
import { ffmpeg, durationOf } from '../../core/media.ts';
import { S, requireFile } from '../_shared/common.ts';

/**
 * motion.canvas — render an HTML5 Canvas ANIMATION to MP4/WebM.
 *
 * Caller supplies a drawing function that takes (ctx, t, frame, total, W, H)
 * and draws one frame. This plugin renders each frame deterministically by
 * calling that function once per frame and capturing the canvas, so the
 * output is identical regardless of machine speed.
 *
 * This is the HTML5 Canvas path for motion graphics and animation. For full
 * React/TSX motion graphics with transitions, kinetic text, captions and
 * path morphing, see motion.remotion.
 */
export default definePlugin({
    id: 'motion.canvas',
    name: 'Render Canvas animation to video',
    category: 'render',
    description:
        'Render an HTML5 Canvas animation to MP4/WebM by sampling one frame at a time. Supports optional audio, alpha (webm), and custom frame functions.',
    inputs: {
        draw: S.string(
            'Drawing function: a function expression (ctx,t,frame,total,W,H)=>{} or a function body. Runs once per frame.',
            { required: true },
        ),
        duration: S.number('Animation length in seconds', { default: 5, minimum: 0.1, maximum: 60 }),
        fps: S.int('Frames per second', { default: 30, minimum: 1, maximum: 60 }),
        width: S.int('Canvas width', { default: 1080, minimum: 1 }),
        height: S.int('Canvas height', { default: 1920, minimum: 1 }),
        background: S.string('CSS background before draw() runs', { default: '#000000' }),
        transparent: S.bool('Keep alpha (output is WebM/VP9)', { default: false }),
        audio: S.string('Optional audio file path to mux with the animation'),
        out: S.string('Output file name (.mp4 or .webm)', { default: 'animation.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = String(input.draw ?? '').trim();
        if (!src) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'draw is required — supply a per-frame drawing function.',
                retryable: true,
            });
        }

        const width = Number(input.width ?? 1080);
        const height = Number(input.height ?? 1920);
        const fps = Math.max(1, Math.min(60, Math.round(Number(input.fps ?? 30))));
        const duration = Math.max(0.1, Number(input.duration ?? 5));
        const transparent = input.transparent === true;
        const totalFrames = Math.max(1, Math.round(duration * fps));

        const isExpr = /^\s*(function\b|async\b|\(|[A-Za-z_$][\w$]*\s*=>)/.test(src);
        const expression = isExpr ? `(${src})` : `new Function('ctx','t','frame','total','W','H', ${JSON.stringify(src)})`;
        const bg = transparent ? 'transparent' : String(input.background ?? '#000000');

        const page = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:${bg};overflow:hidden;}
canvas{display:block;}
</style></head><body><canvas id="c" width="${width}" height="${height}"></canvas><script>
const cv=document.getElementById('c');
const ctx=cv.getContext('2d');
const W=${width}, H=${height};
const draw=${expression};
let __err='';
try { window.__vfSeek=function(frame,total){
  const t = total>1 ? frame/(total-1) : 0;
  ctx.save();
  ctx.clearRect(0,0,W,H);
  try { draw(ctx,t,frame,total,W,H); }
  catch(e){ __err='__DRAW_ERROR__'+e.message; ctx.restore(); throw e; }
  ctx.restore();
}; } catch(e) { document.title='__INIT_ERROR__'+e.message; }
</script></body></html>`;

        const framesDir = path.join(ctx.workspaceDir, `_motion_canvas_${Date.now()}`);
        fs.mkdirSync(framesDir, { recursive: true });

        const dest = ctx.out(String(input.out ?? 'animation.mp4'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });

        // Render frames.
        try {
            await captureFrames({
                dir: framesDir,
                pageHtml: page,
                totalFrames,
                width,
                height,
                transparent,
                baseDir: ctx.workspaceDir,
                onFrame: (i, total) => {
                    if (i % 30 === 0 || i === total - 1) {
                        process.stdout.write(`\r[motion.canvas] frame ${i + 1}/${total}`);
                    }
                },
            });
        } catch (e) {
            try {
                fs.rmSync(framesDir, { recursive: true, force: true });
            } catch {
                /* ignore */
            }
            throw e;
        }
        process.stdout.write('\n');

        // Encode to mp4 (or webm with alpha).
        const wantWebm = transparent || dest.toLowerCase().endsWith('.webm');
        const files = fs
            .readdirSync(framesDir)
            .filter((f) => f.endsWith('.png'))
            .sort();

        const args = ['-y', '-framerate', String(fps), '-i', path.join(framesDir, 'f%06d.png')];
        if (wantWebm) {
            args.push('-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-crf', '24', '-b:v', '0');
        } else {
            args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p');
        }
        if (input.audio) {
            const a = requireFile(String(input.audio), 'audio');
            args.push('-i', a, '-c:a', 'aac', '-shortest');
        }
        args.push(dest);
        await ffmpeg(args);

        try {
            fs.rmSync(framesDir, { recursive: true, force: true });
        } catch {
            /* ignore */
        }

        const meta: Record<string, unknown> = { frames: totalFrames, fps, width, height, engine: 'chromium-canvas', transparent };
        if (input.audio) meta.durationAudio = await durationOf(String(input.audio));

        return { outputs: [{ path: dest, kind: 'video', meta }] };
    },
});