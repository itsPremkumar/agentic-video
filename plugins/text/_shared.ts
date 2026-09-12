/**
 * plugins/text/_shared.ts — text utilities shared by the text/* plugins.
 *
 * Pure-TS, zero-dependency, deterministic. No LLM, no network.
 */

export const STOPWORDS = new Set<string>(
    (
        'a an and are as at be been being but by for from has have he her his ' +
        'i if in into is it its me my of on or our she that the their them then ' +
        'they this to was we were what when which who why will with would you ' +
        'your yours yourself himself herself themselves about above after again ' +
        'against all am any because before below between both can did do does doing ' +
        'down during each few for from further had has have having he her here hers ' +
        'him himself how i if in into is it its itself just like more most my ' +
        'myself no nor not now off once only other ought our ours ourselves out ' +
        'over own same she should so some such than their theirs them themselves ' +
        'then there these they this those through too under until up very was ' +
        'we were what when where which while who whom why with would you your ' +
        'yours yourself yourselves just'
    ).split(/\s+/),
);

/** Tokenise: lowercase, strip punctuation, collapse whitespace. */
export function tokenize(text: string): string[] {
    return String(text || '')
        .toLowerCase()
        .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
        .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

/** Stopword-filtered tokens; useful for keyword extraction. */
export function contentWords(text: string): string[] {
    return tokenize(text).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Split into sentences on `. ! ?` followed by whitespace and capital. */
export function splitSentences(text: string): string[] {
    const t = String(text || '').trim();
    if (!t) return [];
    return t
        .replace(/\n+/g, ' ')
        .split(/(?<=[.!?])\s+(?=[A-Z\p{Lu}\d"'(\[])/u)
        .map((s) => s.trim())
        .filter(Boolean);
}

/** Split into paragraphs on blank lines. */
export function splitParagraphs(text: string): string[] {
    return String(text || '')
        .split(/\r?\n\s*\r?\n/)
        .map((p) => p.trim())
        .filter(Boolean);
}

/** Cheap word frequencies for a token list. */
export function freq(tokens: string[]): Map<string, number> {
    const f = new Map<string, number>();
    for (const t of tokens) f.set(t, (f.get(t) || 0) + 1);
    return f;
}

/** Top N most frequent content words. */
export function topKeywords(text: string, n = 6): string[] {
    const f = freq(contentWords(text));
    return Array.from(f.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, n)
        .map(([w]) => w);
}

/** Rough reading-time estimate (200 wpm) plus char count. */
export function readingStats(text: string): { chars: number; words: number; sentences: number; estSeconds: number } {
    const s = String(text || '');
    const words = tokenize(s).length;
    const sentences = splitSentences(s).length || (words > 0 ? 1 : 0);
    return {
        chars: s.length,
        words,
        sentences,
        estSeconds: Math.max(1, Math.round((words / 200) * 60)),
    };
}

/** Camel-/Title-case render of a phrase. */
export function titleCase(s: string): string {
    return String(s || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => (w.length <= 3 && /^(a|an|and|the|of|to|in|on|at|by|for|or)$/i.test(w)) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}

/** 32-bit FNV-1a hash — used for deterministic pseudo-random selection (no Math.random). */
export function hashString(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** Levenshtein for hook / title comparison — small strings only. */
export function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = new Array(b.length + 1);
    let curr = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[b.length];
}