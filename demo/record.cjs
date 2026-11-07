/*
 * Records the Second Notice demo video.
 *
 *   node record.cjs --warm     sign in to the PayPal Sandbox buyer once, keep cookies
 *   node record.cjs --record   run the full flow and record 1280x720 video
 *
 * Everything on screen is the production deployment; the only simulated part is
 * the failure event itself, which PayPal Sandbox cannot be told to produce.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'https://second-notice.phosphor-bbs.duckdns.org';
const SUB_ID = 'I-JJ099CRDKRYV';
const BUYER = 'sb-hgayk53772241@personal.example.com';
const BUYER_PW = 'i)SuD56#';
const PROXY = 'http://127.0.0.1:7897';

const HERE = __dirname;
const PROFILE = path.join(HERE, '.profile');
const RAW = path.join(HERE, 'raw');
const DO_WARM = process.argv.includes('--warm');
const DO_RECORD = process.argv.includes('--record');

const CSS = `
#sn-full{position:fixed;inset:0;z-index:2147483647;background:#0a0d12;color:#eef2f7;
  display:flex;flex-direction:column;justify-content:center;padding:0 86px;
  font-family:"Segoe UI",system-ui,-apple-system,sans-serif}
#sn-full .kicker{font-size:17px;letter-spacing:4px;text-transform:uppercase;color:#6f829a;margin-bottom:22px}
#sn-full .title{font-size:82px;font-weight:700;letter-spacing:-2px;line-height:1.02}
#sn-full .lede{font-size:27px;color:#9fb0c3;margin-top:20px;line-height:1.45;max-width:900px}
#sn-full .box{background:#0f1621;border:1px solid #1c2836;border-radius:14px;padding:30px 34px;margin-top:8px}
#sn-full .mono{font-family:Consolas,"Cascadia Mono",monospace;font-size:20px;line-height:1.62;
  color:#c7e0ff;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;max-width:1040px}
#sn-full .row{display:flex;gap:14px;align-items:baseline;font-size:26px;color:#c3d2e2;margin-top:12px}
#sn-full .dot{color:#3ddc97;font-size:26px}
#sn-cap{position:fixed;left:0;right:0;bottom:0;z-index:2147483647;padding:26px 40px 30px;
  background:linear-gradient(to top,rgba(0,0,0,.94),rgba(0,0,0,.72) 62%,rgba(0,0,0,0));
  color:#fff;font-family:"Segoe UI",system-ui,-apple-system,sans-serif}
#sn-cap .t{font-size:31px;font-weight:650;line-height:1.25}
#sn-cap .s{font-size:19px;color:#c9d4e0;margin-top:7px;line-height:1.4}
`;

async function style(page) {
  await page.evaluate((css) => {
    let s = document.getElementById('sn-style');
    if (!s) {
      s = document.createElement('style');
      s.id = 'sn-style';
      (document.head || document.documentElement).appendChild(s);
    }
    s.textContent = css;
  }, CSS);
}

async function caption(page, title, sub, ms) {
  await style(page);
  await page.evaluate(({ title, sub }) => {
    document.querySelectorAll('#sn-cap,#sn-full').forEach((e) => e.remove());
    const d = document.createElement('div');
    d.id = 'sn-cap';
    d.innerHTML = `<div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}`;
    document.body.appendChild(d);
  }, { title, sub });
  await page.waitForTimeout(ms);
}

async function scene(page, html, ms) {
  await style(page);
  await page.evaluate((html) => {
    document.querySelectorAll('#sn-cap,#sn-full').forEach((e) => e.remove());
    const d = document.createElement('div');
    d.id = 'sn-full';
    d.innerHTML = html;
    document.body.appendChild(d);
  }, html);
  await page.waitForTimeout(ms);
}

async function clearScene(page) {
  await page.evaluate(() => document.querySelectorAll('#sn-cap,#sn-full').forEach((e) => e.remove()));
}

async function replayCase(page) {
  return page.evaluate(async (sub) => {
    const r = await fetch('/replay/subscription/' + sub, { method: 'POST' });
    return r.json();
  }, SUB_ID);
}

async function dismissCookies(page) {
  const btn = page.locator('#acceptAllButton, button:has-text("Yes, I accept"), button:has-text("接受")').first();
  try {
    if (await btn.isVisible({ timeout: 2000 })) await btn.click();
  } catch {
    /* banner absent */
  }
}

async function paypalLoginIfNeeded(page) {
  await dismissCookies(page);
  const email = page.locator('input[type=email], input[name="login_email"]').first();
  const pw = page.locator('input[type=password]').first();

  if (await pw.isVisible().catch(() => false)) {
    if (await email.isVisible().catch(() => false)) {
      const current = await email.inputValue().catch(() => '');
      if (!current) await email.fill(BUYER);
    }
    await pw.fill(BUYER_PW);
    await page.locator('#btnLogin, button[type=submit]:has-text("登录"), button:has-text("登录"), button:has-text("Log In")').first().click();
    return true;
  }

  if (await email.isVisible().catch(() => false)) {
    await email.fill(BUYER);
    await page.locator('#btnNext, button:has-text("下一步"), button:has-text("Next")').first().click();
    await pw.waitFor({ state: 'visible', timeout: 25000 });
    await pw.fill(BUYER_PW);
    await page.locator('#btnLogin, button[type=submit]:has-text("登录"), button:has-text("登录"), button:has-text("Log In")').first().click();
    return true;
  }
  return false;
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  const VIDEO_START = Date.now();
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'msedge',
    headless: !DO_RECORD,
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
    recordVideo: DO_RECORD ? { dir: RAW, size: { width: 1280, height: 720 } } : undefined,
  });

  const page = ctx.pages()[0] || (await ctx.newPage());

  if (DO_WARM) {
    await page.goto('https://www.sandbox.paypal.com/signin', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await paypalLoginIfNeeded(page);
    await page.waitForTimeout(4000);
    console.log('warm: url =', page.url());
    console.log('warm: text =', (await page.evaluate(() => document.body.innerText)).slice(0, 160).replace(/\n/g, ' | '));
    await ctx.close();
    return;
  }

  if (process.argv.includes('--probe')) {
    await page.goto(BASE + '/dashboard');
    const res = await replayCase(page);
    console.log('case:', JSON.stringify(res));
    await page.goto(`${BASE}/r/${res.case}`);
    await page.getByRole('link', { name: /Pay .* now/ }).first().click();
    await page.waitForLoadState('domcontentloaded');
    const loggedIn = await paypalLoginIfNeeded(page);
    console.log('login form shown:', loggedIn, '| url:', page.url());
    await page.waitForTimeout(6000);
    const html = await page.evaluate(() => document.body.innerText.slice(0, 500));
    console.log('page:', html.replace(/\n/g, ' | '));
    await page.screenshot({ path: path.join(HERE, 'probe.png') });
    await ctx.close();
    return;
  }

  if (!DO_RECORD) {
    await page.goto(BASE + '/dashboard');
    console.log('probe ok:', (await page.evaluate(() => document.body.innerText)).slice(0, 120).replace(/\n/g, ' | '));
    await ctx.close();
    return;
  }

  const started = Date.now();
  await page.goto(BASE + '/healthz', { waitUntil: 'domcontentloaded' });
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });

  // 1 - title
  await scene(page, `
    <div class="kicker">PayPal AI Hackathon 2026</div>
    <div class="title">Second Notice</div>
    <div class="lede">Recover subscription revenue that PayPal already tried to charge.</div>
  `, 6500);
  await clearScene(page);

  // 2 - the problem, on the live dashboard
  await caption(page, 'A failed renewal is silent churn',
    'The card is declined, the customer never notices, and the revenue is gone.', 6000);
  await caption(page, 'Second Notice reads the signed webhook and opens a case',
    'BILLING.SUBSCRIPTION.PAYMENT.FAILED &rarr; amount, plan, payer, failure reason, one decision.', 6200);

  // 3 - real subscription, replay the failure
  const res = await replayCase(page);
  console.log('replay:', JSON.stringify(res));
  const body = JSON.stringify(res, null, 2);
  await scene(page, `
    <div class="kicker">Bound to a real PayPal subscription</div>
    <div class="box"><pre class="mono">POST /replay/subscription/${SUB_ID}

${body.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre></div>
    <div class="row" style="margin-top:22px">Real plan, real price, real payer &mdash; only the declined charge is simulated.</div>
  `, 7000);
  await clearScene(page);

  // 3b - the model makes the call
  await caption(page, 'The AI desk reads the case and picks the move',
    'Failure code, plan, amount, payer, attempt count &mdash; and the sentence the customer will read.', 2500);
  let ai = null;
  for (let i = 0; i < 30; i++) {
    const data = await page.evaluate(async () => (await (await fetch('/api/cases')).json()));
    ai = (data.cases || []).find((c) => c.id === res.case) || null;
    if (ai && ai.decided_by === 'ai') break;
    await page.waitForTimeout(1000);
  }
  console.log('ai:', JSON.stringify(ai));
  const aiJson = JSON.stringify(
    { decided_by: ai ? ai.decided_by : 'rules', strategy: ai ? ai.strategy : '', why: ai ? ai.rationale : '', message: ai ? ai.message : '' },
    null,
    2
  );
  await scene(page, `
    <div class="kicker">One decision, with the reason attached</div>
    <div class="box"><pre class="mono">${aiJson.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre></div>
    <div class="row" style="margin-top:22px">Rules are the guardrails: never retry a restricted account, never automate a whale.</div>
  `, 9000);
  await clearScene(page);

  // 4 - the customer's page
  const caseId = res.case;
  await page.goto(`${BASE}/r/${caseId}`, { waitUntil: 'domcontentloaded' });
  await caption(page, 'The customer gets one page, not a dunning email thread',
    `Case ${caseId} &middot; ${res.plan} &middot; $${res.amount} &middot; decision: ${res.strategy}`, 7000);

  // 5 - pay
  await page.getByRole('link', { name: /Pay .* now/ }).first().click();
  await page.waitForLoadState('domcontentloaded');
  const loggedIn = await paypalLoginIfNeeded(page);
  console.log('paypal login form:', loggedIn, page.url());
  await page.waitForSelector(
    'input[value="完成购物"], input[value="Complete Purchase"], button:has-text("完成购物"), button:has-text("Complete Purchase"), input[value="同意并订阅"], input[value="Agree and Subscribe"]',
    { timeout: 60000 }
  );
  await dismissCookies(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await caption(page, 'Checkout runs on PayPal', 'Sandbox buyer and sandbox card: no real money moves.', 5600);

  // The payer approves in the OpenBot browser (this Chromium cannot drive the
  // sandbox checkout button), so hand off the live URL and wait for the signal.
  fs.writeFileSync(path.join(HERE, 'current.json'), JSON.stringify({ case: caseId, url: page.url() }));
  const token = new URL(page.url()).searchParams.get('token');
  console.log('HANDOFF', caseId, token);
  const waitStart = Date.now();
  const signalFile = path.join(HERE, 'approved.json');
  for (let i = 0; i < 300; i++) {
    if (fs.existsSync(signalFile)) break;
    await page.waitForTimeout(1000);
  }
  const waitEnd = Date.now();
  console.log('approved signal after', Math.round((waitEnd - waitStart) / 1000), 's');
  fs.writeFileSync(
    path.join(HERE, 'markers.json'),
    JSON.stringify({ case: caseId, videoStart: VIDEO_START, waitStart, waitEnd }, null, 2)
  );

  // PayPal redirects the payer here once approved; capture, then re-activate.
  await page.goto(`${BASE}/r/${caseId}/return?token=${token}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector("text=You're all set", { timeout: 60000 });
  await page.waitForTimeout(500);
  await caption(page, 'Captured, then the subscription is re-activated',
    'POST /v1/billing/subscriptions/' + SUB_ID + '/activate', 6500);

  // 6 - the merchant sees the money
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await caption(page, 'Recovered MRR updates in place', 'Same case, same customer, no support ticket.', 8000);

  // 7 - end card
  await scene(page, `
    <div class="kicker">Second Notice</div>
    <div class="title" style="font-size:64px">Failed payment in. Recovered MRR out.</div>
    <div class="row" style="margin-top:28px"><span class="dot">&#9679;</span><span>Signed PayPal webhooks, verified per event</span></div>
    <div class="row"><span class="dot">&#9679;</span><span>Rule-based decision: retry, wait, split, update card, escalate</span></div>
    <div class="row"><span class="dot">&#9679;</span><span>Hosted recovery page, real PayPal orders and captures</span></div>
    <div class="row" style="margin-top:30px;color:#8fa3ba;font-size:22px">github.com/Hantsuo/second-notice &nbsp;&middot;&nbsp; second-notice.phosphor-bbs.duckdns.org</div>
  `, 9000);

  await ctx.close();
  console.log('recorded in', Math.round((Date.now() - started) / 1000), 's');
}

main().catch(async (e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
