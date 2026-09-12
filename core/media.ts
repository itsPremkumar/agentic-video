/**
 * core/media.ts — ffmpeg/ffprobe resolution and subprocess execution.
 *
 * No fallback logic: if ffmpeg cannot be resolved, the operation fails with a
 * clear, actionable error naming the missing binary.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { loadEnv, optionalEnv } from './env.ts';

export interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
}

function onPath(binary: string): boolean {
    const paths = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':');
    const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
    for (const dir of paths) {
        if (!dir) continue;
        for (const ext of exts) {
            try {
                if (fs.existsSync(`${dir}/${binary}${ext}`)) return true;
            } catch {
                /* ignore */
            }
        }
    }
    return false;
}

export class MissingBinary extends Error {
    constructor(binary: string) {
        super(
            `Required binary "${binary}" was not found. ` +
                `Install ffmpeg (which provides both ffmpeg and ffprobe) and ensure it is on PATH, ` +
                `or set FFMPEG_PATH / FFPROBE_PATH in .env.`,
        );
        this.name = 'MissingBinary';
    }
}

export function resolveFfmpeg(): string {
    loadEnv();
    const explicit = optionalEnv('FFMPEG_PATH');
    if (explicit) {
        if (!fs.existsSync(explicit)) throw new MissingBinary(explicit);
        return explicit;
    }
    if (!onPath('ffmpeg')) throw new MissingBinary('ffmpeg');
    return 'ffmpeg';
}

export function resolveFfprobe(): string {
    loadEnv();
    const explicit = optionalEnv('FFPROBE_PATH');
    if (explicit) {
        if (!fs.existsSync(explicit)) throw new MissingBinary(explicit);
        return explicit;
    }
    if (!onPath('ffprobe')) throw new MissingBinary('ffprobe');
    return 'ffprobe';
}

export function resolvePython(): string {
    loadEnv();
    return optionalEnv('VIDEOFORGE_PYTHON') ?? 'python';
}

export function run(
    cmd: string,
    args: string[],
    opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            cwd: opts.cwd,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d.toString()));
        child.stderr.on('data', (d) => (stderr += d.toString()));
        const timer = opts.timeoutMs
            ? setTimeout(() => {
                  child.kill('SIGKILL');
                  reject(new Error(`${cmd} timed out after ${opts.timeoutMs}ms`));
              }, opts.timeoutMs)
            : undefined;
        child.on('error', (err) => {
            if (timer) clearTimeout(timer);
            reject(err);
        });
        child.on('close', (code) => {
            if (timer) clearTimeout(timer);
            resolve({ code: code ?? -1, stdout, stderr });
        });
    });
}

/** Run ffmpeg and throw a detailed error on non-zero exit. */
export async function ffmpeg(args: string[], opts: { timeoutMs?: number } = {}): Promise<RunResult> {
    const bin = resolveFfmpeg();
    const res = await run(bin, ['-hide_banner', '-loglevel', 'error', ...args], {
        timeoutMs: opts.timeoutMs ?? 600_000,
    });
    if (res.code !== 0) {
        const err = new Error(`ffmpeg exited with code ${res.code}\n${res.stderr.trim()}`);
        (err as Error & { ffmpegArgs?: string[] }).ffmpegArgs = args;
        throw err;
    }
    return res;
}

/** Run ffprobe and return parsed JSON. */
export async function probe(file: string): Promise<Record<string, any>> {
    const bin = resolveFfprobe();
    const res = await run(bin, [
        '-v',
        'error',
        '-show_format',
        '-show_streams',
        '-of',
        'json',
        file,
    ]);
    if (res.code !== 0) {
        throw new Error(`ffprobe failed on "${file}": ${res.stderr.trim()}`);
    }
    return JSON.parse(res.stdout);
}

/** Convenience: duration in seconds for a media file. */
export async function durationOf(file: string): Promise<number> {
    const info = await probe(file);
    const d = info?.format?.duration;
    const n = typeof d === 'string' ? Number(d) : d;
    return Number.isFinite(n) ? n : 0;
}
