/** core/validate.ts — input validation for plugin calls. */
import { PluginFailure } from './result.ts';
import type { FieldSpec, PluginManifest } from './types.ts';

function typeOk(spec: FieldSpec, value: unknown): boolean {
    switch (spec.type) {
        case 'string':
            return typeof value === 'string';
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'integer':
            return typeof value === 'number' && Number.isInteger(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'array':
            return Array.isArray(value);
        case 'object':
            return typeof value === 'object' && value !== null && !Array.isArray(value);
        default:
            return false;
    }
}

/**
 * Validate and normalise inputs. Throws PluginFailure (never silently defaults
 * over bad input) so the caller sees exactly which field was wrong.
 */
export function validateInputs(
    manifest: PluginManifest,
    raw: Record<string, unknown>,
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const problems: string[] = [];

    for (const [key, spec] of Object.entries(manifest.inputs)) {
        const has = Object.prototype.hasOwnProperty.call(raw, key);
        let value = has ? raw[key] : spec.default;

        if (!has && spec.default === undefined) {
            if (spec.required) problems.push(`"${key}" is required (${spec.type})`);
            continue;
        }
        if (value === undefined || value === null) continue;
        if (!typeOk(spec, value)) {
            problems.push(`"${key}" must be ${spec.type}, received ${Array.isArray(value) ? 'array' : typeof value}`);
            continue;
        }
        if (spec.enum && !spec.enum.includes(String(value))) {
            problems.push(`"${key}" must be one of [${spec.enum.join(', ')}], received "${String(value)}"`);
            continue;
        }
        if (typeof value === 'number') {
            if (spec.minimum !== undefined && value < spec.minimum) problems.push(`"${key}" must be >= ${spec.minimum}`);
            if (spec.maximum !== undefined && value > spec.maximum) problems.push(`"${key}" must be <= ${spec.maximum}`);
        }
        out[key] = value;
    }

    for (const key of Object.keys(raw)) {
        if (!(key in manifest.inputs)) problems.push(`"${key}" is not a recognised input for ${manifest.id}`);
    }

    if (problems.length) {
        throw new PluginFailure({
            code: 'INVALID_INPUT',
            message: `Invalid input for plugin "${manifest.id}": ${problems.join('; ')}`,
            reason: problems.join('; '),
            input: raw,
            retryable: true,
            hint: `Run: forge describe ${manifest.id}  (to see the accepted inputs)`,
        });
    }
    return out;
}
