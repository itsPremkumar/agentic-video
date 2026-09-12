/**
 * plugins/_shared/common.ts — tiny helpers shared by plugins.
 * This file intentionally exports no plugin of its own.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PluginFailure } from '../../core/define.ts';
import type { FieldSpec } from '../../core/types.ts';

export const S = {
    string(description: string, extra: Partial<FieldSpec> = {}): FieldSpec {
        return { type: 'string', description, ...extra };
    },
    number(description: string, extra: Partial<FieldSpec> = {}): FieldSpec {
        return { type: 'number', description, ...extra };
    },
    int(description: string, extra: Partial<FieldSpec> = {}): FieldSpec {
        return { type: 'integer', description, ...extra };
    },
    bool(description: string, extra: Partial<FieldSpec> = {}): FieldSpec {
        return { type: 'boolean', description, ...extra };
    },
    array(description: string, extra: Partial<FieldSpec> = {}): FieldSpec {
        return { type: 'array', description, ...extra };
    },
    object(description: string, extra: Partial<FieldSpec> = {}): FieldSpec {
        return { type: 'object', description, ...extra };
    },
};

/** Resolve and verify an input media file. */
export function requireFile(value: unknown, field: string): string {
    const p = typeof value === 'string' ? path.resolve(value) : '';
    if (!p || !fs.existsSync(p)) {
        throw new PluginFailure({
            code: 'FILE_NOT_FOUND',
            message: `Input file for "${field}" does not exist: ${String(value)}`,
            reason: 'The path does not exist on disk.',
            input: { [field]: value },
            retryable: true,
            hint: 'Use an absolute path, or a path relative to the project root.',
        });
    }
    return p;
}

/**
 * Reject bad input the same way every plugin does.
 *
 * Throwing a bare `Error` here is a trap: the runner cannot tell it apart from
 * a real crash, so it reports `PLUGIN_ERROR` with **retry: no** and a stack
 * trace. Bad input is the most recoverable failure there is — it must come
 * back as `INVALID_INPUT` / retryable so the driving agent just corrects the
 * call instead of giving up.
 */
export function invalidInput(
    message: string,
    opts: { field?: string; value?: unknown; hint?: string } = {},
): never {
    throw new PluginFailure({
        code: 'INVALID_INPUT',
        message,
        reason: message,
        input: opts.field ? { [opts.field]: opts.value } : undefined,
        retryable: true,
        hint: opts.hint,
    });
}

export function ensureParentDir(p: string): string {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    return p;
}

/**
 * Resolve an "output path" input against ctx.out() + plugin artifact dir.
 *
 * Behaviour:
 *   - empty/null -> defaults to a bare filename and uses ctx.out
 *   - absolute path or anything containing a separator -> treated as "user
 *     gave a path", resolved relative to cwd (NOT wrapped in plugin subdir)
 *   - bare filename (no separator) -> wrapped via ctx.out() into the
 *     per-plugin artifact subdir (so re-runs land next to previous outputs)
 *
 * This avoids the recurring "workspace/artifacts/<plugin>/workspace/..."
 * nesting bug for plugins that take path-shaped outputs.
 */
export function resolveOutPath(
    ctx: { out: (name: string) => string },
    userOut: string,
): string {
    const u = String(userOut ?? '').trim();
    if (!u) return ctx.out('output');
    const hasSep = u.includes('/') || u.includes('\\');
    const isAbs = path.isAbsolute(u);
    if (hasSep || isAbs) return path.resolve(u);
    return ctx.out(u);
}

/**
 * Turn an arbitrary URL fragment / id into something usable as a filename part.
 *
 * Provider URLs often carry query strings (Wikimedia appends
 * `?utm_source=...&utm_content=original`), and `?`, `:`, `*` etc. are illegal in
 * Windows paths — writing them raises ENOENT, which is a very confusing failure.
 */
export function safeFilePart(value: unknown, fallback = 'asset'): string {
    let v = String(value ?? '').trim();
    v = v.split(/[?#]/)[0]; // drop query string and fragment
    const last = v.split(/[\\/]/).pop() ?? '';
    v = last.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^[._]+/, '').slice(0, 120);
    return v || fallback;
}

/** Extension for an output filename, ignoring any query string. */
export function safeExt(url: string, fallback = '.bin'): string {
    try {
        const m = String(url).split(/[?#]/)[0].match(/(\.[a-zA-Z0-9]{1,6})$/);
        return m ? m[1].toLowerCase() : fallback;
    } catch {
        return fallback;
    }
}

/** Replace/normalise an output extension. */
export function withExt(p: string, ext: string): string {
    const base = p.replace(/\.[^.\\/]+$/, '');
    return `${base}.${ext.replace(/^\./, '')}`;
}

export function num(v: unknown, fallback: number): number {
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

export function str(v: unknown, fallback = ''): string {
    return typeof v === 'string' ? v : fallback;
}
