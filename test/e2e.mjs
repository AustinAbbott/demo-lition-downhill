// End-to-end: 3 real browser clients + bots play a full round on the dev server.
// Run: npm run dev (in another terminal), then: node test/e2e.mjs [screenshot dir]
// Needs Playwright (npx playwright install chromium) or CHROME_PATH=/path/to/chrome
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8787';
const OUT = process.argv[2] || '/tmp/dd-shots';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function client(name, color) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  return page;
}
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const host = await client('host');
await host.goto(BASE);
await sleep(400);
await shot(host, '01-landing');
await host.fill('#name', 'Austin');
await host.click('#create');
await host.waitForFunction(() => window.__dd && window.__dd.you);
const code = await host.evaluate(() => window.__dd.code);
console.log('room', code);

const p2 = await client('p2');
await p2.goto(`${BASE}/?room=${code}`);
await p2.fill('#name', 'Dana');
await p2.click('#join');
const p3 = await client('p3');
await p3.goto(`${BASE}/?room=${code}`);
await p3.fill('#name', 'Raj');
await p3.click('#join');
await p3.waitForFunction(() => window.__dd && window.__dd.you);

// host adds named bot + random bots
await host.fill('#bot-name', 'Priya (OOO)');
await host.click('#add-bot');
await host.click('#add-bot');
await host.click('#add-bot');
await sleep(300);
// warm up: host skis a bit in the lobby
await host.keyboard.press('ArrowRight');
await sleep(1500);
await shot(host, '02-lobby-host');
await shot(p2, '03-lobby-guest');

await host.click('#start');
await sleep(1200);
await shot(host, '04-countdown');
await sleep(2300);

// host & Raj steer to survive; Dana goes AFK
async function driver(page, stopAt) {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'Space'];
  while (Date.now() < stopAt) {
    const st = await page.evaluate(() => window.__dd.phase);
    if (st !== 'run') break;
    await page.keyboard.press(keys[Math.floor(Math.random() * keys.length)]);
    await sleep(250 + Math.random() * 300);
  }
}
const until = Date.now() + 240000;
const d1 = driver(host, until), d2 = driver(p3, until);
await sleep(4000);
await shot(host, '05-run-early');
await sleep(12000);
await shot(host, '06-creep-loose');
await shot(p2, '07-dana-spectating');
// grab a few more frames during the chase
for (let i = 0; i < 4; i++) { await sleep(6000); await shot(host, `08-chase-${i}`); }
await host.waitForFunction(() => window.__dd.phase === 'over', null, { timeout: 240000 });
await Promise.all([d1, d2]);
await sleep(500);
await shot(host, '09-results-host');
await shot(p2, '10-results-guest');
const final = await host.evaluate(() => window.__dd.final.map(f => f.name));
console.log('final order:', final.join(' > '));
await host.click('#again');
await sleep(600);
await shot(host, '11-back-to-lobby');

// a late joiner during a round
await host.click('#start');
await sleep(5000);
const late = await client('late');
await late.goto(`${BASE}/?room=${code}`);
await late.fill('#name', 'Late Lou');
await late.click('#join');
await sleep(1500);
await shot(late, '12-late-joiner');
console.log('late missed list:', await host.evaluate(() => window.__dd.missed.length));

// mobile practice mode
const mctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const mob = await mctx.newPage();
mob.on('pageerror', (e) => errors.push(`mobile: ${e.message}`));
await mob.goto(BASE);
await mob.fill('#name', 'Phone');
await mob.click('#practice');
await sleep(1200);
await shot(mob, '13-mobile-practice-lobby');

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
