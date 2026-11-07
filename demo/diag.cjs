const { chromium } = require('playwright');
const path = require('path');

const BASE = 'https://second-notice.phosphor-bbs.duckdns.org';
const PROFILE = path.join(__dirname, '.profile');

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1280, height: 720 },
    proxy: { server: 'http://127.0.0.1:7897' },
    locale: 'en-US',
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const res = await page.evaluate(async () => {
    const r = await fetch('https://second-notice.phosphor-bbs.duckdns.org/replay/subscription/I-JJ099CRDKRYV', { method: 'POST' });
    return r.json();
  }).catch(async () => {
    await page.goto(BASE + '/dashboard');
    return page.evaluate(async () => {
      const r = await fetch('/replay/subscription/I-JJ099CRDKRYV', { method: 'POST' });
      return r.json();
    });
  });
  console.log('case', JSON.stringify(res));
  await page.goto(`${BASE}/r/${res.case}`);
  await page.getByRole('link', { name: /Pay .* now/ }).first().click();
  await page.waitForTimeout(7000);
  console.log('url', page.url());
  const dump = await page.evaluate(() => ({
    text: document.body.innerText.slice(0, 700),
    inputs: [...document.querySelectorAll('input,button')].map((e) => ({
      tag: e.tagName,
      type: e.type,
      name: e.name,
      id: e.id,
      value: (e.value || '').slice(0, 40),
      text: (e.innerText || '').trim().slice(0, 40),
      visible: e.offsetParent !== null,
    })).filter((e) => e.visible).slice(0, 25),
  }));
  console.log(JSON.stringify(dump, null, 1));
  await page.screenshot({ path: path.join(__dirname, 'probe.png') });
  await ctx.close();
})();
