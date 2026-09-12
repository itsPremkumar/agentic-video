import { definePlugin, PluginFailure } from '../../core/define.ts';
import { launch, runActions, type Action } from '../../core/playwright.ts';
import { S } from '../_shared/common.ts';

/**
 * browser.act — drive a website: navigate, click, type, scroll, wait, shoot.
 *
 * This is the "actually use the site" plugin. Playwright auto-waits for every
 * element to be visible, stable and enabled before touching it, so scripts do
 * not need manual sleeps — the main source of flaky browser automation.
 *
 * Actions are a plain list the calling agent builds, e.g.:
 *   [{type:'navigate',url:'https://…'},
 *    {type:'fill', target:{label:'Search'}, value:'lofi'},
 *    {type:'press', key:'Enter'},
 *    {type:'scroll', dy:1200},
 *    {type:'screenshot', name:'results.png'}]
 */
export default definePlugin({
    id: 'browser.act',
    name: 'Drive a website (click / type / scroll)',
    category: 'browser',
    description: 'Run a list of browser actions (navigate, click, fill, type, press, hover, select, scroll, wait, evaluate, screenshot) with Playwright auto-waiting.',
    inputs: {
        actions: S.array('Ordered list of actions — see the plugin docs for the shape', { required: true }),
        url: S.string('Optional start URL (shorthand for a leading navigate action)'),
        width: S.int('Viewport width', { default: 1440, minimum: 200 }),
        height: S.int('Viewport height', { default: 900, minimum: 200 }),
        scale: S.number('Device scale factor', { default: 1, minimum: 0.5, maximum: 3 }),
        headless: S.bool('Run headless', { default: true }),
        slowMo: S.int('Slow each action down by N ms (useful when watching)', { default: 0, minimum: 0 }),
        darkMode: S.bool('Emulate prefers-color-scheme: dark', { default: false }),
        settleMs: S.int('Settle time after the last action, ms', { default: 500, minimum: 0 }),
        out: S.string('Output file name for the final screenshot', { default: 'act.png' }),
    },
    outputs: ['image', 'json'],
    async run({ input, ctx }) {
        const raw = input.actions;
        if (!Array.isArray(raw) || !raw.length) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: '"actions" must be a non-empty array.',
                retryable: true,
                hint: 'e.g. [{type:"navigate",url:"https://example.com"},{type:"scroll",dy:800},{type:"screenshot",name:"a.png"}]',
            });
        }
        const actions = raw as Action[];
        if (input.url) actions.unshift({ type: 'navigate', url: String(input.url) });

        const session = await launch({
            width: Number(input.width ?? 1440),
            height: Number(input.height ?? 900),
            scale: Number(input.scale ?? 1),
            headless: input.headless !== false,
            slowMo: Number(input.slowMo ?? 0),
            colorScheme: input.darkMode ? 'dark' : undefined,
        });

        try {
            const { page } = session;
            const shots: string[] = [];
            const log = await runActions(page, actions, {
                outDir: ctx.workspaceDir,
                out: (name: string) => ctx.out(name),
                onLog: (e) => {
                    if (e.type === 'screenshot' && e.detail) shots.push(e.detail);
                },
            });

            if (Number(input.settleMs ?? 0) > 0) await page.waitForTimeout(Number(input.settleMs));
            const dest = ctx.out(String(input.out ?? 'act.png'));
            await page.screenshot({ path: dest });
            shots.push(dest);

            const logPath = ctx.out('actions.json');
            const { default: fs } = await import('node:fs');
            await fs.promises.writeFile(logPath, JSON.stringify(log, null, 2), 'utf8');

            return {
                outputs: [
                    { path: dest, kind: 'image' as const, meta: { url: page.url(), title: await page.title() } },
                    { path: logPath, kind: 'json' as const, meta: { actions: log.length } },
                ],
                warnings: shots.length > 1 ? undefined : undefined,
            };
        } finally {
            await session.close();
        }
    },
});
