const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const BASE = 'https://second-notice.phosphor-bbs.duckdns.org';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = path.join(__dirname, '.edge-profile');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const proc = spawn(EDGE, [
    '--remote-debugging-port=9333',
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-position=0,0',
    '--window-size=1300,820',
    'about:blank',
  ], { detached: true, stdio: 'ignore' });

  let browser;
  for (let i = 0; i < 40; i++) {
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
      break;
    } catch {
      await sleep(500);
    }
  }
  if (!browser) throw new Error('cdp connect failed');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] || (await ctx.newPage());
  console.log('webdriver:', await page.evaluate(() => navigator.webdriver));

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

  const emailBox = page.locator('input[type=email], input[name="login_email"]').first();
  if (await emailBox.isVisible().catch(() => false)) {
    const cur = await emailBox.inputValue().catch(() => '');
    if (!cur) await emailBox.fill('sb-hgayk53772241@personal.example.com');
    const next = page.locator('#btnNext, button:has-text("下一步"), button:has-text("Next"), input[value="Next"]').first();
    if (await next.isVisible().catch(() => false)) {
      await next.click();
      await sleep(3500);
      console.log('step1 done, url', page.url().slice(0, 70));
    }
  }

  const pw = page.locator('input[type=password]').first();
  if (await pw.isVisible().catch(() => false)) {
    await pw.fill('i)SuD56#');
    await page.locator('#btnLogin').first().click();
    console.log('logged in');
  }
  await sleep(9000);
  console.log('url', page.url().slice(0, 80));
  console.log('text', (await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '))).slice(0, 180));

  const buy = page.locator('button:has-text("完成购物"), button:has-text("Complete Purchase")').first();
  console.log('buy visible', await buy.isVisible().catch(() => false));
  await buy.click({ timeout: 15000 }).catch((e) => console.log('click err', e.message.slice(0, 80)));
  await sleep(8000);
  console.log('after click:', page.url().slice(0, 90));
  console.log('text', (await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '))).slice(0, 200));
  await page.screenshot({ path: path.join(__dirname, 'probe-cdp.png') });
  await ctx.close().catch(() => {});
  await browser.close().catch(() => {});
  try { process.kill(-proc.pid); } catch {}
  try { proc.kill(); } catch {}
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
