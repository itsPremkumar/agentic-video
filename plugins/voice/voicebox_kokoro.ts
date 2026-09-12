import * as fs from 'node:fs';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { S } from '../_shared/common.ts';
import { vbConfig, vbJson, vbFetch, VB_LANGUAGES, VB_DEFAULT_BASE } from './voicebox/_voicebox.ts';

/**
 * voice.voicebox_kokoro — speak via Voicebox Kokoro engine.
 *
 * Zero-config default narrator. No voice cloning. ~0.8 GB VRAM.
 * Fastest Voicebox engine for plain narration.
 */
export default definePlugin({
    id: 'voice.voicebox_kokoro',
    name: 'Voicebox Kokoro (narrator)',
    category: 'voice',
    description: 'Generate speech via Voicebox Kokoro engine. Zero-config narrator, ~0.8 GB VRAM, no cloning.',
    inputs: {
        text: S.string('Text to speak', { required: true }),
        profile: S.string('Voice profile name or id', { required: true }),
        language: S.string('Language code', { default: 'en', enum: VB_LANGUAGES as unknown as string[] }),
        personality: S.bool('Rewrite text in-character', { default: false }),
        instruct: S.string('Style/emotion instruction'),
        seed: S.int('Random seed', { minimum: 0 }),
        baseUrl: S.string('Voicebox base URL', { default: VB_DEFAULT_BASE }),
        out: S.string('Output file', { default: 'kokoro-speech.wav' }),
    },
    outputs: ['audio'],
    async run({ input, ctx }) {
        const text = String(input.text ?? '').trim();
        const profile = String(input.profile ?? '').trim();
        if (!text) throw new PluginFailure({ code: 'INVALID_INPUT', message: 'text is required.', retryable: true });
        if (!profile) throw new PluginFailure({ code: 'INVALID_INPUT', message: 'profile is required.', retryable: true });

        const cfg = vbConfig(input as Record<string, unknown>);
        const body: Record<string, unknown> = { text, profile, engine: 'kokoro' };
        if (input.language) body.language = String(input.language);
        if (input.personality !== undefined) body.personality = Boolean(input.personality);
        if (input.instruct) body.instruct = String(input.instruct);
        if (input.seed !== undefined) body.seed = Number(input.seed);

        const submitted = await vbJson<{ id?: string; status?: string; error?: string }>(cfg, '/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const generationId = submitted.id;
        if (!generationId) {
            throw new PluginFailure({ code: 'VOICEBOX_NO_GENERATION_ID', message: 'Voicebox returned no generation id.', reason: JSON.stringify(submitted).slice(0, 400), retryable: true });
        }

        const started = Date.now();
        let status = String(submitted.status ?? 'generating');
        let final: Record<string, unknown> = submitted as Record<string, unknown>;
        while (status === 'generating' || status === 'pending' || status === 'queued') {
            if (Date.now() - started > 300000) {
                throw new PluginFailure({ code: 'VOICEBOX_GENERATION_TIMEOUT', message: 'Voicebox timed out after 5 minutes.', input: { generationId }, retryable: true });
            }
            await new Promise((r) => setTimeout(r, 1500));
            final = await vbJson<Record<string, unknown>>(cfg, '/generate/' + encodeURIComponent(generationId) + '/status');
            status = String(final.status ?? '');
        }
        if (status === 'failed' || final.error) {
            throw new PluginFailure({ code: 'VOICEBOX_GENERATION_FAILED', message: 'Voicebox failed.', reason: String(final.error ?? status), input: { generationId, profile }, retryable: true });
        }

        const res = await vbFetch(cfg, '/audio/' + encodeURIComponent(generationId));
        if (!res.ok) {
            const t = await res.text();
            throw new PluginFailure({ code: 'VOICEBOX_AUDIO_FETCH_FAILED', message: 'Could not download audio.', reason: t.slice(0, 400), input: { generationId }, retryable: true });
        }
        const dest = ctx.out(String(input.out ?? 'kokoro-speech.wav'));
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(dest, buf);

        return { outputs: [{ path: dest, kind: 'audio' as const, meta: { engine: 'kokoro', profile, generationId, bytes: buf.length } }] };
    },
});
