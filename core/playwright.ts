/**
 * core/playwright.ts — Playwright-backed browser automation.
 *
 * Why this exists alongside core/browser.ts:
 *
 * core/browser.ts is a hand-rolled CDP client with zero dependencies. It is
 * perfect for "render this HTML and screenshot it" — the image-creation case.
 * It is NOT good at driving real websites: there is no auto-waiting, no
 * locator engine, and every interaction needs manual waitForSelector plumbing,
 * which is how flaky automation scripts are born.
 *
 * Playwright (the 2026 default for browser automation — auto-waiting, resilient
 * locators, cross-engine, and native video recording) is the right tool for
 * "open a website, scroll it, click things, record it". It is an optional
 * dependency: if it is not installed the plugins fail with MISSING_DEPENDENCY
 * and an install hint rather than crashing on import.
 *
 * This is infrastructure, not a plugin and not an orchestrator.
 */
import * as path from 'node:path';
import { PluginFailure } from './define.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/**
 * Import Playwright lazily.
 *
 * Importing at module load would break `forge list` for anyone who has not
 * installed it — the loader imports every plugin file, so a hard import would
 * take the whole registry down for an optional feature.
 */
export async function loadPlaywright(): Promise<Any> {
    try {
        return await import('playwright');
    } catch {
        throw new PluginFailure({
            code: 'MISSING_DEPENDENCY',
            message: 'Playwright is not installed, so advanced browser automation is unavailable.',
            reason: "The optional 'playwright' package could not be imported.",
            retryable: false,
            hint: 'Run: npm install playwright && npx playwright install chromium  (the core/browser.ts CDP plugins still work without it).',
        });
    }
}

export interface Viewport {
    width: number;
    height: number;
    scale?: number;
}

export interface LaunchOpts extends Viewport {
    headless?: boolean;
    /** Where Playwright should write recorded video. Enables recording. */
    videoDir?: string;
    /** Extra Chromium flags. */
    args?: string[];
    /** Ignore HTTPS errors — needed for some staging/intranet sites. */
    ignoreHttpsErrors?: boolean;
    /** Slow each action down by this many ms (makes recordings readable). */
    slowMo?: number;
    userAgent?: string;
    locale?: string;
    colorScheme?: 'light' | 'dark' | 'no-preference';
}

export interface Session {
    pw: Any;
    browser: Any;
    context: Any;
    page: Any;
    /** Always call this — video files are only finalised on context close. */
    close(): Promise<void>;
}

export async function launch(opts: LaunchOpts): Promise<Session> {
    const pw = await loadPlaywright();
    const browser = await pw.chromium.launch({
        // Playwright's default headless mode (Chrome Headless Shell) does not
        // support video recording. When a videoDir is requested, fall back to
        // full Chromium in headed mode — that is the combination that
        // produces a webm.
        headless: opts.videoDir ? false : opts.headless ?? true,
        slowMo: opts.slowMo ?? 0,
        args: ['--disable-dev-shm-usage', '--mute-audio', ...(opts.args ?? [])],
    });
    const context = await browser.newContext({
        viewport: { width: opts.width, height: opts.height },
        deviceScaleFactor: opts.scale ?? 1,
        ignoreHTTPSErrors: opts.ignoreHttpsErrors ?? false,
        userAgent: opts.userAgent,
        locale: opts.locale,
        colorScheme: opts.colorScheme,
        ...(opts.videoDir
            ? { recordVideo: { dir: opts.videoDir, size: { width: opts.width, height: opts.height } } }
            : {}),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(45_000);
    return {
        pw, browser, context, page,
        async close() {
            await context.close().catch(() => {});
            await browser.close().catch(() => {});
        },
    };
}

/* ------------------------------------------------------------------ targets */

/**
 * A target describes how to find an element.
 *
 * Prefer `text` / `role` / `label` over raw CSS: they survive DOM churn and
 * read like what a human would look for, which is what an agent is reasoning
 * about. CSS and XPath remain available as escape hatches.
 */
export interface Target {
    css?: string;
    text?: string;
    role?: string;
    roleName?: string;
    label?: string;
    placeholder?: string;
    testId?: string;
    xpath?: string;
    /** Index when several elements match. */
    nth?: number;
}

export function targetToLocator(page: Any, t: Target): Any {
    if (!t || typeof t !== 'object') {
        throw new PluginFailure({
            code: 'INVALID_INPUT',
            message: 'An action is missing its target.',
            retryable: true,
            hint: 'Give each click/type/hover action a target: {css|text|role|label|placeholder|testId|xpath}.',
        });
    }
    let loc: Any;
    if (t.testId) loc = page.getByTestId(t.testId);
    else if (t.label) loc = page.getByLabel(t.label);
    else if (t.placeholder) loc = page.getByPlaceholder(t.placeholder);
    else if (t.role) loc = page.getByRole(t.role, t.roleName ? { name: t.roleName } : undefined);
    else if (t.text) loc = page.getByText(t.text);
    else if (t.css) loc = page.locator(t.css);
    else if (t.xpath) loc = page.locator(`xpath=${t.xpath}`);
    else {
        throw new PluginFailure({
            code: 'INVALID_INPUT',
            message: `Target ${JSON.stringify(t)} has no selector.`,
            retryable: true,
            hint: 'Use one of: css, text, role (+roleName), label, placeholder, testId, xpath.',
        });
    }
    return typeof t.nth === 'number' ? loc.nth(t.nth) : loc;
}

/* ------------------------------------------------------------------ actions */

export type Action =
    | { type: 'navigate'; url: string; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }
    | { type: 'click'; target: Target; timeout?: number }
    | { type: 'dblclick'; target: Target }
    | { type: 'fill'; target: Target; value: string }
    | { type: 'type'; target: Target; text: string; delay?: number }
    | { type: 'press'; key: string; target?: Target }
    | { type: 'hover'; target: Target }
    | { type: 'select'; target: Target; value: string }
    | { type: 'check'; target: Target }
    | { type: 'uncheck'; target: Target }
    | { type: 'scroll'; dy?: number; y?: number; x?: number; target?: Target; smooth?: boolean; step?: number }
    | { type: 'wait'; ms?: number; target?: Target; state?: 'visible' | 'hidden' | 'attached' | 'detached' }
    | { type: 'evaluate'; js: string }
    | { type: 'screenshot'; name: string; fullPage?: boolean };

export interface ActionLog {
    index: number;
    type: string;
    ok: boolean;
    detail?: string;
}

export interface RunActionsOpts {
    /** Where screenshots land; required for `screenshot` actions. */
    outDir: string;
    out(name: string): string;
    /** Called after each action so callers can add narration/logging. */
    onLog?(entry: ActionLog): void;
}

/**
 * Execute a list of actions against a page.
 *
 * Stops at the first failure and reports which action failed and why — the
 * caller surfaces that as an OpResult so the driving agent can fix just that
 * step. Playwright's auto-waiting means no manual sleeps are needed.
 */
export async function runActions(page: Any, actions: Action[], opts: RunActionsOpts): Promise<ActionLog[]> {
    const log: ActionLog[] = [];

    for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        const entry: ActionLog = { index: i + 1, type: a.type, ok: true };
        try {
            switch (a.type) {
                case 'navigate':
                    await page.goto(a.url, { waitUntil: a.waitUntil ?? 'load' });
                    entry.detail = a.url;
                    break;

                case 'click':
                    await targetToLocator(page, a.target).click({ timeout: a.timeout });
                    break;

                case 'dblclick':
                    await targetToLocator(page, a.target).dblclick();
                    break;

                case 'fill':
                    await targetToLocator(page, a.target).fill(a.value);
                    break;

                case 'type':
                    await targetToLocator(page, a.target).pressSequentially(a.text, { delay: a.delay ?? 30 });
                    break;

                case 'press':
                    if (a.target) await targetToLocator(page, a.target).press(a.key);
                    else await page.keyboard.press(a.key);
                    break;

                case 'hover':
                    await targetToLocator(page, a.target).hover();
                    break;

                case 'select':
                    await targetToLocator(page, a.target).selectOption(a.value);
                    break;

                case 'check':
                    await targetToLocator(page, a.target).check();
                    break;

                case 'uncheck':
                    await targetToLocator(page, a.target).uncheck();
                    break;

                case 'scroll':
                    entry.detail = await scroll(page, a);
                    break;

                case 'wait':
                    if (a.ms) await page.waitForTimeout(a.ms);
                    if (a.target) await targetToLocator(page, a.target).waitFor({ state: a.state ?? 'visible' });
                    if (!a.ms && !a.target) await page.waitForTimeout(500);
                    break;

                case 'evaluate': {
                    // eslint-disable-next-line no-new-func
                    const fn = new Function('page', `return (async () => { ${a.js} })()`);
                    const v = await fn(page);
                    entry.detail = v === undefined ? undefined : String(v).slice(0, 200);
                    break;
                }

                case 'screenshot': {
                    const dest = opts.out(a.name);
                    await page.screenshot({ path: dest, fullPage: a.fullPage ?? false });
                    entry.detail = dest;
                    break;
                }

                default:
                    throw new PluginFailure({
                        code: 'UNKNOWN_ACTION',
                        message: `Unsupported action type "${(a as { type: string }).type}".`,
                        retryable: true,
                        hint: 'Supported: navigate, click, dblclick, fill, type, press, hover, select, check, uncheck, scroll, wait, evaluate, screenshot.',
                    });
            }
        } catch (e) {
            entry.ok = false;
            entry.detail = (e as Error).message?.split('\n')[0] ?? String(e);
            log.push(entry);
            opts.onLog?.(entry);
            throw new PluginFailure({
                code: 'ACTION_FAILED',
                message: `Action ${i + 1} (${a.type}) failed: ${entry.detail}`,
                reason: (e as Error).message ?? 'The browser action did not complete.',
                input: { index: i + 1, action: a },
                retryable: true,
                hint: 'Check the target still exists on the page. Prefer text/role/label selectors over brittle CSS.',
            });
        }
        log.push(entry);
        opts.onLog?.(entry);
    }
    return log;
}

/**
 * Scroll the page.
 *
 * A single jump to the bottom makes a useless recording — you only see the
 * destination. `step` scrolls in increments so the video actually shows the
 * page moving, which is the whole point of a website walkthrough.
 */
async function scroll(page: Any, a: Extract<Action, { type: 'scroll' }>): Promise<string> {
    if (a.target) {
        await targetToLocator(page, a.target).scrollIntoViewIfNeeded();
        return 'scrolled target into view';
    }
    if (typeof a.y === 'number' || typeof a.x === 'number') {
        // globalThis cast: this runs in the page, and this project compiles
        // without the DOM lib on purpose.
        await page.evaluate(
            ([x, y, smooth]: [number, number, boolean]) => {
                const w = (globalThis as unknown as { scrollTo: (o: unknown) => void }).scrollTo;
                w.call(globalThis, { left: x, top: y, behavior: smooth ? 'smooth' : 'auto' });
            },
            [a.x ?? 0, a.y ?? 0, a.smooth ?? true],
        );
        return `scrolled to (${a.x ?? 0}, ${a.y ?? 0})`;
    }

    const dy = a.dy ?? 600;
    const step = a.step ?? Math.max(80, Math.round(Math.abs(dy) / 8));
    const dir = dy < 0 ? -1 : 1;
    let moved = 0;
    const total = Math.abs(dy);
    while (moved < total) {
        const delta = Math.min(step, total - moved) * dir;
        await page.mouse.wheel(0, delta);
        moved += Math.abs(delta);
        await page.waitForTimeout(60);
    }
    return `scrolled ${dy}px in ${Math.ceil(total / step)} step(s)`;
}

/**
 * Resolve where Playwright finalised the recorded .webm.
 *
 * `video.path()` returns a Promise<string | undefined> on newer Playwright
 * versions — it is not resolved synchronously even after context.close().
 * Awaiting it is the difference between a 0-byte failure and a real file.
 */
export async function videoPath(video: Any): Promise<string | null> {
    try {
        const p = video?.path?.();
        const v = p instanceof Promise ? await p : p;
        return typeof v === 'string' && v ? path.resolve(v) : null;
    } catch {
        return null;
    }
}
