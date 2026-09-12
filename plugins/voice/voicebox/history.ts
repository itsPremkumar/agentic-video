import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../../core/define.ts';
import { S, resolveOutPath } from '../../_shared/common.ts';
import { vbConfig, vbJson, vbFetch, VB_DEFAULT_BASE } from './_voicebox.ts';

/**
 * voice.voicebox_history - query past Voicebox generations.
 *
 * Useful for reusing audio you already generated (avoids burning GPU time on a
 * re-run) and for auditing what was said with which engine/seed.
 */
export default definePlugin({
    id: 'voice.voicebox_history',
    name: 'Voicebox generation history',
    category: 'voice',
    description:
        'List / search Voicebox generations, read stats, or re-download the audio of a previous generation by id.',
    inputs: {
        action: S.string('What to do', { default: 'list', enum: ['list', 'stats', 'get', 'audio'] }),
        generationId: S.string('Generation id (action=get or action=audio)', { default: undefined }),
        profileId: S.string('Filter by profile id (action=list)', { default: undefined }),
        search: S.string('Free-text search over generated text (action=list)'),
        limit: S.int('Max entries', { default: 50, minimum: 1, maximum: 100 }),
        offset: S.int('Pagination offset', { default: 0, minimum: 0 }),
        baseUrl: S.string('Voicebox base URL', { default: VB_DEFAULT_BASE }),
        out: S.string('Output file — JSON for list/stats/get, audio for action=audio', {
            default: 'voicebox-history.json',
        }),
    },
    outputs: ['json'],
    async run({ input, ctx }) {
        const cfg = vbConfig(input as Record<string, unknown>);
        const action = String(input.action ?? 'list').toLowerCase();
        const base = { baseUrl: cfg.baseUrl, action } as Record<string, unknown>;

        // ── audio: download straight to a file ────────────────────────────
        if (action === 'audio') {
            const id = String(input.generationId ?? '').trim();
            if (!id) {
                throw new PluginFailure({
                    code: 'INVALID_INPUT',
                    message: 'action="audio" requires generationId.',
                    retryable: true,
                });
            }
            const res = await vbFetch(cfg, '/history/' + encodeURIComponent(id) + '/export-audio');
            if (!res.ok) {
                throw new PluginFailure({
                    code: 'VOICEBOX_AUDIO_FETCH_FAILED',
                    message: 'Could not download audio for generation ' + id + ' (HTTP ' + res.status + ').',
                    reason: (await res.text()).slice(0, 400),
                    input: { generationId: id },
                    retryable: true,
                });
            }
            const dest = resolveOutPath(ctx, String(input.out ?? `voicebox-${id}.wav`));
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            const buf = Buffer.from(await res.arrayBuffer());
            fs.writeFileSync(dest, buf);
            return {
                outputs: [
                    {
                        path: dest,
                        kind: 'audio' as const,
                        meta: { generationId: id, bytes: buf.length },
                    },
                ],
            };
        }

        // ── list / stats / get: JSON ──────────────────────────────────────
        let payload: unknown;
        if (action === 'stats') {
            payload = await vbJson<unknown>(cfg, '/history/stats');
        } else if (action === 'get') {
            const id = String(input.generationId ?? '').trim();
            if (!id) {
                throw new PluginFailure({
                    code: 'INVALID_INPUT',
                    message: 'action="get" requires generationId.',
                    retryable: true,
                });
            }
            payload = await vbJson<unknown>(cfg, '/history/' + encodeURIComponent(id));
        } else {
            const qs = new URLSearchParams();
            if (input.profileId) qs.set('profile_id', String(input.profileId));
            if (input.search) qs.set('search', String(input.search));
            qs.set('limit', String(Number(input.limit ?? 50)));
            qs.set('offset', String(Number(input.offset ?? 0)));
            payload = await vbJson<unknown>(cfg, '/history?' + qs.toString());
        }

        const body = { ...base, result: payload };
        const dest = resolveOutPath(ctx, String(input.out ?? 'voicebox-history.json'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, JSON.stringify(body, null, 2), 'utf8');

        return {
            outputs: [{ path: dest, kind: 'json' as const, meta: base }],
        };
    },
});
