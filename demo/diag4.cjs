const { chromium } = require('playwright');
const path = require('path');

const BASE = 'https://second-notice.phosphor-bbs.duckdns.org';
const PROFILE = path.join(__dirname, '.profile');

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'msedge',
    headless: true,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('requestfailed', (r) => console.log('  [FAIL]', (r.failure() || {}).errorText, r.url().slice(0, 110)));
  page.on('response', (r) => {
    const st = r.status();
    if (st >= 400) console.log('  [HTTP]', st, r.request().resourceType(), r.url().slice(0, 110));
  });

  await page.goto(BASE + '/dashboard');
  const res = await page.evaluate(async () => {
    const r = await fetch('/replay/subscription/I-JJ099CRDKRYV', { method: 'POST' });
    return r.json();
  });
  await page.goto(`${BASE}/r/${res.case}`);
  console.log('--- pay click ---');
  await page.getByRole('link', { name: /Pay .* now/ }).first().click();
  await page.waitForTimeout(8000);
  const accept = page.locator('#acceptAllButton').first();
  if (await accept.isVisible().catch(() => false)) await accept.click();
  console.log('--- login ---');
  const pw = page.locator('input[type=password]').first();
  if (await pw.isVisible().catch(() => false)) {
    await pw.fill('i)SuD56#');
    await page.locator('#btnLogin').first().click();
  }
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const diag = await page.evaluate(() => ({
    wd: navigator.webdriver,
    ua: navigator.userAgent.slice(0, 80),
    scripts: [...document.querySelectorAll('script[src]')].length,
    btnListenersHidden: typeof window.xo === 'undefined' ? 'no window.xo' : 'xo present',
    reactRoots: document.querySelectorAll('[data-reactroot]').length,
  }));
  console.log('diag', JSON.stringify(diag));
  console.log('url', page.url().slice(0, 80));
  await ctx.close();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
