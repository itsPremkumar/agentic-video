import type { Artifact, OpError, OpResult, Plugin, PluginManifest, PluginRunArgs } from './types.ts';

const started = () => new Date();

/**
 * Thrown by plugins to produce a structured, actionable failure.
 * The runner converts it into OpResult.error — it is never swallowed and
 * never triggers an alternative code path.
 */
export class PluginFailure extends Error {
    readonly code: string;
    readonly reason?: string;
    readonly input?: unknown;
    readonly detail?: string;
    readonly retryable: boolean;
    readonly hint?: string;

    constructor(opts: {
        code: string;
        message: string;
        reason?: string;
        input?: unknown;
        detail?: string;
        retryable?: boolean;
        hint?: string;
    }) {
        super(opts.message);
        this.name = 'PluginFailure';
        this.code = opts.code;
        this.reason = opts.reason;
        this.input = opts.input;
        this.detail = opts.detail;
        this.retryable = opts.retryable ?? false;
        this.hint = opts.hint;
    }
}

function base(
    plugin: PluginManifest,
    args: PluginRunArgs,
    t0: Date,
): Pick<OpResult, 'step' | 'plugin' | 'operation' | 'category' | 'startedAt'> {
    return {
        step: args.step,
        plugin: plugin.id,
        operation: plugin.name,
        category: plugin.category,
        startedAt: t0.toISOString(),
    };
}

export function succeed(
    plugin: PluginManifest,
    args: PluginRunArgs,
    t0: Date,
    outputs: Artifact[] = [],
    warnings: string[] = [],
): OpResult {
    const t1 = new Date();
    return {
        ok: true,
        ...base(plugin, args, t0),
        outputs,
        warnings,
        finishedAt: t1.toISOString(),
        durationMs: t1.getTime() - t0.getTime(),
    };
}

export function fail(
    plugin: PluginManifest,
    args: PluginRunArgs,
    t0: Date,
    error: OpError,
    outputs: Artifact[] = [],
): OpResult {
    const t1 = new Date();
    return {
        ok: false,
        ...base(plugin, args, t0),
        outputs,
        warnings: [],
        finishedAt: t1.toISOString(),
        durationMs: t1.getTime() - t0.getTime(),
        error,
    };
}

export { started };

/** "Step 1 → image.download (Download stock images) → SUCCESS  [820ms]" */
export function formatAck(r: OpResult): string {
    const step = r.step !== undefined ? `Step ${r.step} → ` : '';
    const line = `${step}${r.plugin} (${r.operation}) → ${r.ok ? 'SUCCESS' : 'FAILED'}  [${r.durationMs}ms]`;
    if (!r.ok && r.error) {
        return [
            line,
            `    reason : ${r.error.reason ?? r.error.message}`,
            `    code   : ${r.error.code}`,
            r.error.input !== undefined ? `    input  : ${JSON.stringify(r.error.input)}` : null,
            r.error.hint ? `    hint   : ${r.error.hint}` : null,
            `    retry  : ${r.error.retryable ? 'yes (with corrected input)' : 'no'}`,
            r.error.detail ? `    detail : ${String(r.error.detail).split('\n').slice(0, 6).join('\n              ')}` : null,
        ]
            .filter(Boolean)
            .join('\n');
    }
    const extra = r.outputs.length ? `    output : ${r.outputs.map((o: Artifact) => o.path).join(', ')}` : null;
    return extra ? `${line}\n${extra}` : line;
}
