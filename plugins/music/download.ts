import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { S } from '../_shared/common.ts';

/**
 * music.download — fetch a background track from a free source.
 * Explicit provider; no silent substitution when a provider is unavailable.
 */
async function internetArchive(query: string, count: number): Promise<{ url: string; id: string }[]> {
    const url =
        'https://archive.org/advancedsearch.php?' +
        new URLSearchParams({
            q: `mediatype:audio AND (${query}) AND (licenseurl:(*creativecommons*))`,
            fl: 'identifier,title',
            rows: String(Math.max(count * 3, 10)),
            output: 'json',
        });
    const res = await fetch(url);
    if (!res.ok) {
        throw new PluginFailure({
            code: 'PROVIDER_ERROR',
            message: `Internet Archive search returned HTTP ${res.status}`,
            reason: (await res.text()).slice(0, 300),
            input: { query },
            retryable: res.status >= 500,
        });
    }
    const json = (await res.json()) as { response?: { docs?: Record<string, any>[] } };
    const ids = (json.response?.docs ?? []).map((d) => String(d.identifier)).filter(Boolean);
    const out: { url: string; id: string }[] = [];
    for (const id of ids) {
        if (out.length >= count) break;
        const metaRes = await fetch(`https://archive.org/metadata/${id}`);
        if (!metaRes.ok) continue;
        const meta = (await metaRes.json()) as Record<string, any>;
        const files: Record<string, any>[] = meta.files ?? [];
        const audio = files.find((f) => /\.(mp3|ogg|flac|wav)$/i.test(String(f.name ?? '')) && f.format !== 'Metadata');
        if (audio?.name) {
            out.push({ url: `https://archive.org/download/${id}/${encodeURIComponent(String(audio.name))}`, id });
        }
    }
    return out;
}

const PROVIDERS: Record<string, (q: string, n: number) => Promise<{ url: string; id: string }[]>> = {
    'internet-archive': internetArchive,
};

export default definePlugin({
    id: 'music.download',
    name: 'Download background music',
    category: 'music',
    description: 'Download CC-licensed music from internet-archive.',
    inputs: {
        query: S.string('Search query, e.g. "ambient" or "lofi"', { required: true }),
        provider: S.string('Music source', { enum: ['internet-archive'], default: 'internet-archive' }),
        count: S.int('How many tracks', { default: 1, minimum: 1, maximum: 5 }),
        prefix: S.string('Filename prefix', { default: 'music' }),
    },
    outputs: ['audio'],
    async run({ input, ctx }) {
        const provider = String(input.provider ?? 'internet-archive');
        const impl = PROVIDERS[provider];
        if (!impl) {
            throw new PluginFailure({
                code: 'UNKNOWN_PROVIDER',
                message: `Unknown music provider "${provider}"`,
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
                message: `Provider "${provider}" returned no tracks for "${query}".`,
                input: { provider, query },
                retryable: true,
                hint: 'Try a different query, or use music.generate to synthesise a track instead.',
            });
        }
        const outputs: { path: string; kind: 'audio'; meta?: Record<string, unknown> }[] = [];
        const warnings: string[] = [];
        let i = 0;
        for (const c of candidates.slice(0, count)) {
            i++;
            const ext = (path.extname(new URL(c.url).pathname) || '.mp3').split('?')[0];
            const dest = ctx.out(`${String(input.prefix ?? 'music')}_${i}_${c.id}${ext}`);
            try {
                const res = await fetch(c.url, { redirect: 'follow' });
                if (!res.ok) {
                    warnings.push(`skipped ${c.url} (HTTP ${res.status})`);
                    continue;
                }
                const buf = Buffer.from(await res.arrayBuffer());
                if (buf.length < 20480) {
                    warnings.push(`skipped ${c.url} (too small: ${buf.length} bytes)`);
                    continue;
                }
                fs.writeFileSync(dest, buf);
                outputs.push({ path: dest, kind: 'audio', meta: { source: provider, id: c.id, bytes: buf.length } });
            } catch (e) {
                warnings.push(`skipped ${c.url} (${(e as Error).message})`);
            }
        }
        if (!outputs.length) {
            throw new PluginFailure({
                code: 'DOWNLOAD_FAILED',
                message: `Found ${candidates.length} candidate(s) but none could be downloaded.`,
                reason: warnings.join('; '),
                input: { provider, query },
                detail: warnings.join('\n'),
                retryable: true,
            });
        }
        return { outputs, warnings };
    },
});
