import { definePlugin } from '../../core/define.ts';
import { topKeywords, titleCase, hashString, contentWords, splitSentences } from './_shared.ts';
import { S } from '../_shared/common.ts';

/**
 * text.hook - deterministic "viral opener" generator.
 *
 * Picks one of 7 opener templates, then plugs in the script's strongest
 * keywords. Selection is fully deterministic given `seed`, so the agent
 * can rerun to get a different opening for an A/B compare.
 *
 * Templates:
 *   1.  "What if I told you _____ could _____?"
 *   2.  "Nobody talks about _____, and here's why."
 *   3.  "The truth about _____ will surprise you."
 *   4.  "_____ is the one thing most people get wrong."
 *   5.  "Stop _____ - try this instead."
 *   6.  "I spent _____ hours testing _____. Here's what I learned."
 *   7.  "Here's why _____ changed everything."
 */
const OPENERS = [
    (a: string, b: string) => `What if I told you ${a} could ${b}?`,
    (a: string) => `Nobody talks about ${a}, and here's why.`,
    (a: string) => `The truth about ${a} will surprise you.`,
    (a: string) => `${titleCase(a)} is the one thing most people get wrong.`,
    (a: string) => `Stop ${a} - try this instead.`,
    (a: string, b: string) => `I spent ${a} testing ${b}. Here's what I learned.`,
    (a: string) => `Here's why ${a} changed everything.`,
];

export default definePlugin({
    id: 'text.hook',
    name: 'Deterministic hook / opening line generator',
    category: 'brand',
    description:
        'Pick one of 7 deterministic opener templates and plug in the script\'s strongest keywords. Deterministic given seed.',
    inputs: {
        script: S.string('Raw script text', { required: true }),
        seed: S.string('Seed string for deterministic opener selection', { default: 'default' }),
        out: S.string('Output JSON path', { default: 'hook.json' }),
    },
    outputs: ['json'],
    async run({ input, ctx }) {
        const script = String(input.script ?? '').trim();
        const seed = String(input.seed ?? 'default');
        const out = ctx.out(String(input.out ?? 'hook.json'));

        if (!script) return { outputs: [], warnings: ['Empty script.'] };

        const keywords = topKeywords(script, 6);
        const [a, b = a] = [keywords[0] || 'this', keywords[1] || keywords[0] || 'it'];

        // Deterministic opener selection via FNV-1a(seed).
        const openerIdx = hashString(seed) % OPENERS.length;
        const opener = OPENERS[openerIdx](a, b);

        // Suggest 3 alternative openers by using other seeds ("alt-1", "alt-2", "alt-3").
        const alts = [1, 2, 3].map((i) => ({
            seed: 'alt-' + i,
            hook: OPENERS[(openerIdx + i) % OPENERS.length](a, b),
        }));

        // Quick sanity checks.
        const sentences = splitSentences(script);
        const wordCount = contentWords(script).length;

        const out0 = {
            hook: opener,
            openerTemplate: openerIdx + 1,
            keywords,
            alternatives: alts,
            sentenceCount: sentences.length,
            wordCount,
        };

        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, JSON.stringify(out0, null, 2), 'utf8');
        return { outputs: [{ path: out, kind: 'json' as const, meta: { openerTemplate: openerIdx + 1 } }] };
    },
});