/** core/registry.ts — in-memory plugin registry. */
import type { Plugin, PluginCategory } from './types.ts';

const registry = new Map<string, Plugin>();

export function register(plugin: Plugin): void {
    if (registry.has(plugin.manifest.id)) {
        throw new Error(`Duplicate plugin id: ${plugin.manifest.id}`);
    }
    registry.set(plugin.manifest.id, plugin);
}

export function get(id: string): Plugin | undefined {
    return registry.get(id);
}

export function all(): Plugin[] {
    return [...registry.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

export function byCategory(): Map<PluginCategory, Plugin[]> {
    const map = new Map<PluginCategory, Plugin[]>();
    for (const p of all()) {
        const list = map.get(p.manifest.category) ?? [];
        list.push(p);
        map.set(p.manifest.category, list);
    }
    return map;
}

export function clear(): void {
    registry.clear();
}
