/**
 * video.download — fetch stock video clips from an explicitly chosen provider.
 * No fallback: an unconfigured or failing provider is reported, not substituted.
 *
 * Provider-agnostic plumbing (key guard, HTTP errors, Wikimedia search,
 * download loop) lives in ../_shared/stock.ts. Only the provider-specific
 * request/response shapes live here.
 */
import { definePlugin, PluginFailure } from '../../core/define.ts';
import {
    type StockCandidate,
    requireProviderKey,
    providerError,
    wikimediaSearch,
    downloadCandidates,
    downloadFailed,
} from '../_shared/stock.ts';
import { S } from '../_shared/common.ts';

async function pexels(query: string, count: number): Promise<StockCandidate[]> {
    const key = requireProviderKey('PEXELS_API_KEY', 'pexels', query, ['wikimedia']);
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${count}`;
    const res = await fetch(url, { headers: { Authorization: key } });
    if (!res.ok) await providerError('Pexels video API', res, { query, count });
    const json = (await res.json()) as { videos?: Record<string, any>[] };
    const out: StockCandidate[] = [];
    for (const v of json.videos ?? []) {
        const files: Record<string, any>[] = v.video_files ?? [];
        const best =
            files.find((f) => f.quality === 'hd' && f.file_type === 'video/mp4') ??
            files.find((f) => f.file_type === 'video/mp4') ??
            files[0];
        if (best?.link) out.push({ url: String(best.link), id: String(v.id), source: 'pexels' });
    }
    return out;
}

const wikimedia = (query: string, count: number) => wikimediaSearch(query, count, { filetype: 'video' });

/**
 * Pixabay video search (https://pixabay.com/api/docs/#api_videos).
 * Requires PIXABAY_API_KEY. Picks the largest available rendition.
 */
async function pixabay(query: string, count: number): Promise<StockCandidate[]> {
    const key = requireProviderKey('PIXABAY_API_KEY', 'pixabay', query, ['wikimedia']);
    const url =
        'https://pixabay.com/api/videos/?key=' + encodeURIComponent(key) +
        '&q=' + encodeURIComponent(query) +
        '&per_page=' + Math.min(Math.max(count, 3), 200) +
        '&safesearch=true';
    const res = await fetch(url);
    if (!res.ok) await providerError('Pixabay video API', res, { query, count });
    const json = (await res.json()) as { hits?: Record<string, any>[] };
    const out: StockCandidate[] = [];
    for (const hit of json.hits ?? []) {
        const renditions: Record<string, any> = hit.videos ?? {};
        // Quality order: large > medium > small > tiny.
        const best =
            ['large', 'medium', 'small', 'tiny'].map((k) => renditions[k]).find((v) => v && v.url) ?? null;
        if (best?.url) out.push({ url: String(best.url), id: String(hit.id ?? ''), source: 'pixabay' });
    }
    return out;
}

const PROVIDERS: Record<string, (q: string, n: number) => Promise<StockCandidate[]>> = {
    pexels,
    pixabay,
    wikimedia,
};

export default definePlugin({
    id: 'video.download',
    name: 'Download stock video',
    category: 'video',
    description: 'Search and download stock video clips from pexels | pixabay | wikimedia.',
    inputs: {
        query: S.string('Search query — concrete noun phrases', { required: true }),
        provider: S.string('Video source', { enum: ['pexels', 'pixabay', 'wikimedia'], default: 'pexels' }),
        count: S.int('How many clips to download', { default: 1, minimum: 1, maximum: 10 }),
        prefix: S.string('Filename prefix', { default: 'clip' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const provider = String(input.provider ?? 'pexels');
        const impl = PROVIDERS[provider];
        if (!impl) {
            throw new PluginFailure({
                code: 'UNKNOWN_PROVIDER',
                message: `Unknown video provider "${provider}"`,
                input: { provider },
                retryable: true,
                hint: `Supported: ${Object.keys(PROVIDERS).join(', ')}`,
            });
        }
        const query = String(input.query);
        const count = Number(input.count ?? 1);
        const candidates = await impl(query, count);
        if (!candidates.length) {
            throw new PluginFailure({
                code: 'NO_RESULTS',
                message: `Provider "${provider}" returned no videos for "${query}".`,
                input: { provider, query },
                retryable: true,
                hint: 'Use a more concrete noun phrase, or try a different provider.',
            });
        }

        const prefix = String(input.prefix ?? 'clip');
        const { outputs, warnings } = await downloadCandidates(candidates, count, {
            ext: '.mp4',
            minBytes: 2048,
            kind: 'video',
            dest: (c, i) => ctx.out(`${prefix}_${i}_${c.source}_${c.id}`),
        });
        if (!outputs.length) downloadFailed('video', provider, query, candidates.length, warnings);
        return { outputs, warnings };
    },
});
