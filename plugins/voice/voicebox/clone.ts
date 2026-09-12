import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../../core/define.ts';
import { S, requireFile } from '../../_shared/common.ts';
import { vbConfig, vbJson, VB_ENGINES, VB_LANGUAGES, VB_DEFAULT_BASE } from './_voicebox.ts';

/**
 * voice.voicebox_clone - CLONE a voice with Voicebox.
 *
 * Creates a Voicebox voice profile (voice_type=cloned) and uploads one or
 * more reference audio samples with their transcripts. The profile id it
 * returns is what you pass to voice.voicebox_speak to speak in that voice.
 *
 * Requires the local Voicebox server (jamiepine/voicebox, default
 * http://localhost:17493). Nothing is substituted if it is unreachable.
 */
export default definePlugin({
    id: 'voice.voicebox_clone',
    name: 'Clone a voice with Voicebox',
    category: 'voice',
    description:
        'Create a cloned Voicebox voice profile from reference audio + transcript. Returns a profile id you can speak through.',
    inputs: {
        name: S.string('Name for the cloned voice profile', { required: true }),
        refAudio: S.string('Reference audio file path (wav/mp3/m4a/ogg/flac/aac/webm/opus)', { required: true }),
        referenceText: S.string('Exact transcript of the reference audio', { required: true }),
        extraSamples: S.array('Optional extra reference clips (better fidelity)'),
        extraSampleTexts: S.array('Transcripts matching extraSamples, in the same order'),
        description: S.string('Optional profile description', { default: '' }),
        language: S.string('Language code', { default: 'en', enum: VB_LANGUAGES as unknown as string[] }),
        defaultEngine: S.string('TTS engine to use for this voice', { default: 'qwen', enum: VB_ENGINES as unknown as string[] }),
        baseUrl: S.string('Voicebox base URL', { default: VB_DEFAULT_BASE }),
        out: S.string('Output JSON file name', { default: 'voicebox-clone.json' }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        const name = String(input.name ?? '').trim();
        const referenceText = String(input.referenceText ?? '').trim();
        if (!name) throw new PluginFailure({ code: 'INVALID_INPUT', message: 'name is required.', retryable: true });
        if (!referenceText) throw new PluginFailure({ code: 'INVALID_INPUT', message: 'referenceText is required - Voicebox needs the exact transcript of the reference audio.', retryable: true });

        const cfg = vbConfig(input as Record<string, unknown>);

        // 1. Create the cloned profile.
        const body: Record<string, unknown> = {
            name: name,
            language: String(input.language ?? 'en'),
            voice_type: 'cloned',
        };
        if (input.description) body.description = String(input.description);
        if (input.defaultEngine) body.default_engine = String(input.defaultEngine);

        const profile = await vbJson<{ id?: string; name?: string }>(cfg, '/profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const profileId = profile.id;
        if (!profileId) {
            throw new PluginFailure({
                code: 'CLONE_PROFILE_FAILED',
                message: 'Voicebox created the profile but returned no id.',
                reason: JSON.stringify(profile).slice(0, 400),
                retryable: true,
            });
        }

        // 2. Upload the reference sample(s).
        const clips: { file: string; text: string }[] = [
            { file: requireFile(String(input.refAudio), 'refAudio'), text: referenceText },
        ];
        if (Array.isArray(input.extraSamples)) {
            const texts = Array.isArray(input.extraSampleTexts) ? (input.extraSampleTexts as string[]) : [];
            (input.extraSamples as unknown[]).forEach((s, i) => {
                clips.push({ file: requireFile(String(s), 'extraSamples[' + i + ']'), text: String(texts[i] ?? '').trim() || referenceText });
            });
        }

        const samples: unknown[] = [];
        for (const clip of clips) {
            const buf = fs.readFileSync(clip.file);
            const fd = new FormData();
            fd.append('file', new Blob([buf]), path.basename(clip.file));
            fd.append('reference_text', clip.text);
            const sample = await vbJson<unknown>(cfg, '/profiles/' + encodeURIComponent(profileId) + '/samples', {
                method: 'POST',
                body: fd,
            });
            samples.push(sample);
        }

        const dest = ctx.out(String(input.out ?? 'voicebox-clone.json'));
        const payload = {
            profileId: profileId,
            profileName: name,
            engine: String(input.defaultEngine ?? 'qwen'),
            language: String(input.language ?? 'en'),
            samplesUploaded: samples.length,
            baseUrl: cfg.baseUrl,
            profile: profile,
            samples: samples,
        };
        fs.writeFileSync(dest, JSON.stringify(payload, null, 2), 'utf8');

        return {
            outputs: [{ path: dest, kind: 'data', meta: payload }],
            warnings: samples.length < 2
                ? ['Only one reference sample was uploaded. 2-3 samples of clean speech give noticeably better fidelity.']
                : [],
        };
    },
});
