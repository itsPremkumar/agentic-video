/** Shared device presets + helpers for the browser.* plugins. Not a plugin. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PluginFailure } from '../../core/define.ts';

export const DEVICES: Record<string, { width: number; height: number; label: string }> = {
    desktop: { width: 1920, height: 1080, label: 'Desktop 1080p' },
    laptop: { width: 1440, height: 900, label: 'Laptop' },
    tablet: { width: 834, height: 1112, label: 'Tablet portrait' },
    tabletLandscape: { width: 1112, height: 834, label: 'Tablet landscape' },
    mobile: { width: 390, height: 844, label: 'Phone portrait' },
    mobileLandscape: { width: 844, height: 390, label: 'Phone landscape' },
    '4k': { width: 3840, height: 2160, label: '4K' },
};

export const DEVICE_NAMES = Object.keys(DEVICES);

/** Resolve a URL or a local file path into something Chromium can open. */
export function resolveTarget(raw: string): string {
    const s = String(raw ?? '').trim();
    if (!s) {
        throw new PluginFailure({
            code: 'INVALID_INPUT',
            message: 'url is required.',
            retryable: true,
            hint: 'Pass an http(s) URL, a local .html file path, or "file" plus html markup.',
        });
    }
    if (/^https?:\/\//i.test(s) || s.startsWith('file://') || s.startsWith('data:')) return s;
    const abs = path.resolve(s);
    if (fs.existsSync(abs)) return 'file:///' + abs.replace(/\\/g, '/');
    if (/^[\w.-]+\.[a-z]{2,}$/i.test(s)) return 'https://' + s;
    throw new PluginFailure({
        code: 'TARGET_NOT_FOUND',
        message: `Could not resolve "${s}" to a URL or an existing local file.`,
        input: { url: s },
        retryable: true,
        hint: 'Pass a full http(s) URL or a path to a local .html file.',
    });
}
