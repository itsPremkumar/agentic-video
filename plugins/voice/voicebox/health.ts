import * as fs from 'node:fs';
import { definePlugin } from '../../../core/define.ts';
import { S } from '../../_shared/common.ts';
import { vbConfig, vbJson, VB_DEFAULT_BASE } from './_voicebox.ts';

/**
 * voice.voicebox_health - confirm the local Voicebox server is up before
 * you build a chain around it. Call this first; every other voice.voicebox_*
 * plugin needs the server.
 */
export default definePlugin({
    id: 'voice.voicebox_health',
    name: 'Check Voicebox server',
    category: 'voice',
    description: 'Ping the local Voicebox TTS server (default http://localhost:17493) and report its health.',
    inputs: {
        baseUrl: S.string('Voicebox base URL', { default: VB_DEFAULT_BASE }),
        timeoutMs: S.int('Request timeout in ms', { default: 15000, minimum: 1000 }),
        out: S.string('Output JSON file name', { default: 'voicebox-health.json' }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        const cfg = vbConfig(input as Record<string, unknown>);
        const health = await vbJson<Record<string, unknown>>(cfg, '/health');
        const dest = ctx.out(String(input.out ?? 'voicebox-health.json'));
        fs.mkdirSync(dest.substring(0, dest.lastIndexOf('\\') > 0 ? dest.lastIndexOf('\\') : dest.lastIndexOf('/')), { recursive: true });
        const payload = { baseUrl: cfg.baseUrl, reachable: true, health: health };
        fs.writeFileSync(dest, JSON.stringify(payload, null, 2), 'utf8');
        return { outputs: [{ path: dest, kind: 'data', meta: payload }] };
    },
});
