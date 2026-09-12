import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { Browser } from '../../core/browser.ts';
import { ffmpeg } from '../../core/media.ts';
import { S } from '../_shared/common.ts';

/**
 * image.canvas — CREATE an image with the HTML5 Canvas 2D API.
 *
 * The caller supplies JavaScript that draws into a `<canvas>` (full Web2D
 * surface: paths, gradients, transforms, blend modes, text, images, shadows,
 * clipping). The plugin runs that code in a real browser and saves the canvas
 * to disk. This is the explicit HTML5 Canvas path for image creation.
 */
export default definePlugin({
    id: 'image.canvas',
    name: 'Create image with HTML5 Canvas',
    category: 'image',
    description: 'Draw into a real HTML5 canvas with caller-supplied JavaScript and save the result as an image.',
    inputs: {
        draw: S.string(
            'JavaScript drawing function: either a function expression (ctx,w,h)=>{} or a function body. Variables available: ctx, W, H.',
            { required: true },
        ),
        width: S.int('Canvas width', { default: 1080, minimum: 1 }),
        height: S.int('Canvas height', { default: 1920, minimum: 1 }),
        background: S.string('Fill colour before draw() runs, e.g. #0b1020 or transparent', { default: '#ffffff' }),
        transparent: S.bool('Use a transparent background (PNG only)', { default: false }),
        out: S.string('Output file name (.png or .jpg)', { default: 'canvas.png' }),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const src = String(input.draw ?? '').trim();
        if (!src) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'draw is required — supply a Canvas 2D drawing function.',
                retryable: true,
            });
        }

        const width = Number(input.width ?? 1080);
        const height = Number(input.height ?? 1920);
        const transparent = input.transparent === true;
        const bg = transparent ? 'transparent' : String(input.background ?? '#ffffff');

        // Accept either a function expression or a function body. Detect by shape.
        const isExpr = /^\s*(function\b|async\b|\(|[A-Za-z_$][\w$]*\s*=>)/.test(src);
        let expression: string;
        try {
            expression = isExpr ? `(${src})` : `new Function('ctx','W','H', ${JSON.stringify(src)})`;
        } catch (e) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'Could not parse the draw function.',
                reason: String(e),
                retryable: true,
            });
        }

        const page = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:${bg};}
canvas{display:block;}
</style></head><body><canvas id="c" width="${width}" height="${height}"></canvas><script>
const cv=document.getElementById('c');
const ctx=cv.getContext('2d');
const W=${width},H=${height};
const draw=${expression};
try { draw(ctx,W,H); }
catch(err){
  document.title='__ERROR__'+err.message;
  throw err;
}
</script></body></html>`;

        const dest = ctx.out(String(input.out ?? 'canvas.png'));
        const tmpPng = dest.toLowerCase().endsWith('.png') ? dest : dest.replace(/\.(jpe?g)$/i, '.png');
        fs.mkdirSync(path.dirname(tmpPng), { recursive: true });

        const browser = await Browser.launch({ width, height, transparent });
        try {
            await browser.setContent(page, ctx.workspaceDir);
            const title = await browser.eval<string>('document.title');
            if (typeof title === 'string' && title.startsWith('__ERROR__')) {
                throw new PluginFailure({
                    code: 'CANVAS_DRAW_ERROR',
                    message: 'The draw function threw an error in the browser.',
                    reason: title.replace('__ERROR__', ''),
                    retryable: true,
                });
            }
            await browser.screenshot(tmpPng, transparent);
        } finally {
            await browser.close();
        }

        if (tmpPng !== dest) {
            await ffmpeg(['-y', '-i', tmpPng, '-q:v', '2', dest]);
            try {
                fs.unlinkSync(tmpPng);
            } catch {
                /* ignore */
            }
        }

        return { outputs: [{ path: dest, kind: 'image', meta: { width, height, engine: 'chromium-canvas' } }] };
    },
});