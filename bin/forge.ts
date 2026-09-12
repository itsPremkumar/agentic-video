#!/usr/bin/env tsx
/**
 * bin/forge.ts — the command line interface an external agent drives.
 *
 *   forge list                       list every plugin
 *   forge list --category video      list one category
 *   forge describe <id>              show a plugin's inputs/outputs
 *   forge run <id> --input k=v ...   run ONE plugin, print an explicit ack
 *   forge run <id> --json file.json  run with a JSON input object
 *   forge run <id> --json file.json --step 3
 *
 * `forge run` exits non-zero when the plugin fails, so a scripted agent can
 * stop immediately instead of continuing with missing assets.
 */
import * as fs from 'node:fs';
import { ensureLoaded, runPlugin } from '../core/runner.ts';
import { all, byCategory } from '../core/registry.ts';
import { formatAck } from '../core/result.ts';
import type { OpResult } from '../core/types.ts';

function argv(): string[] {
    return process.argv.slice(2);
}

function flag(name: string): boolean {
    return argv().includes(`--${name}`);
}

function value(name: string): string | undefined {
    const a = argv();
    const i = a.indexOf(`--${name}`);
    return i >= 0 ? a[i + 1] : undefined;
}

function coerce(v: string): unknown {
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^-?\d+$/.test(v)) return Number(v);
    if (/^-?\d*\.\d+$/.test(v)) return Number(v);
    if ((v.startsWith('[') && v.endsWith(']')) || (v.startsWith('{') && v.endsWith('}'))) {
        try {
            return JSON.parse(v);
        } catch {
            return v;
        }
    }
    // Detect "looks like an array of file paths" -> split.
    // Heuristic: comma-separated AND each segment has a file extension OR
    // contains a path separator. Safe against commas in titles/tags
    // because tags usually have spaces.
    if (v.includes(',')) {
        const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
        const allPaths = parts.length > 1 && parts.every((p) => /[\\/]/.test(p) || /\.[a-z0-9]{1,6}$/i.test(p));
        if (allPaths) return parts;
    }
    return v;
}

function collectInput(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const a = argv();
    for (let i = 0; i < a.length; i++) {
        if (a[i] === '--input') {
            const pair = a[i + 1] ?? '';
            const eq = pair.indexOf('=');
            if (eq > 0) out[pair.slice(0, eq)] = coerce(pair.slice(eq + 1));
            i++;
        }
    }
    const jsonPath = value('json');
    if (jsonPath) {
        const abs = jsonPath.startsWith('{') ? null : jsonPath;
        const parsed = abs ? JSON.parse(fs.readFileSync(abs, 'utf8')) : JSON.parse(jsonPath);
        Object.assign(out, parsed);
    }
    return out;
}

function printList(category?: string): void {
    const plugins = all().filter((p) => !category || p.manifest.category === category);
    if (!plugins.length) {
        console.log(`No plugins found${category ? ` in category "${category}"` : ''}.`);
        return;
    }
    const groups = new Map<string, typeof plugins>();
    for (const p of plugins) {
        const list = groups.get(p.manifest.category) ?? [];
        list.push(p);
        groups.set(p.manifest.category, list);
    }
    for (const [cat, list] of groups) {
        console.log(`\n[${cat}]`);
        for (const p of list) {
            console.log(`  ${p.manifest.id.padEnd(24)} ${p.manifest.engine === 'python' ? '(py) ' : '     '} ${p.manifest.name}`);
        }
    }
    console.log(`\n${plugins.length} plugin(s).`);
}

function printDescribe(id: string): void {
    const p = all().find((x) => x.manifest.id === id);
    if (!p) {
        console.error(`No plugin "${id}". Run: forge list`);
        process.exit(1);
    }
    const m = p.manifest;
    console.log(`${m.id}  v${m.version}  [${m.category}] (${m.engine})`);
    console.log(`${m.name} — ${m.description}\n`);
    console.log('inputs:');
    for (const [k, spec] of Object.entries(m.inputs)) {
        const bits = [`${spec.type}`];
        if (spec.required) bits.push('required');
        if (spec.default !== undefined) bits.push(`default=${JSON.stringify(spec.default)}`);
        if (spec.enum) bits.push(`one of [${spec.enum.join('|')}]`);
        console.log(`  ${k.padEnd(18)} ${bits.join(', ')}`);
        if (spec.description) console.log(`  ${''.padEnd(18)} ${spec.description}`);
    }
    console.log('\noutputs:');
    for (const o of m.outputs) console.log(`  ${o.kind}${o.description ? ` — ${o.description}` : ''}`);
}

async function main(): Promise<void> {
    const a = argv();
    const cmd = a[0] ?? 'list';
    await ensureLoaded();

    if (cmd === 'list') {
        printList(value('category'));
        return;
    }
    if (cmd === 'categories') {
        for (const [cat, list] of byCategory()) console.log(`${cat.padEnd(14)} ${list.length}`);
        return;
    }
    if (cmd === 'describe') {
        printDescribe(a[1]);
        return;
    }
    if (cmd === 'steps') {
        // Replay an explicit list of steps supplied by the caller. This is a
        // batch convenience, NOT an orchestrator: there is no decision logic,
        // no retry, and no fallback — it stops at the first failure.
        const file = a[1];
        if (!file) {
            console.error('usage: forge steps <steps.json>');
            process.exit(2);
        }
        const steps = JSON.parse(fs.readFileSync(file, 'utf8')) as {
            steps: { plugin: string; input: Record<string, unknown> }[];
        };
        const results: OpResult[] = [];
        for (let i = 0; i < steps.steps.length; i++) {
            const stepDef = steps.steps[i];
            const result = await runPlugin({
                id: stepDef.plugin,
                input: stepDef.input ?? {},
                step: i + 1,
            });
            results.push(result);
            console.log(formatAck(result));
            if (!result.ok) {
                console.error(
                    `\nStopping at step ${i + 1} (${stepDef.plugin}). ` +
                        `${steps.steps.length - i - 1} remaining step(s) were NOT executed. ` +
                        `Nothing was substituted — fix the reported problem and run again.`,
                );
                break;
            }
        }
        const failed = results.filter((r) => !r.ok).length;
        process.exit(failed ? 1 : 0);
    }

    if (cmd === 'run') {
        const id = a[1];
        if (!id) {
            console.error('usage: forge run <plugin-id> [--input k=v] [--json file] [--step N]');
            process.exit(2);
        }
        const stepRaw = value('step');
        const result: OpResult = await runPlugin({
            id,
            input: collectInput(),
            step: stepRaw ? Number(stepRaw) : undefined,
        });
        console.log(formatAck(result));
        if (flag('json-out')) console.log(JSON.stringify(result, null, 2));
        process.exit(result.ok ? 0 : 1);
    }

    console.error(`Unknown command "${cmd}". Try: list | describe | run | categories`);
    process.exit(2);
}

main().catch((e) => {
    console.error(`forge failed: ${e?.stack ?? e}`);
    process.exit(1);
});
