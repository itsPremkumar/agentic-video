/**
 * Shared stock-media plumbing for the download plugins.
 *
 * `image.download` and `video.download` talk to different endpoints, but the
 * boring parts around them are identical: the "is this provider configured?"
 * guard, the HTTP-error wrapper, the Wikimedia Commons search, and the
 * write-to-disk loop. Those live here so each plugin only carries the parts
 * that are actually provider-specific.
 *
 * This file starts with `_` so the plugin loader skips it. It is shared code,
 * not a plugin — it has no manifest and must never be invoked directly.
 */
import * as fs from 'node:fs';
import { PluginFailure } from '../../core/define.ts';
import { optionalEnv } from '../../core/env.ts';
import { safeFilePart, safeExt, withExt } from './common.ts';

/** One search result, before anything is downloaded. */
export interface StockCandidate {
    url: string;
    id: string;
    source: string;
    title?: string;
    width?: number;
    height?: number;
    /** Provider-reported MIME type, when it gives us one. */
    mime?: string;
}

/** A candidate that made it all the way to disk. */
export interface StockAsset {
    path: string;
    kind: 'image' | 'video';
    meta?: Record<string, unknown>;
}

/**
 * Guard for providers that need an API key.
 *
 * No fallback is attempted here on purpose: if the key is missing the plugin
 * fails with a message telling the agent which key to set and which keyless
 * provider to use instead.
 */
export function requireProviderKey(
    envVar: string,
    provider: string,
    query: string,
    keylessAlternatives: string[] = [],
): string {
    const key = optionalEnv(envVar);
    if (key) return key;
    const alt = keylessAlternatives.length ? ` or provider="${keylessAlternatives.join('" / "')}"` : '';
    throw new PluginFailure({
        code: 'MISSING_API_KEY',
        message: `provider "${provider}" requires ${envVar}.`,
        reason: `${envVar} is not set in the environment or .env.`,
        input: { provider, query },
        retryable: false,
        hint: `Set ${envVar} in .env, or call this plugin again with provider="${keylessAlternatives[0] ?? 'openverse'}"${alt} (no key needed).`,
    });
}

/** Uniform wrapper for a non-2xx provider response. */
export async function providerError(label: string, res: Response, input: Record<string, unknown>): Promise<never> {
    const reason = (await res.text().catch(() => '')).slice(0, 300);
    throw new PluginFailure({
        code: 'PROVIDER_ERROR',
        message: `${label} returned HTTP ${res.status}`,
        reason: reason || 'The provider returned no response body.',
        input,
        retryable: res.status >= 500 || res.status === 429,
        hint: res.status === 429 ? 'Rate limited — wait a few seconds and retry.' : undefined,
    });
}

/** Containers Wikimedia serves that do not advertise a `video/*` MIME type. */
const VIDEO_EXT = /\.(ogv|ogx|webm|mp4|mov|m4v|avi|mkv|mpg|mpeg|flv|wmv)$/i;
const VIDEO_MIME = /^video\/|^application\/ogg$/i;

/**
 * Does this imageinfo entry actually hold moving pictures?
 *
 * Checking `mime.startsWith('video/')` alone is not enough: the vast majority
 * of Commons video is `.ogv` (Theora), which is served as `application/ogg`.
 * A MIME-only test silently discarded nearly every result.
 */
function isVideo(ii: Record<string, any>): boolean {
    const mime = String(ii.mime ?? '').split(';')[0].trim();
    return VIDEO_MIME.test(mime) || VIDEO_EXT.test(String(ii.url ?? ''));
}

/**
 * Wikimedia Commons search.
 *
 * `gsrnamespace=6` (the File: namespace) is REQUIRED. Without it the search
 * runs against the main article namespace, `imageinfo` comes back empty, and
 * *every* query yields NO_RESULTS even for queries that plainly have matches.
 */
export async function wikimediaSearch(
    query: string,
    count: number,
    opts: { filetype: 'bitmap' | 'video'; thumb?: number },
): Promise<StockCandidate[]> {
    const url =
        'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search' +
        `&gsrsearch=${encodeURIComponent(`filetype:${opts.filetype} ${query}`)}` +
        `&gsrnamespace=6&gsrlimit=${count}` +
        `&prop=imageinfo&iiprop=url|size|mime|extmetadata` +
        (opts.thumb ? `&iiurlwidth=${opts.thumb}` : '');
    const res = await fetch(url, { headers: { 'User-Agent': 'AgenticVideo/1.0' } });
    if (!res.ok) await providerError('Wikimedia API', res, { query, count });

    const json = (await res.json()) as { query?: { pages?: Record<string, any> } };
    return Object.values(json.query?.pages ?? {})
        .map((p) => p?.imageinfo?.[0])
        .filter(Boolean)
        // The text search is fuzzy: a video query also surfaces bitmaps and
        // vice versa, so filter on what the file actually is.
        .filter((ii: Record<string, any>) => (opts.filetype === 'video' ? isVideo(ii) : !isVideo(ii)))
        .map((ii: Record<string, any>) => ({
            url: String((opts.thumb ? ii.thumburl : null) ?? ii.url),
            id: safeFilePart(String(ii.url ?? '').split('/').pop(), 'wikimedia'),
            source: 'wikimedia',
            title: String(ii.extmetadata?.ObjectName?.value ?? '')
                .replace(/<[^>]+>/g, '')
                .slice(0, 80),
            width: ii.thumbwidth ?? ii.width,
            height: ii.thumbheight ?? ii.height,
            mime: ii.mime ? String(ii.mime) : undefined,
        }));
}

export interface DownloadOptions {
    /** Extension fallback when the URL has none. */
    ext: string;
    /** Files smaller than this are treated as error pages, not assets. */
    minBytes: number;
    /** Build the destination path for candidate `i` (1-based). */
    dest: (c: StockCandidate, i: number) => string;
    kind: 'image' | 'video';
}

export interface DownloadResult {
    outputs: StockAsset[];
    warnings: string[];
}

/**
 * Fetch each candidate to disk, collecting per-file warnings instead of
 * aborting the whole batch on the first bad URL.
 */
export async function downloadCandidates(
    candidates: StockCandidate[],
    limit: number,
    opts: DownloadOptions,
): Promise<DownloadResult> {
    const outputs: StockAsset[] = [];
    const warnings: string[] = [];
    let i = 0;
    for (const c of candidates.slice(0, limit)) {
        i++;
        const dest = withExt(opts.dest(c, i), safeExt(c.url, opts.ext));
        try {
            const res = await fetch(c.url);
            if (!res.ok) {
                warnings.push(`skipped ${c.url} (HTTP ${res.status})`);
                continue;
            }
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length < opts.minBytes) {
                warnings.push(`skipped ${c.url} (suspiciously small: ${buf.length} bytes)`);
                continue;
            }
            fs.writeFileSync(dest, buf);
            const ext = safeExt(c.url, opts.ext).toLowerCase();
            if (opts.kind === 'video' && ext !== '.mp4' && ext !== '.mov') {
                warnings.push(
                    `${dest.split(/[\\/]/).pop()} is a ${ext} container, not MP4 — ffmpeg reads it, but ` +
                        'transcode with export.derivative before mixing it with MP4 clips.',
                );
            }
            outputs.push({
                path: dest,
                kind: opts.kind,
                meta: {
                    source: c.source,
                    id: c.id,
                    title: c.title,
                    width: c.width,
                    height: c.height,
                    mime: c.mime,
                    bytes: buf.length,
                },
            });
        } catch (e) {
            warnings.push(`skipped ${c.url} (${(e as Error).message})`);
        }
    }
    return { outputs, warnings };
}

/** Raised when candidates were found but every download failed. */
export function downloadFailed(
    kind: 'image' | 'video',
    provider: string,
    query: string,
    found: number,
    warnings: string[],
): never {
    throw new PluginFailure({
        code: 'DOWNLOAD_FAILED',
        message: `Found ${found} candidate(s) but no ${kind} could be downloaded.`,
        reason: warnings.join('; ') || 'Every download attempt failed.',
        input: { provider, query },
        detail: warnings.join('\n'),
        retryable: true,
    });
}
