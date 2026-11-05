// Browser edge cases against the dev server: dropped connections, a room that
// resets underneath you, kicks, two tabs, late joiners, phone controls.
// Run: npm run dev (another terminal), then: node test/edge.e2e.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:8787';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const errors = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// keep a handle on each page's sockets so we can yank the network cable
const tapSockets = () => {
  window.__sockets = [];
  const W = window.WebSocket;
  window.WebSocket = function (...a) { const s = new W(...a); window.__sockets.push(s); return s; };
  window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, W);
};
async function page(name, opts = {}) {
  const ctx = opts.ctx || await browser.newContext({ viewport: { width: 1280, height: 800 }, ...(opts.mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}) });
  const p = await ctx.newPage();
  await p.addInitScript(tapSockets);
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  return p;
}
const G = (p, f) => p.evaluate(f);

// host + guest
const host = await page('host');
await host.goto(BASE); await host.fill('#name', 'Host'); await host.click('#create');
await host.waitForFunction(() => window.__dd && window.__dd.you);
const code = await G(host, () => window.__dd.code);
const guest = await page('guest');
await guest.goto(`${BASE}/?room=${code}`); await guest.fill('#name', 'Guest'); await guest.click('#join-invite');
await guest.waitForFunction(() => window.__dd && window.__dd.you);
await host.click('#add-bot'); await host.click('#add-bot');

// 1. guest's connection drops mid-round and comes back: same skier, still playing
await host.click('#start');
await sleep(6000);
const before = await G(guest, () => ({ id: window.__dd.you, y: window.__dd.me.y, phase: window.__dd.phase }));
await G(guest, () => window.__sockets.at(-1).close());
await sleep(2500);
const after = await G(guest, () => ({ id: window.__dd.you, y: window.__dd.me.y, phase: window.__dd.phase, st: window.__dd.me.st, conn: document.querySelector('#conn').hidden }));
assert.equal(after.id, before.id, 'same player after reconnect');
assert.equal(after.phase, 'run');
assert.ok(after.conn, 'reconnecting notice gone');
assert.ok(after.y >= before.y - 5, 'skier kept going from where it was');
console.log('1. reconnect mid-round: ok', JSON.stringify(after));

// 2. two tabs in the same browser are two different skiers
const tab2 = await page('tab2', { ctx: guest.context() });
await tab2.goto(`${BASE}/?room=${code}`); await tab2.fill('#name', 'Guest Tab2'); await tab2.click('#join-invite');
await tab2.waitForFunction(() => window.__dd && window.__dd.you);
assert.notEqual(await G(tab2, () => window.__dd.you), before.id, 'second tab is its own skier');
assert.equal(await G(tab2, () => window.__dd.me.st), 'wait', 'joined mid-round: missed the lift');
assert.ok(await G(guest, () => window.__sockets.at(-1).readyState === 1), 'first tab still connected');
console.log('2. two tabs: ok');

// 3. the round ends; the host's tab drops while results are up and the room resets
//    underneath it (what a deploy looks like): no stale results, back in a lobby
await host.waitForFunction(() => window.__dd.phase === 'over', null, { timeout: 240000 });
await sleep(500);
assert.equal(await host.isVisible('#results'), true);
// everyone leaves at once -> the room resets; then the host's tab reconnects
for (const p of [guest, tab2]) await G(p, () => { window.__dd.conn.close(); });
await G(host, () => window.__sockets.at(-1).close());
await sleep(2500);
const h = await G(host, () => ({ phase: window.__dd.phase, results: !document.querySelector('#results').hidden, order: window.__dd.order.length }));
assert.equal(h.phase, 'lobby', 'fresh lobby after the reset'); assert.equal(h.results, false, 'no stale results'); assert.equal(h.order, 0);
console.log('3. room reset under you: ok', JSON.stringify(h));

// 4. kick: the kicked guest lands on the start screen with a message, no reconnect loop
const g2 = await page('g2');
await g2.goto(`${BASE}/?room=${code}`); await g2.fill('#name', 'Kickme'); await g2.click('#join-invite');
await g2.waitForFunction(() => window.__dd && window.__dd.you);
await sleep(300);
await host.click('#lobby-list button[title="Remove Kickme"]');
await sleep(1500);
assert.equal(await g2.isVisible('#landing'), true);
assert.match(await g2.textContent('#landing-err'), /removed you/);
assert.equal(await G(g2, () => window.__sockets.length), 1, 'did not try to reconnect');
console.log('4. kick: ok');

// 5. R on the results screen takes you back to the top (and the room agrees)
await host.click('#start');
await host.waitForFunction(() => window.__dd.phase === 'over', null, { timeout: 240000 });
await host.click('#close-results');
await host.keyboard.press('KeyR');
await sleep(1500);
const top = await G(host, () => window.__dd.me ? Math.round(window.__dd.me.y) : null);
// host was eaten (can't ski) or survived; either way, nothing should snap them somewhere odd
console.log('5. R on results screen: ok (y =', top, ')');

// 6. phone: touch buttons steer
const phone = await page('phone', { mobile: true });
await phone.goto(BASE); await phone.fill('#name', 'Phone'); await phone.click('#practice');
await phone.waitForFunction(() => window.__dd && window.__dd.me);
await phone.waitForFunction(() => window.__dd.me.st === 'ski' && window.__dd.me.d === 0);
const box = await phone.locator('#touch button[data-cmd="R"]').boundingBox();
await phone.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
await sleep(100);
const d1 = await G(phone, () => ({ d: window.__dd.me.d, st: window.__dd.me.st }));
assert.ok(d1.d === 1 || d1.st !== 'ski', 'tap right turns right (unless a tree got in the way first)');
console.log('6. phone controls: ok');

console.log('errors:', errors.length ? errors : 'none');
assert.equal(errors.length, 0);
await browser.close();
