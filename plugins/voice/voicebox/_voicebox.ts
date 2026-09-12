/**
 * Shared HTTP client for the Voicebox server (jamiepine/voicebox).
 *
 * Voicebox is a local FastAPI TTS studio with zero-shot voice cloning and 7
 * bundled engines (Qwen3-TTS, Chatterbox Multilingual, Chatterbox Turbo,
 * LuxTTS, HumeAI TADA, Kokoro, Qwen CustomVoice).
 *
 * This is NOT a plugin - it is helper infrastructure for the voice.voicebox_*
 * plugins. It has no default export with a manifest, so the loader skips it.
 */
import { PluginFailure } from '../../../core/define.ts';

export const VB_DEFAULT_BASE = 'http://localhost:17493';

export const VB_ENGINES = [
    'qwen',
    'qwen_custom_voice',
    'luxtts',
    'chatterbox',
    'chatterbox_turbo',
    'kokoro',
];

export const VB_LANGUAGES = [
    'zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it',
    'he', 'ar', 'da', 'el', 'fi', 'hi', 'ms', 'nl', 'no', 'pl',
    'sv', 'sw', 'tr',
];

export interface VbConfig {
    baseUrl: string;
    timeoutMs: number;
}

export function vbConfig(input: Record<string, unknown>): VbConfig {
    let raw = VB_DEFAULT_BASE;
    if (typeof input.baseUrl === 'string' && input.baseUrl) raw = input.baseUrl;
    else if (process.env.VOICEBOX_URL) raw = process.env.VOICEBOX_URL;
    return {
        baseUrl: raw.replace(/\/+$/, ''),
        timeoutMs: Number(input.timeoutMs ?? 30_000),
    };
}

/** Fetch with a hard timeout, mapping transport failures to PluginFailure. */
export async function vbFetch(cfg: VbConfig, urlPath: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
        return await fetch(cfg.baseUrl + urlPath, Object.assign({}, init, { signal: controller.signal }));
    } catch (e) {
        const err = e as Error;
        if (err && err.name === 'AbortError') {
            throw new PluginFailure({
                code: 'VOICEBOX_TIMEOUT',
                message: 'Voicebox did not respond within ' + cfg.timeoutMs + 'ms.',
                reason: 'Timed out calling ' + urlPath,
                retryable: true,
                hint: 'Is the Voicebox server running? Start it with: python -m speech.main',
            });
        }
        throw new PluginFailure({
            code: 'VOICEBOX_UNREACHABLE',
            message: 'Could not reach the Voicebox server at ' + cfg.baseUrl + '.',
            reason: (err && err.name ? err.name + ': ' : '') + (err && err.message ? err.message : String(e)),
            input: { urlPath: urlPath },
            retryable: true,
            hint: 'Start Voicebox (default http://localhost:17493) or pass baseUrl / set VOICEBOX_URL.',
        });
    } finally {
        clearTimeout(timer);
    }
}

/** Fetch and parse JSON, turning non-2xx into a structured PluginFailure. */
export async function vbJson<T>(cfg: VbConfig, urlPath: string, init: RequestInit = {}): Promise<T> {
    const res = await vbFetch(cfg, urlPath, init);
    const text = await res.text();
    if (!res.ok) {
        throw new PluginFailure({
            code: 'VOICEBOX_HTTP_ERROR',
            message: 'Voicebox returned HTTP ' + res.status + ' for ' + urlPath + '.',
            reason: text.slice(0, 600),
            input: { urlPath: urlPath },
            retryable: res.status >= 500,
            hint: res.status === 404
                ? 'Check the id/name you passed - Voicebox could not find it.'
                : 'See the Voicebox server logs for the upstream error.',
        });
    }
    try {
        return JSON.parse(text) as T;
    } catch {
        throw new PluginFailure({
            code: 'VOICEBOX_BAD_JSON',
            message: 'Voicebox returned non-JSON for ' + urlPath + '.',
            reason: text.slice(0, 400),
            retryable: false,
        });
    }
}
