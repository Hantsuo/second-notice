const { chromium } = require('playwright');
const path = require('path');

const BASE = 'https://second-notice.phosphor-bbs.duckdns.org';
const PROFILE = path.join(__dirname, '.profile');

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  let live = false;
  page.on('request', (r) => {
    if (live && r.resourceType() === 'xhr') console.log('  >>', r.method(), r.url().slice(0, 110));
  });
  page.on('response', (r) => {
    if (live && r.request().resourceType() === 'xhr' && r.status() >= 400) console.log('  <<', r.status(), r.url().slice(0, 110));
  });

  await page.goto(BASE + '/dashboard');
  const res = await page.evaluate(async () => {
    const r = await fetch('/replay/subscription/I-JJ099CRDKRYV', { method: 'POST' });
    return r.json();
  });
  console.log('case', res.case);
  await page.goto(`${BASE}/r/${res.case}`);
  await page.getByRole('link', { name: /Pay .* now/ }).first().click();
  await page.waitForTimeout(5000);
  const accept = page.locator('#acceptAllButton').first();
  if (await accept.isVisible().catch(() => false)) await accept.click();
  const pw = page.locator('input[type=password]').first();
  if (await pw.isVisible().catch(() => false)) {
    await pw.fill('i)SuD56#');
    await page.locator('#btnLogin').first().click();
  }
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(5000);

  live = true;
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, input[type=submit]')];
    const el = els.find((e) => /完成购物|Complete Purchase/.test(e.innerText || e.value || ''));
    if (el) el.click();
  });
  for (const ms of [1000, 2500, 5000, 8000]) {
    await page.waitForTimeout(ms);
    const t = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 220));
    console.log(`[+${ms}] ${t}`);
    await page.screenshot({ path: path.join(__dirname, `probe-${ms}.png`) });
  }
  console.log('final url', page.url());
  await ctx.close();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
