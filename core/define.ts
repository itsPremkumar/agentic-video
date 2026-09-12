/** core/define.ts — ergonomic helper for declaring a TypeScript plugin. */
import type {
    Artifact,
    ArtifactKind,
    FieldSpec,
    Plugin,
    PluginCategory,
    PluginRunArgs,
} from './types.ts';
import { PluginFailure } from './result.ts';

export interface PluginDefinition {
    id: string;
    name: string;
    category: PluginCategory;
    description: string;
    version?: string;
    inputs: Record<string, FieldSpec>;
    outputs?: ArtifactKind[];
    run(args: PluginRunArgs): Promise<{ outputs?: Artifact[]; warnings?: string[] }>;
}

export function definePlugin(def: PluginDefinition): Plugin {
    return {
        manifest: {
            id: def.id,
            name: def.name,
            category: def.category,
            description: def.description,
            version: def.version ?? '1.0.0',
            engine: 'ts',
            inputs: def.inputs,
            outputs: (def.outputs ?? []).map((kind) => ({ kind })),
        },
        run: def.run,
    };
}

/** Throw a structured, retryable failure for a missing required input file. */
export function missingFile(field: string, value: unknown): never {
    throw new PluginFailure({
        code: 'FILE_NOT_FOUND',
        message: `Input file for "${field}" does not exist: ${String(value)}`,
        reason: 'The path does not exist on disk.',
        input: { [field]: value },
        retryable: true,
        hint: 'Pass an absolute path, or a path relative to the project root.',
    });
}

export { PluginFailure };
