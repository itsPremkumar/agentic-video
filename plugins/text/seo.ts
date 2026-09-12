import { definePlugin } from '../../core/define.ts';
import {
    topKeywords,
    splitSentences,
    titleCase,
} from './_shared.ts';
import { S } from '../_shared/common.ts';

/**
 * text.seo - deterministic title/description/hashtags from a script.
 *
 * No network, no LLM. The agent uses the result as a starting point and can
 * re-run with `seed` to get a different deterministic pick.
 *
 * Heuristics:
 *   - title:   strongest 2-3 keyword combo, title-cased; or first sentence
 *              if it is short (<= 60 chars). Falls back to "Untitled Video".
 *   - description: first ~240 chars from the first paragraph + keyword tail.
 *   - hashtags: 5 most-frequent content words, `#` prefixed.
 */
export default definePlugin({
    id: 'text.seo',
    name: 'Heuristic SEO bundle (title / description / hashtags)',
    category: 'brand',
    description:
        'Deterministic, no-LLM title + description + hashtag bundle derived from the script via stopword-filtered keyword frequency.',
    inputs: {
        script: S.string('Raw script text', { required: true }),
        maxTitle: S.int('Max title length', { default: 60, minimum: 30, maximum: 100 }),
        hashtagCount: S.int('Number of hashtags', { default: 5, minimum: 1, maximum: 30 }),
        out: S.string('Output JSON path', { default: 'seo.json' }),
    },
    outputs: ['json'],
    async run({ input, ctx }) {
        const script = String(input.script ?? '').trim();
        const maxTitle = Math.max(30, Math.min(100, Number(input.maxTitle ?? 60)));
        const tagN = Math.max(1, Math.min(30, Number(input.hashtagCount ?? 5)));
        const out = ctx.out(String(input.out ?? 'seo.json'));

        if (!script) {
            return { outputs: [], warnings: ['Empty script.'] };
        }

        const keywords = topKeywords(script, 10);
        const sentences = splitSentences(script);

        // Title candidates.
        const candidates: string[] = [];
        if (keywords.length >= 2) candidates.push(titleCase(keywords.slice(0, 2).join(' ')));
        if (keywords.length >= 3) candidates.push(titleCase(keywords.slice(0, 3).join(' ')));
        if (keywords.length >= 1) candidates.push(titleCase(keywords[0]));
        if (sentences.length) candidates.push(sentences[0]);
        if (keywords.length >= 4) candidates.push(titleCase(keywords.slice(0, 4).join(' ')));

        // Pick the longest candidate <= maxTitle, otherwise trim.
        let title = candidates.find((c) => c.length <= maxTitle);
        if (!title) title = (candidates[0] || 'Untitled Video').slice(0, maxTitle);
        if (!title || !title.length) title = 'Untitled Video';
        // Final length clamp.
        if (title.length > maxTitle) title = title.slice(0, maxTitle).replace(/\s+\S*$/, '').trim() || 'Untitled Video';

        // Description: first paragraph first, then a tail with keywords.
        const firstPara = script.split(/\r?\n\s*\r?\n/)[0] || script;
        const descriptionBase = firstPara.slice(0, 240).replace(/\s+\S*$/, '').trim();
        const tail = keywords.length ? keywords.slice(0, 3).map(titleCase).join(' · ') : '';
        const description = (descriptionBase + (tail ? '\n\nKey topics: ' + tail : '')).trim();

        // Hashtags: top-K keywords, camelCase, alpha-only, prefixed.
        const hashtags = keywords
            .filter((k) => /^[a-z][a-z0-9]+$/i.test(k))
            .slice(0, tagN)
            .map((k) => '#' + k[0].toUpperCase() + k.slice(1));

        const seo = { title, description, hashtags, keywords };
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, JSON.stringify(seo, null, 2), 'utf8');

        return { outputs: [{ path: out, kind: 'json' as const, meta: { titleLen: title.length, hashtagCount: hashtags.length } }] };
    },
});