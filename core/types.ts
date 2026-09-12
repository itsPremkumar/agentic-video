/**
 * core/types.ts — the Agentic Video contract.
 *
 * Design rule: every operation is explicit and individually acknowledged.
 * There is no orchestrator, no planner, and no silent fallback anywhere in
 * this system. A plugin either succeeds and returns artifacts, or it fails
 * and returns a structured explanation.
 */

export type PluginCategory =
    | 'image'
    | 'video'
    | 'audio'
    | 'voice'
    | 'music'
    | 'subtitle'
    | 'effects'
    | 'transitions'
    | 'render'
    | 'export'
    | 'analyze'
    | 'qc'
    | 'brand'
    | 'fx'
    | 'distribute'
    | 'edit'
    | 'browser';

export type ArtifactKind = 'image' | 'video' | 'audio' | 'subtitle' | 'data' | 'text' | 'json';

export type Engine = 'ts' | 'python';

export type FieldType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';

export interface FieldSpec {
    type: FieldType;
    required?: boolean;
    description?: string;
    default?: unknown;
    enum?: string[];
    minimum?: number;
    maximum?: number;
}

export interface OutputSpec {
    kind: ArtifactKind;
    description?: string;
}

export interface PluginManifest {
    id: string;
    name: string;
    category: PluginCategory;
    description: string;
    version: string;
    engine: Engine;
    inputs: Record<string, FieldSpec>;
    outputs: OutputSpec[];
    /** Python plugins: importable module path relative to the project root. */
    module?: string;
}

export interface Artifact {
    path: string;
    kind: ArtifactKind;
    mime?: string;
    meta?: Record<string, unknown>;
}

export interface PluginContext {
    /** Absolute path to the writable workspace (artifacts live here). */
    workspaceDir: string;
    /** Reserve a deterministic output path inside the workspace. */
    out(name: string): string;
    ffmpeg: string;
    ffprobe: string;
    python: string;
    env: NodeJS.ProcessEnv;
    log(message: string): void;
}

export interface PluginRunArgs {
    /** Raw, validated input for this plugin. */
    input: Record<string, unknown>;
    ctx: PluginContext;
    /** Optional step number supplied by the caller (for human-readable acks). */
    step?: number;
}

/** Structured failure. Never swallowed, never converted into a fallback. */
export interface OpError {
    code: string;
    message: string;
    /** Human-readable explanation of *why* it failed, when known. */
    reason?: string;
    /** The input value(s) that caused the failure. */
    input?: unknown;
    /** stderr, traceback, or underlying error text. */
    detail?: string;
    /** Whether re-running with corrected input could plausibly succeed. */
    retryable: boolean;
    /** Suggested correction. */
    hint?: string;
}

export interface OpResult {
    ok: boolean;
    step?: number;
    plugin: string;
    operation: string;
    category?: PluginCategory;
    outputs: Artifact[];
    warnings: string[];
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    error?: OpError;
}

/** What a plugin returns on success. Anything thrown becomes a FAILED result. */
export interface PluginRunResult {
    outputs?: Artifact[];
    warnings?: string[];
}

export interface Plugin {
    manifest: PluginManifest;
    run(args: PluginRunArgs): Promise<PluginRunResult>;
}
