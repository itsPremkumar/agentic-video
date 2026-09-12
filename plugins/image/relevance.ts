import { definePlugin } from '../../core/define.ts';
import { S } from '../_shared/common.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tokenize } from '../text/_shared.ts';

/**
 * image.relevance - Jaccard keyword overlap between query text and tags.
 *
 * Pure set-arithmetic, deterministic. Used to rank candidate B-roll against
 * a script's content words. Score = |A intersect B| / |A union B|.
 */
export default definePlugin({
    id: 'image.relevance',
    name: 'Jaccard keyword overlap score between query and image tags',
    category: 'analyze',
    description:
        'Returns Jaccard similarity (0-1) between query keywords and image tag list. Pure set math, no LLM.',
    inputs: {
        query: S.string('Query text (script paragraph, scene caption, etc.)', { required: true }),
        tags: S.string('Comma- or newline-separated tags for the image', { required: true }),
        out: S.string('Output JSON path', { default: 'relevance.json' }),
    },
    outputs: ['json'],
    async run({ input, ctx }) {
        const query = String(input.query ?? '');
        const tagStr = String(input.tags ?? '');
        const out = ctx.out(String(input.out ?? 'relevance.json'));

        const qToks = new Set(tokenize(query));
        const tToks = new Set(tokenize(tagStr.replace(/[,;\n]+/g, ' ')));

        // Drop tiny tokens (<=1 char) for both sides for fairer scoring.
        const clean = (s: Set<string>) => new Set([...s].filter((w) => w.length > 1));
        const A = clean(qToks);
        const B = clean(tToks);
        let inter = 0;
        for (const a of A) if (B.has(a)) inter++;
        const union = A.size + B.size - inter;
        const score = union > 0 ? inter / union : 0;
        const overlap = inter > 0 ? [...A].filter((x) => B.has(x)) : [];

        const result = {
            query,
            tags: tagStr,
            queryTokens: A.size,
            tagTokens: B.size,
            intersection: inter,
            score: +score.toFixed(4),
            overlap,
            rating: score >= 0.3 ? 'relevant' : score >= 0.1 ? 'partial' : 'irrelevant',
        };
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, JSON.stringify(result, null, 2), 'utf8');
        return { outputs: [{ path: out, kind: 'json' as const, meta: { score: result.score, rating: result.rating } }] };
    },
});