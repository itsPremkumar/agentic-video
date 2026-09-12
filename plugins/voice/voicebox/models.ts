import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../../core/define.ts';
import { S } from '../../_shared/common.ts';
import { vbConfig, vbJson, VB_ENGINES, VB_DEFAULT_BASE } from './_voicebox.ts';

/**
 * voice.voicebox_models - inspect and control the TTS engines/models.
 *
 * Voicebox loads an engine lazily on first use and then keeps it warm in VRAM.
 * On a small GPU you often need to explicitly unload before switching engines,
 * which is what this plugin exposes.
 */
export default definePlugin({
    id: 'voice.voicebox_models',
    name: 'List / load / unload Voicebox engines',
    category: 'voice',
    description:
        'Inspect Voicebox engine status, preload a model, or unload one to free VRAM before switching engines.',
    inputs: {
        action: S.string('What to do', { default: 'status', enum: ['status', 'load', 'unload', 'cacheDir'] }),
        engine: S.string('Engine name (for unload)', { enum: VB_ENGINES as unknown as string[] }),
        modelSize: S.string('Model size to load (Qwen)', { default: '1.7B', enum: ['1.7B', '0.6B', '1B', '3B'] }),
        baseUrl: S.string('Voicebox base URL', { default: VB_DEFAULT_BASE }),
        out: S.string('Optional JSON file to write', { default: 'voicebox-models.json' }),
    },
    outputs: ['json'],
    async run({ input, ctx }) {
        const cfg = vbConfig(input as Record<string, unknown>);
        const action = String(input.action ?? 'status').toLowerCase();
        const result: Record<string, unknown> = { action };

        if (action === 'status') {
            result.status = await vbJson<unknown>(cfg, '/models/status');
        } else if (action === 'cacheDir') {
            result.cacheDir = await vbJson<unknown>(cfg, '/models/cache-dir');
        } else if (action === 'load') {
            const size = String(input.modelSize ?? '1.7B');
            result.load = await vbJson<unknown>(cfg, '/models/load?model_size=' + encodeURIComponent(size), {
                method: 'POST',
            });
            result.modelSize = size;
        } else if (action === 'unload') {
            const engine = String(input.engine ?? '').trim();
            if (engine) {
                result.unload = await vbJson<unknown>(cfg, '/models/' + encodeURIComponent(engine) + '/unload', {
                    method: 'POST',
                });
                result.engine = engine;
            } else {
                result.unload = await vbJson<unknown>(cfg, '/models/unload', { method: 'POST' });
                result.engine = 'default';
            }
        } else {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'action must be one of status | load | unload | cacheDir.',
                input: { action },
                retryable: true,
            });
        }

        const dest = ctx.out(String(input.out ?? 'voicebox-models.json'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, JSON.stringify(result, null, 2), 'utf8');

        return {
            outputs: [{ path: dest, kind: 'json' as const, meta: result }],
        };
    },
});
