/**
 * core/loader.ts — discovers and registers every plugin.
 *
 * TypeScript plugins : plugins/**\/*.ts  (default export = definePlugin(...))
 * Python plugins     : plugins/**\/*.py  (module-level MANIFEST + run(payload, ctx))
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectRoot } from './env.ts';
import { register, clear, all } from './registry.ts';
import { describePythonPlugins } from './python.ts';
import type { Artifact, Plugin, PluginManifest } from './types.ts';

function walk(dir: string, exts: string[]): string[] {
    const out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(p, exts));
        else if (exts.some((e) => entry.name.endsWith(e))) out.push(p);
    }
    return out;
}

/** Wrap a Python module into a Plugin whose run() delegates over the bridge. */
function pythonPlugin(manifest: PluginManifest, modulePath: string): Plugin {
    return {
        manifest,
        async run({ input, ctx, step }) {
            const res = await (
                await import('./python.ts')
            ).runPythonPlugin(modulePath, input, {
                workspaceDir: ctx.workspaceDir,
                out: ctx.out('placeholder'),
                ffmpeg: ctx.ffmpeg,
                ffprobe: ctx.ffprobe,
                step,
            });
            if (!res.ok) {
                // Re-throw as PluginFailure so the runner produces a normal FAILED ack.
                const e = new Error(res.error?.message ?? 'python plugin failed');
                (e as Error & { opError?: unknown }).opError = res.error;
                throw e;
            }
            return {
                outputs: (res.outputs ?? []) as unknown as Artifact[],
                warnings: res.warnings ?? [],
            };
        },
    };
}

export async function loadPlugins(root: string = projectRoot()): Promise<Plugin[]> {
    clear();
    const pluginsDir = path.join(root, 'plugins');

    // --- TypeScript ---
    const tsFiles = walk(pluginsDir, ['.ts']).filter((f) => !f.endsWith('.test.ts'));
    for (const file of tsFiles) {
        const mod = await import(pathToFileURL(file).href);
        const def = mod.default;
        if (def && typeof def === 'object' && 'manifest' in def) {
            register(def as Plugin);
        }
    }

    // --- Python (single discovery subprocess) ---
    const pyFiles = walk(pluginsDir, ['.py']).filter((f) => !path.basename(f).startsWith('_'));
    if (pyFiles.length) {
        const manifests = await describePythonPlugins(pyFiles);
        for (const m of manifests) {
            const mod = pyFiles.find((f) => f.endsWith(path.normalize(m.module ?? '')));
            if (mod) register(pythonPlugin(m, mod));
        }
    }

    return all();
}
