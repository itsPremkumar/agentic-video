import * as fs from 'node:fs';
import { definePlugin, PluginFailure } from '../../../core/define.ts';
import { S } from '../../_shared/common.ts';
import { vbConfig, vbJson, VB_ENGINES, VB_LANGUAGES, VB_DEFAULT_BASE } from './_voicebox.ts';

/**
 * voice.voicebox_profiles - manage Voicebox voice profiles.
 *
 * A profile is the thing you speak through. It can be:
 *   cloned   - built from your own reference audio (see voice.voicebox_clone)
 *   preset   - one of the engine's built-in voices (e.g. kokoro af_heart)
 *   designed - described in natural language
 */
export default definePlugin({
    id: 'voice.voicebox_profiles',
    name: 'Manage Voicebox voice profiles',
    category: 'voice',
    description: 'List, create, inspect or delete Voicebox voice profiles (cloned / preset / designed).',
    inputs: {
        action: S.string('What to do', { default: 'list', enum: ['list', 'create', 'get', 'delete'] }),
        profileId: S.string('Profile id (required for get / delete)'),
        name: S.string('Profile name (for create)'),
        description: S.string('Profile description (for create)', { default: '' }),
        voiceType: S.string('Profile kind', { default: 'cloned', enum: ['cloned', 'preset', 'designed'] }),
        presetEngine: S.string('Engine for a preset profile', { enum: VB_ENGINES as unknown as string[] }),
        presetVoiceId: S.string('Built-in voice id for a preset profile, e.g. af_heart'),
        designPrompt: S.string('Natural-language voice description (designed profiles)'),
        defaultEngine: S.string('Default TTS engine for this profile', { enum: VB_ENGINES as unknown as string[] }),
        language: S.string('Language code', { default: 'en', enum: VB_LANGUAGES as unknown as string[] }),
        baseUrl: S.string('Voicebox base URL', { default: VB_DEFAULT_BASE }),
        out: S.string('Output JSON file name', { default: 'voicebox-profiles.json' }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        const cfg = vbConfig(input as Record<string, unknown>);
        const action = String(input.action ?? 'list');
        let payload: unknown;

        if (action === 'list') {
            payload = await vbJson(cfg, '/profiles');
        } else if (action === 'get') {
            const id = String(input.profileId ?? '').trim();
            if (!id) throw new PluginFailure({ code: 'INVALID_INPUT', message: 'profileId is required for action=get.', retryable: true });
            payload = await vbJson(cfg, '/profiles/' + encodeURIComponent(id));
        } else if (action === 'delete') {
            const id = String(input.profileId ?? '').trim();
            if (!id) throw new PluginFailure({ code: 'INVALID_INPUT', message: 'profileId is required for action=delete.', retryable: true });
            payload = await vbJson(cfg, '/profiles/' + encodeURIComponent(id), { method: 'DELETE' });
        } else if (action === 'create') {
            const name = String(input.name ?? '').trim();
            if (!name) throw new PluginFailure({ code: 'INVALID_INPUT', message: 'name is required for action=create.', retryable: true });
            const body: Record<string, unknown> = {
                name: name,
                language: String(input.language ?? 'en'),
                voice_type: String(input.voiceType ?? 'cloned'),
            };
            if (input.description) body.description = String(input.description);
            if (input.presetEngine) body.preset_engine = String(input.presetEngine);
            if (input.presetVoiceId) body.preset_voice_id = String(input.presetVoiceId);
            if (input.designPrompt) body.design_prompt = String(input.designPrompt);
            if (input.defaultEngine) body.default_engine = String(input.defaultEngine);
            payload = await vbJson(cfg, '/profiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        } else {
            throw new PluginFailure({ code: 'INVALID_INPUT', message: 'Unknown action "' + action + '".', retryable: true });
        }

        const dest = ctx.out(String(input.out ?? 'voicebox-profiles.json'));
        fs.writeFileSync(dest, JSON.stringify({ action: action, baseUrl: cfg.baseUrl, result: payload }, null, 2), 'utf8');
        return { outputs: [{ path: dest, kind: 'data', meta: { action: action } }] };
    },
});
