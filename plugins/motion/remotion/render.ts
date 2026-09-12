import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveOutPath } from '../../_shared/common.ts';
import { definePlugin, PluginFailure } from '../../../core/define.ts';
import { findChrome } from '../../../core/browser.ts';
import { S } from '../../_shared/common.ts';

/**
 * motion.remotion - render ANY motion graphics composition the caller authors
 * in React + Remotion. This is the full Remotion capacity exposed as a single
 * plugin: the caller supplies a TSX file with a default-exported component
 * (useFrame, useCurrentFrame, useVideoConfig, spring, interpolate, transitions,
 * shapes, paths, etc.) and this plugin bundles and renders it to MP4.
 *
 * Dynamic Remotion: every call can author a different composition.
 */
export default definePlugin({
    id: 'motion.remotion',
    name: 'Render a Remotion composition',
    category: 'render',
    description:
        'Bundle and render a caller-authored Remotion (React) composition. The composition code can use the full Remotion API: useFrame, spring, interpolate, transitions, shapes, paths, captions, kinetic text, etc.',
    inputs: {
        composition: S.string(
            'TSX source code for the composition. Must have a default-exported React component.',
            { required: true },
        ),
        compositionId: S.string('Composition id (a-z, A-Z, 0-9, -, _)', { default: 'Dynamic' }),
        durationInFrames: S.int('Length in frames', { default: 150, minimum: 1 }),
        fps: S.int('Frames per second', { default: 30, minimum: 1, maximum: 60 }),
        width: S.int('Output width', { default: 1080, minimum: 1 }),
        height: S.int('Output height', { default: 1920, minimum: 1 }),
        props: S.object('Default props passed to the composition (JSON object)'),
        out: S.string('Output file name (.mp4)', { default: 'remotion.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = String(input.composition ?? '').trim();
        if (!src) {
            throw new PluginFailure({ code: 'INVALID_INPUT', message: 'composition is required - supply TSX source.', retryable: true });
        }
        const compId = String(input.compositionId ?? 'Dynamic');
        // Remotion itself only accepts a-z, A-Z, 0-9, CJK and "-" — no underscore.
        if (!/^[A-Za-z0-9㐀-鿿-]+$/.test(compId)) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'compositionId may only contain a-z, A-Z, 0-9, CJK characters and "-". Underscores are not allowed.',
                input: { compositionId: compId },
                retryable: true,
                hint: 'Use hyphens instead of underscores, e.g. "Tpl-lower-third".',
            });
        }
        const fps = Number(input.fps ?? 30);
        const dur = Number(input.durationInFrames ?? 150);
        const width = Number(input.width ?? 1080);
        const height = Number(input.height ?? 1920);
        const defaultProps = (input.props && typeof input.props === 'object' ? input.props : {}) as Record<string, unknown>;

        const chromePath = findChrome();
        if (!chromePath) {
            throw new PluginFailure({
                code: 'CHROME_NOT_FOUND',
                message: 'Remotion needs Chromium to render. None found.',
                retryable: false,
                hint: 'Install Google Chrome, or set AGENTIC_VIDEO_CHROME to your browser executable path.',
            });
        }

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-remotion-'));
        try {
            fs.writeFileSync(
                path.join(dir, 'package.json'),
                JSON.stringify({ name: 'vf-remotion-tmp', version: '0.0.0', private: true, type: 'module' }),
            );
            fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
            fs.writeFileSync(path.join(dir, 'src', 'Composition.tsx'), src.replace(/\r\n/g, '\n'));
            const root =
                "import { Composition } from 'remotion';\nimport Composition_ from './Composition';\n\nexport const RemotionRoot = () => {\n    return (\n        <Composition\n            id=\"" + compId + "\"\n            component={Composition_}\n            durationInFrames={" + dur + "}\n            fps={" + fps + "}\n            width={" + width + "}\n            height={" + height + "}\n            defaultProps={" + JSON.stringify(defaultProps) + "}\n        />\n    );\n};\n";
            fs.writeFileSync(path.join(dir, 'src', 'Root.tsx'), root);
            fs.writeFileSync(path.join(dir, 'src', 'index.ts'), "import { registerRoot } from 'remotion';\nimport { RemotionRoot } from './Root';\nregisterRoot(RemotionRoot);\n");

            let bundle: typeof import('@remotion/bundler').bundle;
            let renderMedia: typeof import('@remotion/renderer').renderMedia;
            let selectComposition: typeof import('@remotion/renderer').selectComposition;
            try {
                ({ bundle } = await import('@remotion/bundler'));
                ({ renderMedia, selectComposition } = await import('@remotion/renderer'));
            } catch (e) {
                throw new PluginFailure({
                    code: 'REMOTION_NOT_INSTALLED',
                    message: 'Remotion packages are not installed in Agentic Video.',
                    reason: String(e),
                    retryable: false,
                    hint: 'Run: npm install remotion @remotion/bundler @remotion/renderer',
                });
            }

            const entryPoint = path.join(dir, 'src', 'index.ts');
            const dest = resolveOutPath(ctx, String(input.out ?? 'remotion.mp4'));
            fs.mkdirSync(path.dirname(dest), { recursive: true });

            const serveUrl = await bundle({ entryPoint, publicDir: path.join(dir, 'public') });

            const composition = await selectComposition({
                serveUrl,
                id: compId,
                inputProps: defaultProps,
                browserExecutable: chromePath,
            });
            await renderMedia({
                composition,
                serveUrl,
                outputLocation: dest,
                codec: 'h264',
                crf: 20,
                browserExecutable: chromePath,
            });

            return { outputs: [{ path: dest, kind: 'video', meta: { engine: 'remotion', compositionId: compId, durationInFrames: dur, fps, width, height } }] };
        } finally {
            try {
                fs.rmSync(dir, { recursive: true, force: true });
            } catch {
                /* ignore */
            }
        }
    },
});
