const { chromium } = require('playwright');
const path = require('path');

const BASE = 'https://second-notice.phosphor-bbs.duckdns.org';
const PROFILE = path.join(__dirname, '.profile');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      const t = m.text();
      if (!/CORS|Content Security|Permissions policy|preflight/.test(t)) console.log('  [console]', t.slice(0, 200));
    }
  });

  await page.goto(BASE + '/dashboard');
  const res = await page.evaluate(async () => {
    const r = await fetch('/replay/subscription/I-JJ099CRDKRYV', { method: 'POST' });
    return r.json();
  });
  console.log('case', res.case);
  await page.goto(`${BASE}/r/${res.case}`);
  await page.getByRole('link', { name: /Pay .* now/ }).first().click();
  await sleep(4000);
  const accept = page.locator('#acceptAllButton').first();
  if (await accept.isVisible().catch(() => false)) await accept.click();
  const pw = page.locator('input[type=password]').first();
  if (await pw.isVisible().catch(() => false)) {
    await pw.fill('i)SuD56#');
    await page.locator('#btnLogin').first().click();
  }
  await sleep(9000);
  console.log('--- clicking purchase ---');
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, input[type=submit]')].find((e) =>
      /完成购物|Complete Purchase/.test(e.innerText || e.value || '')
    );
    if (el) el.click();
  });
  for (let i = 0; i < 8; i++) {
    await sleep(5000);
    const t = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 140));
    console.log('  +' + (i + 1) * 5 + 's ' + page.url().slice(0, 55) + ' :: ' + t);
    if (page.url().includes('second-notice')) break;
  }
  console.log('url', page.url().slice(0, 80));
  await ctx.close();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
