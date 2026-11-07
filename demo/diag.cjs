const { chromium } = require('playwright');
const path = require('path');

const BASE = 'https://second-notice.phosphor-bbs.duckdns.org';
const PROFILE = path.join(__dirname, '.profile');
const BUY =
  'input[value="完成购物"], input[value="Complete Purchase"], button:has-text("完成购物"), button:has-text("Complete Purchase")';

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('request', (r) => {
    const u = r.url();
    if (/webapps\/hermes\/.*\/(payment|checkout|funding)/.test(u) || /v1\/payments/.test(u)) console.log('  [req]', r.method(), u.slice(0, 120));
  });
  page.on('response', async (r) => {
    const u = r.url();
    if (/graphql|payments|funding|wallet/.test(u) && r.status() >= 400) console.log('  [http]', r.status(), u.slice(0, 120));
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
  console.log('review url', page.url().slice(0, 70));

  // what is under the click point?
  const info = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, input[type=submit]')];
    const el = els.find((e) => /完成购物|Complete Purchase/.test((e.innerText || e.value || '')));
    if (!el) return 'no element';
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { tag: el.tagName, id: el.id, box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      topTag: top && top.tagName, topId: top && top.id, topCls: top && (top.className || '').toString().slice(0, 60),
      sameNode: top === el || el.contains(top) };
  });
  console.log('geometry:', JSON.stringify(info));

  // DOM click, bypassing hit testing
  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, input[type=submit]')];
    const el = els.find((e) => /完成购物|Complete Purchase/.test((e.innerText || e.value || '')));
    if (!el) return 'none';
    el.click();
    return 'dom-clicked';
  });
  console.log(clicked);
  await page.waitForTimeout(8000);
  console.log('after dom click:', page.url().slice(0, 90));
  console.log('text:', (await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '))).slice(0, 200));
  await page.screenshot({ path: path.join(__dirname, 'probe-dom.png') });
  await ctx.close();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
