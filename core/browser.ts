/**
 * core/browser.ts — a minimal, zero-dependency Chrome DevTools Protocol client.
 *
 * Why this exists: HTML5 Canvas, SVG, CSS animation and any other browser tech
 * are legitimate ways to CREATE images, motion graphics and animation. This
 * module gives plugins the ability to drive a real Chromium instance without
 * pulling in puppeteer/playwright — Node 22 ships a global WebSocket, so we
 * speak CDP directly.
 *
 * This is infrastructure (like core/media.ts is for ffmpeg), NOT a plugin and
 * NOT an orchestrator. It performs exactly what it is asked and fails loudly.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { PluginFailure } from './define.ts';
import { firstEnv } from './env.ts';

/**
 * Chrome locations, resolved lazily.
 *
 * This used to be a module-level const, which meant `.env` was never honoured:
 * the array was built at import time, before anything called loadEnv(). Building
 * it per call is cheap (a handful of stat()s) and fixes that.
 */
function candidates(): string[] {
    return [
        firstEnv('AGENTIC_VIDEO_CHROME', 'VIDEOFORGE_CHROME', 'CHROME_PATH') ?? '',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ].filter(Boolean);
}

/** Locate a usable Chromium binary. Returns null when none is installed. */
export function findChrome(): string | null {
    for (const c of candidates()) {
        try {
            if (c && fs.existsSync(c)) return c;
        } catch {
            /* keep looking */
        }
    }
    return null;
}

export function requireChrome(): string {
    const exe = findChrome();
    if (!exe) {
        throw new PluginFailure({
            code: 'CHROME_NOT_FOUND',
            message: 'No Chromium-based browser found on this machine.',
            reason: 'This plugin renders in a real browser and needs Chrome, Edge or Chromium installed.',
            retryable: false,
            hint: 'Install Google Chrome, or set AGENTIC_VIDEO_CHROME to your browser executable path.',
        });
    }
    return exe;
}

export interface BrowserOptions {
    width: number;
    height: number;
    /** Device scale factor — 2 doubles the pixel dimensions. */
    scale?: number;
    /** Transparent background (PNG only). */
    transparent?: boolean;
}

interface Pending {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
}

/**
 * A single headless Chromium instance driven over CDP.
 * Always call close() — use it inside try/finally.
 */
export class Browser {
    private ws: WebSocket | null = null;
    private proc: ChildProcess | null = null;
    private sessionId = '';
    private nextId = 1;
    private pending = new Map<number, Pending>();
    private listeners: ((ev: { method: string; params: Record<string, unknown> }) => void)[] = [];
    private tmpDir = '';

    // ---------------------------------------------------------------- lifecycle

    static async launch(opts: BrowserOptions): Promise<Browser> {
        const b = new Browser();
        await b.start(opts);
        return b;
    }

    private async start(opts: BrowserOptions): Promise<void> {
        const exe = requireChrome();
        this.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticvideo-chrome-'));
        const port = 0; // let the OS choose; Chrome prints the real port

        this.proc = spawn(
            exe,
            [
                '--headless=new',
                `--remote-debugging-port=${port}`,
                `--user-data-dir=${this.tmpDir}`,
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-extensions',
                '--disable-background-networking',
                '--disable-sync',
                '--mute-audio',
                '--hide-scrollbars',
                '--force-device-scale-factor=1',
                '--allow-file-access-from-files',
                '--autoplay-policy=no-user-gesture-required',
                ...(opts.transparent ? ['--default-background-color=00000000'] : []),
                '--disable-gpu',
                'about:blank',
            ],
            { stdio: ['ignore', 'pipe', 'pipe'] },
        );

        const wsUrl = await this.waitForDevToolsUrl();
        await this.connect(wsUrl);

        const { targetId } = (await this.send('Target.createTarget', { url: 'about:blank' })) as {
            targetId: string;
        };
        const attached = (await this.send('Target.attachToTarget', { targetId, flatten: true })) as {
            sessionId: string;
        };
        this.sessionId = attached.sessionId;

        await this.send('Page.enable');
        await this.send('Runtime.enable');
        await this.setViewport(opts);
    }

    private waitForDevToolsUrl(timeoutMs = 30_000): Promise<string> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(
                    new PluginFailure({
                        code: 'CHROME_START_TIMEOUT',
                        message: 'Chromium did not expose a DevTools endpoint within 30s.',
                        retryable: true,
                        hint: 'Try increasing the timeout or check that no stale Chrome instance is holding the profile.',
                    }),
                );
            }, timeoutMs);

            const scan = (chunk: Buffer | string) => {
                const m = /DevTools listening on (ws:\/\/\S+)/.exec(String(chunk));
                if (m) {
                    clearTimeout(timer);
                    resolve(m[1]);
                }
            };
            this.proc?.stderr?.on('data', scan);
            this.proc?.stdout?.on('data', scan);
            this.proc?.once('exit', (code) => {
                clearTimeout(timer);
                reject(
                    new PluginFailure({
                        code: 'CHROME_EXITED',
                        message: `Chromium exited during startup with code ${code}.`,
                        retryable: true,
                    }),
                );
            });
        });
    }

    private connect(url: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url);
            this.ws = ws;
            const timer = setTimeout(() => reject(new Error('CDP websocket connect timeout')), 15_000);
            ws.addEventListener('open', () => {
                clearTimeout(timer);
                resolve();
            });
            ws.addEventListener('error', (e) => {
                clearTimeout(timer);
                reject(new Error(`CDP websocket error: ${String((e as { message?: unknown }).message ?? e)}`));
            });
            ws.addEventListener('message', (ev) => {
                let msg: { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string } };
                try {
                    msg = JSON.parse(String((ev as MessageEvent).data));
                } catch {
                    return;
                }
                if (msg.id && this.pending.has(msg.id)) {
                    const p = this.pending.get(msg.id)!;
                    this.pending.delete(msg.id);
                    if (msg.error) p.reject(new Error(msg.error.message));
                    else p.resolve(msg.result);
                    return;
                }
                if (msg.method) for (const fn of this.listeners) fn({ method: msg.method, params: msg.params ?? {} });
            });
        });
    }

    private send(method: string, params: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<unknown> {
        return new Promise((resolve, reject) => {
            if (!this.ws) return reject(new Error('Browser is not connected'));
            const id = this.nextId++;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new PluginFailure({ code: 'CDP_TIMEOUT', message: `CDP command "${method}" timed out.`, retryable: true }));
            }, timeoutMs);
            this.pending.set(id, {
                resolve: (v) => {
                    clearTimeout(timer);
                    resolve(v);
                },
                reject: (e) => {
                    clearTimeout(timer);
                    reject(e);
                },
            });
            this.ws.send(JSON.stringify({ id, method, params, sessionId: this.sessionId || undefined }));
        });
    }

    // ------------------------------------------------------------------ actions

    async setViewport(opts: BrowserOptions): Promise<void> {
        await this.send('Emulation.setDeviceMetricsOverride', {
            width: opts.width,
            height: opts.height,
            deviceScaleFactor: opts.scale ?? 1,
            mobile: false,
        });
    }

    /** Load a file:// URL or any http(s) URL and wait for the load event. */
    async open(url: string, timeoutMs = 60_000): Promise<void> {
        const loaded = new Promise<void>((resolve) => {
            const fn = (ev: { method: string }) => {
                if (ev.method === 'Page.loadEventFired') {
                    this.listeners = this.listeners.filter((x) => x !== fn);
                    resolve();
                }
            };
            this.listeners.push(fn);
        });
        await this.send('Page.navigate', { url });
        await Promise.race([
            loaded,
            new Promise((_, rej) =>
                setTimeout(
                    () => rej(new PluginFailure({ code: 'PAGE_LOAD_TIMEOUT', message: `Timed out loading ${url}`, retryable: true })),
                    timeoutMs,
                ),
            ),
        ]);
    }

    /**
     * Load raw HTML by writing it to a temp file first (avoids escaping bugs).
     * `baseDir` controls where the temp file lands, so relative asset paths
     * (./photo.png) inside the markup resolve against the project workspace.
     */
    async setContent(html: string, baseDir?: string): Promise<void> {
        const dir = baseDir && fs.existsSync(baseDir) ? baseDir : this.tmpDir;
        const file = path.join(dir, `vf_page_${Math.random().toString(36).slice(2)}.html`);
        fs.writeFileSync(file, html, 'utf8');
        try {
            await this.open('file:///' + file.replace(/\\/g, '/'));
        } finally {
            try {
                fs.unlinkSync(file);
            } catch {
                /* ignore */
            }
        }
    }

    /** Evaluate JS in the page and return the JSON-serialisable result. */
    async eval<T = unknown>(expression: string): Promise<T> {
        const res = (await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
        })) as { exceptionDetails?: { text?: string; exception?: { description?: string } }; result?: { value: T } };
        if (res.exceptionDetails) {
            throw new PluginFailure({
                code: 'PAGE_SCRIPT_ERROR',
                message: 'The page script threw an error.',
                reason: res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? 'unknown',
                retryable: true,
                hint: 'Fix the JavaScript passed to this plugin and run it again.',
            });
        }
        return res.result?.value as T;
    }

    /** Capture the current frame to a PNG file. */
    async screenshot(dest: string, transparent = false): Promise<void> {
        const res = (await this.send('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            omitBackground: transparent,
        })) as { data: string };
        if (!res?.data) throw new PluginFailure({ code: 'SCREENSHOT_FAILED', message: 'Chromium returned no image data.', retryable: true });
        fs.writeFileSync(dest, Buffer.from(res.data, 'base64'));
    }

    /** Render the current page to a PDF file. */
    async printPdf(dest: string, opts: { landscape?: boolean; printBackground?: boolean } = {}): Promise<void> {
        const res = (await this.send('Page.printToPDF', {
            landscape: opts.landscape ?? false,
            printBackground: opts.printBackground ?? true,
            preferCSSPageSize: false,
        })) as { data: string };
        if (!res?.data) {
            throw new PluginFailure({ code: 'PDF_FAILED', message: 'Chromium returned no PDF data.', retryable: true });
        }
        fs.writeFileSync(dest, Buffer.from(res.data, 'base64'));
    }

    /** Full scrollable height of the document (for full-page captures). */
    async contentHeight(): Promise<number> {
        return await this.eval<number>('Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)');
    }

    /** Resize the viewport to the full document height so a screenshot captures everything. */
    async captureFullPage(dest: string, transparent = false): Promise<void> {
        const h = await this.contentHeight();
        const current = await this.eval<number>('window.innerWidth');
        await this.setViewport({ width: current, height: Math.max(h, 1) });
        await this.screenshot(dest, transparent);
    }

    /** Poll a JS predicate until it is truthy. Used for waitForSelector-style waits. */
    async waitFor(expression: string, timeoutMs = 15_000, intervalMs = 150): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const ready = await this.eval<boolean>(`Boolean(${expression})`);
            if (ready) return;
            await new Promise((r) => setTimeout(r, intervalMs));
        }
        throw new PluginFailure({
            code: 'WAIT_TIMEOUT',
            message: `Condition did not become true within ${timeoutMs}ms.`,
            reason: expression,
            retryable: true,
            hint: 'Increase waitMs or check the selector / condition you passed.',
        });
    }

    /** Idle-wait: give the page time to finish fonts, images and layout. */
    async settle(ms: number): Promise<void> {
        if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    }

    async close(): Promise<void> {
        try {
            this.ws?.close();
        } catch {
            /* ignore */
        }
        this.ws = null;
        try {
            this.proc?.kill('SIGKILL');
        } catch {
            /* ignore */
        }
        this.proc = null;
        try {
            if (this.tmpDir) fs.rmSync(this.tmpDir, { recursive: true, force: true });
        } catch {
            /* ignore */
        }
    }
}

/**
 * Render a frame sequence with a headless browser.
 *
 * `pageHtml` must define `globalThis.__vfSeek(frame, totalFrames)` which draws
 * the given frame deterministically. Each frame is drawn, captured, and written
 * to <dir>/f00000.png. No timing tricks — every frame is seeked explicitly, so
 * output is deterministic regardless of machine speed.
 */
export async function captureFrames(opts: {
    dir: string;
    pageHtml: string;
    totalFrames: number;
    width: number;
    height: number;
    transparent?: boolean;
    /** Directory the temp page is written into, so relative asset paths work. */
    baseDir?: string;
    onFrame?: (frame: number, total: number) => void;
}): Promise<string[]> {
    fs.mkdirSync(opts.dir, { recursive: true });
    const browser = await Browser.launch({ width: opts.width, height: opts.height, transparent: opts.transparent });
    const files: string[] = [];
    try {
        await browser.setContent(opts.pageHtml, opts.baseDir);
        const ready = await browser.eval<boolean>('typeof window.__vfSeek === "function"');
        if (!ready) {
            throw new PluginFailure({
                code: 'MISSING_SEEK_FUNCTION',
                message: 'The page does not define window.__vfSeek(frame, totalFrames).',
                retryable: true,
                hint: 'Your animation code must expose a seek function so frames can be captured deterministically.',
            });
        }
        for (let i = 0; i < opts.totalFrames; i++) {
            await browser.eval(`window.__vfSeek(${i}, ${opts.totalFrames})`);
            const file = path.join(opts.dir, `f${String(i).padStart(6, '0')}.png`);
            await browser.screenshot(file, opts.transparent);
            files.push(file);
            opts.onFrame?.(i, opts.totalFrames);
        }
    } finally {
        await browser.close();
    }
    return files;
}
