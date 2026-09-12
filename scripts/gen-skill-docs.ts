/**
 * Generates the parts of skills/agentic-video/ that are derived from code, so
 * they can never drift:
 *
 *   references/plugin-catalogue.md   every registered plugin, by category
 *   references/remotion-templates.md every Remotion template + its props
 *
 * Run via `npm run gen:skill`. Never hand-edit the output.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadPlugins } from '../core/loader.ts';
import { all } from '../core/registry.ts';
import { projectRoot } from '../core/env.ts';
import { TEMPLATES } from '../plugins/motion/remotion/_templates.ts';

const root = projectRoot();
const dir = path.join(root, 'skills', 'agentic-video', 'references');
fs.mkdirSync(dir, { recursive: true });

/* ------------------------------------------------------------------ catalogue */

await loadPlugins();
const plugins = [...all()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));

const byCategory = new Map<string, typeof plugins>();
for (const p of plugins) {
    const c = String(p.manifest.category ?? 'uncategorised');
    if (!byCategory.has(c)) byCategory.set(c, []);
    byCategory.get(c)!.push(p);
}

const L: string[] = [];
L.push('# Plugin catalogue');
L.push('');
L.push('> **Generated** by `npm run gen:skill` from the live registry. Do not edit by hand.');
L.push(`> ${plugins.length} plugins, ${byCategory.size} categories.`);
L.push('>');
L.push('> Run `forge describe <id>` for exact inputs, defaults and enum values before you use one.');
L.push('');
for (const c of [...byCategory.keys()].sort()) L.push(`- [${c}](#${c}) (${byCategory.get(c)!.length})`);
L.push('');
for (const c of [...byCategory.keys()].sort()) {
    L.push(`## ${c}`, '');
    L.push('| Plugin | What it does | Outputs |', '|---|---|---|');
    for (const p of byCategory.get(c)!) {
        const m = p.manifest;
        const desc = String(m.description ?? '').split('\n')[0].replace(/\|/g, '\\|');
        // outputs are OutputSpec objects, not strings — joining them directly
        // renders "[object Object]".
        const outs = (m.outputs ?? []).map((o) => o?.kind).filter(Boolean).join(', ');
        L.push(`| \`${m.id}\` | ${desc} | ${outs} |`);
    }
    L.push('');
}
fs.writeFileSync(path.join(dir, 'plugin-catalogue.md'), L.join('\n'), 'utf8');
console.log(`wrote plugin-catalogue.md — ${plugins.length} plugins, ${byCategory.size} categories.`);

/* ------------------------------------------------------------------ remotion */

/** Pull the generated component's props type out of its TSX, brace-matched. */
function propsOf(tsx: string): string[] {
    const start = tsx.indexOf('type P = {');
    if (start < 0) return [];
    let depth = 0;
    let end = -1;
    for (let i = tsx.indexOf('{', start); i < tsx.length; i++) {
        if (tsx[i] === '{') depth++;
        else if (tsx[i] === '}') {
            depth--;
            if (depth === 0) { end = i; break; }
        }
    }
    if (end < 0) return [];
    const body = tsx.slice(tsx.indexOf('{', start) + 1, end);
    return body
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/\s+/g, ' '));
}

const R: string[] = [];
R.push('# Remotion templates');
R.push('');
R.push('> **Generated** by `npm run gen:skill` from `plugins/motion/remotion/_templates.ts`.');
R.push('> Do not edit by hand. Add a builder there and it appears here.');
R.push('');
R.push(`\`motion.remotion_template\` ships **${Object.keys(TEMPLATES).length}** ready-made compositions.`);
R.push('Every one gets the full Remotion runtime — React, `spring`, `interpolate`, `Easing` — so these');
R.push('are real motion graphics, not ffmpeg filters.');
R.push('');
R.push('```bash');
R.push('npm run forge -- run motion.remotion_template --input template=stat-counter \\');
R.push('  --input label="Videos rendered" --input value=128 --input suffix=k \\');
R.push('  --input durationInFrames=75 --input out=stat.mp4');
R.push('```');
R.push('');
R.push('Common inputs for all: `accent` (hex), `bg` (hex), `durationInFrames`, `fps`, `width`, `height`, `out`.');
R.push('Arrays and objects must go through `--json file.json`, not `--input k=v`.');
R.push('');

for (const [name, t] of Object.entries(TEMPLATES)) {
    R.push(`## ${name}`, '');
    R.push('**Props:** ' + (propsOf(t.build()).map((p) => `\`${p}\``).join(', ') || '—'));
    R.push('');
    R.push('Defaults (what you get if you pass only `template`):');
    R.push('');
    R.push('```json');
    R.push(JSON.stringify({ template: name, ...t.defaults }, null, 2));
    R.push('```');
    R.push('');
}
fs.writeFileSync(path.join(dir, 'remotion-templates.md'), R.join('\n'), 'utf8');
console.log(`wrote remotion-templates.md — ${Object.keys(TEMPLATES).length} templates.`);
