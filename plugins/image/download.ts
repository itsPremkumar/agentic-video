/**
 * image.download — fetch stock images from an explicitly chosen provider.
 *
 * No fallback: if you ask for "pexels" and PEXELS_API_KEY is not configured,
 * the plugin FAILS and says so. Choose a different `provider` explicitly if you
 * want a different source.
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
    const key = requireProviderKey('PEXELS_API_KEY', 'pexels', query, ['openverse', 'wikimedia']);
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=all`;
    const res = await fetch(url, { headers: { Authorization: key } });
    if (!res.ok) await providerError('Pexels API', res, { query, count });
    const json = (await res.json()) as { photos?: Record<string, any>[] };
    return (json.photos ?? []).map((p) => ({
        url: String(p.src?.original ?? p.src?.large ?? p.src?.medium),
        id: String(p.id),
        source: 'pexels',
        title: p.alt ? String(p.alt).slice(0, 80) : undefined,
        width: p.width,
        height: p.height,
    }));
}

async function openverse(query: string, count: number): Promise<StockCandidate[]> {
    const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=${count}&license_type=all`;
    const res = await fetch(url);
    if (!res.ok) await providerError('Openverse API', res, { query, count });
    const json = (await res.json()) as { results?: Record<string, any>[] };
    return (json.results ?? []).map((r) => ({
        url: String(r.url),
        id: String(r.id),
        source: 'openverse',
        title: r.title ? String(r.title).slice(0, 80) : undefined,
        width: r.width,
        height: r.height,
    }));
}

const wikimedia = (query: string, count: number) =>
    wikimediaSearch(query, count, { filetype: 'bitmap', thumb: 1920 });

/**
 * Pixabay image search (https://pixabay.com/api/docs/#api_images).
 * Requires PIXABAY_API_KEY. Prefers the full-resolution `largeImageURL`.
 */
async function pixabay(query: string, count: number): Promise<StockCandidate[]> {
    const key = requireProviderKey('PIXABAY_API_KEY', 'pixabay', query, ['openverse']);
    const url =
        'https://pixabay.com/api/?key=' + encodeURIComponent(key) +
        '&q=' + encodeURIComponent(query) +
        '&image_type=photo&per_page=' + Math.min(Math.max(count, 3), 200) +
        '&safesearch=true';
    const res = await fetch(url);
    if (!res.ok) await providerError('Pixabay image API', res, { query, count });
    const json = (await res.json()) as { hits?: Record<string, any>[] };
    const out: StockCandidate[] = [];
    for (const hit of json.hits ?? []) {
        const link = hit.largeImageURL ?? hit.webformatURL ?? hit.previewURL;
        if (!link) continue;
        out.push({
            url: String(link),
            id: String(hit.id ?? ''),
            source: 'pixabay',
            title: String(hit.tags ?? '').slice(0, 80),
            width: Number(hit.imageWidth ?? hit.webformatWidth ?? 0) || undefined,
            height: Number(hit.imageHeight ?? hit.webformatHeight ?? 0) || undefined,
        });
    }
    return out;
}

const PROVIDERS: Record<string, (q: string, n: number) => Promise<StockCandidate[]>> = {
    pexels,
    pixabay,
    openverse,
    wikimedia,
};

export default definePlugin({
    id: 'image.download',
    name: 'Download stock images',
    category: 'image',
    description: 'Search and download stock images from pexels | pixabay | openverse | wikimedia.',
    inputs: {
        query: S.string('Search query — use concrete noun phrases, e.g. "coral reef"', { required: true }),
        provider: S.string('Image source', { enum: ['pexels', 'pixabay', 'openverse', 'wikimedia'], default: 'pexels' }),
        count: S.int('How many images to download', { default: 1, minimum: 1, maximum: 20 }),
        prefix: S.string('Filename prefix for downloaded files', { default: 'img' }),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const provider = String(input.provider ?? 'pexels');
        const impl = PROVIDERS[provider];
        if (!impl) {
            throw new PluginFailure({
                code: 'UNKNOWN_PROVIDER',
                message: `Unknown image provider "${provider}"`,
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
                message: `Provider "${provider}" returned no images for query "${query}".`,
                reason: 'The search returned zero results.',
                input: { provider, query, count },
                retryable: true,
                hint: 'Use a more concrete noun phrase, or try a different provider.',
            });
        }

        const prefix = String(input.prefix ?? 'img');
        const { outputs, warnings } = await downloadCandidates(candidates, count, {
            ext: '.jpg',
            minBytes: 1024,
            kind: 'image',
            dest: (c, i) => ctx.out(`${prefix}_${i}_${c.source}_${c.id}`),
        });
        if (!outputs.length) downloadFailed('image', provider, query, candidates.length, warnings);
        return { outputs, warnings };
    },
});
