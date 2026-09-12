import { definePlugin } from '../../core/define.ts';
import {
    splitParagraphs,
    splitSentences,
    topKeywords,
    readingStats,
    titleCase,
} from './_shared.ts';
import { S } from '../_shared/common.ts';

/**
 * text.script_parse - break a video script into a structured plan:
 *
 *   - paragraphs (split on blank lines)
 *   - sentences (split on . ! ?)
 *   - implicit "scene" inference when [Visual: ...] / [Text: ...] / [B-roll: ...]
 *     cues appear in the script (one scene per cue block)
 *   - per-scene keyword extraction (stopword-filtered frequency)
 *   - per-scene reading-time estimate (200 wpm)
 *   - a global title suggested from the strongest two keywords
 *
 * The plugin emits a JSON artifact (path) and inlines the structured plan
 * in the result, so an external agent can consume it without a second hop.
 */
export default definePlugin({
    id: 'text.script_parse',
    name: 'Parse a video script into scenes / sentences / keywords',
    category: 'analyze',
    description:
        'Splits a script into paragraphs + sentences, identifies [Visual:]/[Text:] cue blocks as scenes, and emits per-scene keywords and reading-time.',
    inputs: {
        script: S.string('Raw script text', { required: true }),
        cueRegex: S.string('Regex (string form) to split scenes on cue blocks', {
            default: '\\[(Visual|Text|B-roll|Audio|Music|Narration):',
        }),
        keywordsPerScene: S.int('Top-K keywords per scene', { default: 6, minimum: 1, maximum: 30 }),
        out: S.string('Output JSON path', { default: 'script-plan.json' }),
    },
    outputs: ['json'],
    async run({ input, ctx }) {
        const script = String(input.script ?? '');
        if (!script.trim()) {
            return {
                outputs: [],
                warnings: ['Empty script - nothing to parse.'],
            };
        }
        const out = ctx.out(String(input.out ?? 'script-plan.json'));
        const cueRegex = String(input.cueRegex ?? '\\[(Visual|Text|B-roll|Audio|Music|Narration):');
        const kw = Math.max(1, Math.min(30, Number(input.keywordsPerScene ?? 6)));

        const re = new RegExp(cueRegex, 'i');

        // If the script has cue blocks, split the script on them and treat
        // each cue block as a scene. Otherwise, fall back to paragraph-splitting.
        type Scene = { index: number; type: string; text: string; keywords: string[]; sentences: number; words: number; estSeconds: number };
        let scenes: Scene[] = [];

        if (re.test(script)) {
            // Find cue headers and slice the script at each cue line.
            const lines = script.split(/\r?\n/);
            const cueIdx: { at: number; tag: string; header: string }[] = [];
            lines.forEach((line, i) => {
                const m = /^\s*\[(Visual|Text|B-roll|Audio|Music|Narration)\s*:\s*([^\]]*)\]\s*(.*)$/i.exec(line);
                if (m) cueIdx.push({ at: i, tag: m[1].toLowerCase(), header: (m[2] || '').trim() });
            });
            if (cueIdx.length === 0) {
                // Regex matched somewhere but no full cue lines — fall back to paragraphs.
                scenes = splitParagraphs(script).map((p, i) => buildScene(i, 'paragraph', p, kw));
            } else {
                for (let i = 0; i < cueIdx.length; i++) {
                    const start = cueIdx[i].at;
                    const end = i + 1 < cueIdx.length ? cueIdx[i + 1].at : lines.length;
                    const body = lines.slice(start + 1, end).join('\n').trim();
                    const tag = cueIdx[i].tag;
                    const text = (cueIdx[i].header ? cueIdx[i].header + '\n' : '') + body;
                    scenes.push(buildScene(i, tag, text, kw));
                }
            }
        } else {
            scenes = splitParagraphs(script).map((p, i) => buildScene(i, 'paragraph', p, kw));
        }

        const allKeywords = topKeywords(script, 6);
        const stats = readingStats(script);
        const suggestedTitle = titleCase(allKeywords.slice(0, 2).join(' ')) || 'Untitled';

        const plan = {
            title: suggestedTitle,
            keywords: allKeywords,
            stats,
            sentences: splitSentences(script),
            scenes,
            sceneCount: scenes.length,
        };

        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, JSON.stringify(plan, null, 2), 'utf8');

        return { outputs: [{ path: out, kind: 'json' as const, meta: { scenes: scenes.length, keywords: allKeywords } }] };
    },
});

function buildScene(index: number, type: string, text: string, kw: number) {
    const stats = readingStats(text);
    return {
        index,
        type,
        text,
        keywords: topKeywords(text, kw),
        sentences: stats.sentences,
        words: stats.words,
        estSeconds: stats.estSeconds,
    };
}