import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';

/**
 * effects.color_grade - film-look colour treatments that go beyond simple eq:
 *
 *   filmGrain  - animated grain (noise filter) with controllable strength
 *   halation   - blooming highlights (blur the bright pass and screen it back)
 *   lut        - apply a .cube / .3dl LUT file
 *   wheels     - lift / gamma / gain colour wheels (shadows / mids / highlights)
 *   bleach     - bleach bypass (partially desaturated, high contrast)
 *
 * All deterministic ffmpeg; no model.
 */
export default definePlugin({
    id: 'effects.color_grade',
    name: 'Film-look colour treatments (grain / halation / LUT / wheels / bleach)',
    category: 'effects',
    description: 'Advanced colour: animated film grain, halation bloom, .cube LUT, lift/gamma/gain wheels, bleach bypass.',
    inputs: {
        file: S.string('Path to input video', { required: true }),
        treatment: S.string('Treatment', { enum: ['filmGrain', 'halation', 'lut', 'wheels', 'bleach'], required: true }),
        strength: S.number('Effect strength 0.0 - 1.0', { default: 0.5, minimum: 0, maximum: 1 }),
        lutFile: S.string('Path to .cube LUT (required for lut treatment)'),
        lift: S.number('Shadows lift -1..1 (wheels)', { default: 0 }),
        gamma: S.number('Midtones gamma -1..1 (wheels)', { default: 0 }),
        gain: S.number('Highlights gain -1..1 (wheels)', { default: 0 }),
        out: S.string('Output file (.mp4)', { default: 'color-graded.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const file = requireFile(input.file, 'file');
        const treatment = String(input.treatment ?? '');
        const strength = Math.max(0, Math.min(1, Number(input.strength ?? 0.5)));
        const out = ctx.out(String(input.out ?? 'color-graded.mp4'));
        ensureParentDir(out);

        let filter = '';
        let complex = false;

        switch (treatment) {
            case 'filmGrain': {
                // alls = luma+chroma sigma (0..~100), allf=t => temporal (animated)
                const sigma = Math.round(strength * 20);
                filter = 'noise=alls=' + String(sigma) + ':allf=t+u';
                break;
            }
            case 'halation': {
                // Extract bright areas, blur them, screen back over the original.
                const blur = (4 + Math.round(strength * 20)).toString();
                const opacity = strength.toFixed(3);
                filter =
                    'split=2[a][b];' +
                    '[b]extractplanes=y,geq=lum=\'if(gt(lum(X,Y),200),lum(X,Y),0)\',gblur=sigma=' + blur + '[glow];' +
                    '[a][glow]blend=all_mode=screen:all_opacity=' + opacity + '[out]';
                complex = true;
                break;
            }
            case 'lut': {
                const lutPath = typeof input.lutFile === 'string' ? input.lutFile : '';
                if (!lutPath) {
                    throw new (await import('../../core/define.ts')).PluginFailure({
                        code: 'INVALID_INPUT',
                        message: 'lut treatment requires lutFile (path to a .cube/.3dl LUT).',
                        input: { treatment, lutFile: input.lutFile },
                        retryable: true,
                    });
                }
                const { default: fs } = await import('node:fs');
                const { default: path } = await import('node:path');
                const abs = path.resolve(lutPath);
                if (!fs.existsSync(abs)) {
                    throw new (await import('../../core/define.ts')).PluginFailure({
                        code: 'FILE_NOT_FOUND',
                        message: 'LUT file not found: ' + lutPath,
                        input: { lutFile: lutPath },
                        retryable: true,
                    });
                }
                // lut3d needs a colon-free path; quote it.
                filter = 'lut3d=file=' + JSON.stringify(abs).slice(1, -1);
                break;
            }
            case 'wheels': {
                const lift = Number(input.lift ?? 0);
                const gamma = Number(input.gamma ?? 0);
                const gain = Number(input.gain ?? 0);
                // colorlevels maps to lift/gamma/gain on each channel.
                const r = [lift, gamma, gain].map((v) => clamp01(0.5 + v / 2));
                filter =
                    'colorlevels=rimin=' + r[0].toFixed(3) + ':gimin=' + r[0].toFixed(3) + ':bimin=' + r[0].toFixed(3) +
                    ':rimax=' + r[2].toFixed(3) + ':gimax=' + r[2].toFixed(3) + ':bimax=' + r[2].toFixed(3) +
                    ',eq=gamma=' + (1 + gamma).toFixed(3);
                break;
            }
            case 'bleach': {
                // Bleach bypass: desaturate then blend with a high-contrast copy.
                const opacity = (0.3 + strength * 0.6).toFixed(3);
                filter =
                    'split=2[a][b];' +
                    '[a]hue=s=0,eq=contrast=1.4[bw];' +
                    '[b][bw]blend=all_mode=overlay:all_opacity=' + opacity + '[out]';
                complex = true;
                break;
            }
            default:
                throw new (await import('../../core/define.ts')).PluginFailure({
                    code: 'INVALID_INPUT',
                    message: 'Unknown treatment "' + treatment + '".',
                    input: { treatment },
                    retryable: true,
                });
        }

        const args = ['-y', '-i', file];
        if (complex) args.push('-filter_complex', filter, '-map', '[out]');
        else args.push('-vf', filter);
        args.push('-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'copy', out);

        await ffmpeg(args);
        return { outputs: [{ path: out, kind: 'video' as const, meta: { treatment, strength, filter } }] };
    },
});

function clamp01(n: number): number {
    return Math.max(0, Math.min(1, n));
}