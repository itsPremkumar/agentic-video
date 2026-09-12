/**
 * Map every plugin id -> its source path relative to `plugins/`.
 *
 * Shared by the index generator and the contract check so both agree on what
 * "the file for plugin X" means. Two things make naive regexing unreliable:
 *
 *  1. Doc comments contain example JSON with `"id": "..."` in them — `edit.ops`
 *     documents a timeline segment, so a plain first-match picks up "intro".
 *  2. `image.remove_bg` keeps its manifest in a sidecar `remove_bg.json` rather
 *     than inline, so scanning only .ts/.py misses it entirely.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ID_RE = /^\s*(?:["']id["']|id)\s*:\s*["']([a-zA-Z0-9_.]+)["']/;

/** A JSDoc `*`, a `//` comment, or a Python `#` comment. */
function isCommentLine(line: string): boolean {
    const t = line.trim();
    return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*') || t.startsWith('#');
}

function idInFile(src: string): string | null {
    for (const line of src.split(/\r?\n/)) {
        if (isCommentLine(line)) continue;
        const m = line.match(ID_RE);
        if (m) return m[1];
    }
    return null;
}

export function pathByPluginId(pluginsDir: string): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (d: string): void => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) {
                walk(p);
            } else if (/\.(ts|py|json)$/.test(e.name)) {
                const id = idInFile(fs.readFileSync(p, 'utf8'));
                if (id && !out.has(id)) out.set(id, path.relative(pluginsDir, p).replace(/\\/g, '/'));
            }
        }
    };
    walk(pluginsDir);
    return out;
}
