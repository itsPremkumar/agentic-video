/** core/artifacts.ts — deterministic artifact storage under workspace/. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projectRoot } from './env.ts';

const MIME: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.srt': 'application/x-subrip',
    '.vtt': 'text/vtt',
    '.json': 'application/json',
    '.txt': 'text/plain',
};

export function workspaceDir(root: string = projectRoot()): string {
    const dir = path.join(root, 'workspace');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

export function mimeFor(file: string): string | undefined {
    return MIME[path.extname(file).toLowerCase()];
}

/**
 * Create a per-plugin output directory and return a path factory.
 *
 * Path resolution rules (this is the single source of truth for output paths,
 * so every plugin — TS and Python alike — behaves the same):
 *
 *   - empty / missing            -> `<pluginDir>/output`
 *   - absolute path              -> used as-is
 *   - contains `/` or `\`        -> resolved relative to cwd (the caller gave
 *                                   a real path; do NOT nest it inside
 *                                   `<pluginDir>` or we get the classic
 *                                   `artifacts/<plugin>/workspace/...` bug)
 *   - bare filename (no sep)     -> `<pluginDir>/<name>` (keeps re-runs tidy)
 */
export function makeOut(ws: string, pluginId: string): (name: string) => string {
    const dir = path.join(ws, 'artifacts', pluginId.replace(/[^a-zA-Z0-9._-]/g, '_'));
    fs.mkdirSync(dir, { recursive: true });
    return (name: string) => {
        const n = String(name ?? '').trim();
        if (!n) return path.join(dir, 'output');
        if (path.isAbsolute(n)) return n;
        if (n.includes('/') || n.includes('\\')) return path.resolve(n);
        return path.join(dir, n);
    };
}

export function assertFile(p: string, label = 'input file'): string {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) {
        throw new Error(`${label} not found: ${abs}`);
    }
    return abs;
}

export function fileSize(p: string): number {
    return fs.existsSync(p) ? fs.statSync(p).size : 0;
}

export function safeName(s: string): string {
    return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}
