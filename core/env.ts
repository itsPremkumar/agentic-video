/** core/env.ts — minimal .env loader (no dependencies). */
import * as fs from 'node:fs';
import * as path from 'node:path';

let loaded = false;

export function projectRoot(): string {
    // core/ lives directly under the project root.
    return path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
}

export function loadEnv(root: string = projectRoot()): void {
    if (loaded) return;
    loaded = true;
    const file = path.join(root, '.env');
    if (!fs.existsSync(file)) return;
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = val;
    }
}

export function requireEnv(key: string, purpose: string): string {
    loadEnv();
    const v = process.env[key];
    if (!v) {
        throw new Error(
            `Missing required environment variable ${key} (needed for ${purpose}). ` +
                `Set it in .env — see .env.example. No fallback provider will be used.`,
        );
    }
    return v;
}

export function optionalEnv(key: string): string | undefined {
    loadEnv();
    const v = process.env[key];
    return v && v.length > 0 ? v : undefined;
}

/**
 * First non-empty of `keys`, in order.
 *
 * Used so a renamed variable keeps working: pass the new name first and the
 * legacy name second, and both are honoured without a deprecation warning the
 * user has to act on.
 */
export function firstEnv(...keys: string[]): string | undefined {
    for (const k of keys) {
        const v = optionalEnv(k);
        if (v) return v;
    }
    return undefined;
}
