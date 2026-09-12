/**
 * Contract check for every registered plugin.
 *
 * Run with:  npm test
 *
 * This deliberately does NOT render media — that would be slow and would need
 * fixtures. It checks the things that are cheap to check and expensive to get
 * wrong, i.e. the contract the driving agent depends on:
 *
 *   - the id matches its path (so `plugins/<ns>/<action>.ts` stays true)
 *   - ids are snake_case (no camelCase drift)
 *   - every plugin documents itself (name / description / category / outputs)
 *   - every declared input has a description (the agent reads these)
 *   - enum inputs declare at least one allowed value
 *
 * A regression here means an external agent gets a confusing failure later,
 * which is exactly what this project exists to prevent.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadPlugins } from '../core/loader.ts';
import { all } from '../core/registry.ts';
import { projectRoot } from '../core/env.ts';
import { pathByPluginId } from './lib/plugin-paths.ts';

interface Problem {
    id: string;
    rule: string;
    detail: string;
}

async function main(): Promise<void> {
    await loadPlugins();
    const plugins = all();
    const problems: Problem[] = [];

    // Path lookup so we can assert the id <-> path rule both ways.
    const dir = path.join(projectRoot(), 'plugins');
    const fileOf = pathByPluginId(dir);

    const add = (id: string, rule: string, detail: string) => problems.push({ id, rule, detail });

    for (const p of plugins) {
        const m = p.manifest;
        const id = m.id;

        if (!/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(id)) add(id, 'id-format', `id must be snake_case "<namespace>.<action>", got "${id}"`);
        if (!m.name?.trim()) add(id, 'documentation', 'manifest.name is empty');
        if (!m.description?.trim()) add(id, 'documentation', 'manifest.description is empty');
        if (!m.category) add(id, 'documentation', 'manifest.category is missing');
        if (!m.outputs?.length) add(id, 'documentation', 'manifest.outputs is empty — the agent cannot know what it gets back');

        const file = fileOf.get(id);
        if (!file) {
            add(id, 'id-path-rule', `no source file found for id "${id}"`);
        } else {
            const ns = id.split('.')[0];
            if (file.split('/')[0] !== ns) {
                add(id, 'id-path-rule', `id namespace "${ns}" does not match its folder "${file}"`);
            }
        }

        for (const [key, spec] of Object.entries(m.inputs ?? {})) {
            if (!spec.description?.trim()) add(id, 'input-docs', `input "${key}" has no description`);
            if (spec.enum && spec.enum.length === 0) add(id, 'input-docs', `input "${key}" declares an empty enum`);
            if (spec.default !== undefined && spec.enum && !spec.enum.includes(spec.default as never)) {
                add(id, 'input-docs', `input "${key}" default ${JSON.stringify(spec.default)} is not in its enum ${JSON.stringify(spec.enum)}`);
            }
        }
    }

    // Duplicate ids would silently shadow each other in the registry.
    const seen = new Map<string, number>();
    for (const p of plugins) seen.set(p.manifest.id, (seen.get(p.manifest.id) ?? 0) + 1);
    for (const [id, n] of seen) if (n > 1) add(id, 'duplicate-id', `registered ${n} times`);

    const ruleCounts = new Map<string, number>();
    for (const p of problems) ruleCounts.set(p.rule, (ruleCounts.get(p.rule) ?? 0) + 1);

    if (!problems.length) {
        console.log(`OK — ${plugins.length} plugins pass the contract check.`);
        return;
    }
    console.error(`FAIL — ${problems.length} contract problem(s) across ${plugins.length} plugins:\n`);
    for (const p of problems) console.error(`  [${p.rule}] ${p.id}: ${p.detail}`);
    console.error('\nby rule: ' + [...ruleCounts].map(([r, n]) => `${r}=${n}`).join(', '));
    process.exitCode = 1;
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
