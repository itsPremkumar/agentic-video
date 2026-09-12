import * as fs from 'node:fs';
import { definePlugin, PluginFailure } from '../../../core/define.ts';
import { S } from '../../_shared/common.ts';
import { vbConfig, vbJson, vbFetch, VB_ENGINES, VB_LANGUAGES, VB_DEFAULT_BASE } from './_voicebox.ts';

/**
 * voice.voicebox_speak - speak text through a Voicebox voice profile.
 *
 * Works with cloned voices (from voice.voicebox_clone), preset voices
 * (kokoro af_heart, ...) and designed voices. Submits to POST /speak,
 * polls GET /generate/{id}/status until it completes, then downloads the
 * audio from GET /audio/{id}.
 *
 * Deterministic and explicit: if generation fails, you get the upstream
 * error verbatim. No fallback to another TTS engine.
 */
export default definePlugin({
    id: 'voice.voicebox_speak',
    name: 'Speak with a Voicebox voice',
    category: 'voice',
    description:
        'Generate speech through a Voicebox voice profile (cloned / preset / designed) and save the audio file.',
    inputs: {
        text: S.string('Text to speak', { required: true }),
        profile: S.string('Voice profile name or id (from voice.voicebox_clone / voice.voicebox_profiles)', { required: true }),
        engine: S.string('TTS engine override', { enum: VB_ENGINES as unknown as string[] }),
        language: S.string('Language code', { default: 'en', enum: VB_LANGUAGES as unknown as string[] }),
        personality: S.bool('Rewrite the text in-character before TTS (needs a profile personality)', { default: false }),
        instruct: S.string('Optional style/emotion instruction for the engine'),
        modelSize: S.string('Qwen model size', { default: '1.7B', enum: ['1.7B', '0.6B', '1B', '3B'] }),
        seed: S.int('Random seed for reproducible output', { minimum: 0 }),
        maxChunkChars: S.int('Max characters per chunk for long text', { default: 800, minimum: 100, maximum: 5000 }),
        crossfadeMs: S.int('Crossfade between chunks in ms', { default: 50, minimum: 0, maximum: 500 }),
        normalize: S.bool('Normalize output loudness', { default: true }),
        pollIntervalMs: S.int('Status poll interval in ms', { default: 1500, minimum: 200 }),
        pollTimeoutMs: S.int('Give up polling after this many ms', { default: 300000, minimum: 1000 }),
        baseUrl: S.string('Voicebox base URL', { default: VB_DEFAULT_BASE }),
        out: S.string('Output audio file name (.wav or .mp3)', { default: 'voicebox-speech.wav' }),
    },
    outputs: ['audio'],
    async run({ input, ctx }) {
        const text = String(input.text ?? '').trim();
        const profile = String(input.profile ?? '').trim();
        if (!text) throw new PluginFailure({ code: 'INVALID_INPUT', message: 'text is required.', retryable: true });
        if (!profile) throw new PluginFailure({ code: 'INVALID_INPUT', message: 'profile is required - pass a profile name or id.', retryable: true });

        const cfg = vbConfig(input as Record<string, unknown>);

        // 1. Submit. POST /speak accepts a profile NAME; POST /generate needs
        //    a profile_id. Prefer /speak so callers can pass either.
        const body: Record<string, unknown> = { text: text, profile: profile };
        if (input.engine) body.engine = String(input.engine);
        if (input.language) body.language = String(input.language);
        if (input.personality !== undefined) body.personality = Boolean(input.personality);

        const submitted = await vbJson<{ id?: string; status?: string; error?: string }>(cfg, '/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const generationId = submitted.id;
        if (!generationId) {
            throw new PluginFailure({
                code: 'VOICEBOX_NO_GENERATION_ID',
                message: 'Voicebox accepted the request but returned no generation id.',
                reason: JSON.stringify(submitted).slice(0, 400),
                retryable: true,
            });
        }

        // 2. Poll until completed / failed.
        const started = Date.now();
        let status = String(submitted.status ?? 'generating');
        let final: Record<string, unknown> = submitted as Record<string, unknown>;
        while (status === 'generating' || status === 'pending' || status === 'queued') {
            if (Date.now() - started > Number(input.pollTimeoutMs ?? 300000)) {
                throw new PluginFailure({
                    code: 'VOICEBOX_GENERATION_TIMEOUT',
                    message: 'Voicebox is still generating after ' + Number(input.pollTimeoutMs ?? 300000) + 'ms.',
                    input: { generationId: generationId },
                    retryable: true,
                });
            }
            await new Promise((r) => setTimeout(r, Number(input.pollIntervalMs ?? 1500)));
            final = await vbJson<Record<string, unknown>>(cfg, '/generate/' + encodeURIComponent(generationId) + '/status');
            status = String(final.status ?? '');
        }
        if (status === 'failed' || final.error) {
            throw new PluginFailure({
                code: 'VOICEBOX_GENERATION_FAILED',
                message: 'Voicebox failed to generate this speech.',
                reason: String(final.error ?? 'status=' + status),
                input: { generationId: generationId, profile: profile },
                retryable: true,
                hint: 'Check that the profile has at least one sample, and that the chosen engine supports this language.',
            });
        }

        // 3. Download the audio.
        const res = await vbFetch(cfg, '/audio/' + encodeURIComponent(generationId));
        if (!res.ok) {
            const t = await res.text();
            throw new PluginFailure({
                code: 'VOICEBOX_AUDIO_FETCH_FAILED',
                message: 'Could not download the generated audio (HTTP ' + res.status + ').',
                reason: t.slice(0, 400),
                input: { generationId: generationId },
                retryable: true,
            });
        }
        const dest = ctx.out(String(input.out ?? 'voicebox-speech.wav'));
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(dest, buf);

        return {
            outputs: [
                {
                    path: dest,
                    kind: 'audio',
                    meta: {
                        engine: input.engine ?? 'profile-default',
                        profile: profile,
                        generationId: generationId,
                        durationSeconds: final.duration ?? null,
                        bytes: buf.length,
                    },
                },
            ],
        };
    },
});
