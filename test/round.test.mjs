// Headless check: a full round with bots ends with a complete, unique demo order.
// Run: node test/round.test.mjs
import assert from 'node:assert/strict';
import { RoomLogic } from '../public/js/room.js';

let fakeNow = 0;
function runRound(nBots) {
  const room = new RoomLogic('TEST', { now: () => fakeNow });
  const inbox = [];
  const host = { send: (s) => inbox.push(JSON.parse(s)), close() {} };
  room.attach(host);
  clearInterval(room.timer); // drive the clock by hand
  room.message(host, JSON.stringify({ t: 'join', name: 'Host', id: 'host01', create: true }));
  for (let i = 0; i < nBots; i++) room.message(host, JSON.stringify({ t: 'bot' }));
  room.message(host, JSON.stringify({ t: 'start' }));
  // the host is AFK at the start line -> should be eaten first
  let t = 0;
  while (room.phase !== 'over' && t < 600) { room.tick(0.05); t += 0.05; fakeNow += 50; }
  const eats = inbox.filter(m => m.t === 'ev' && m.k === 'eat');
  const over = inbox.find(m => m.t === 'phase' && m.ph === 'over');
  return { t, eats, over, room };
}

const durations = [];
for (let trial = 0; trial < 8; trial++) {
  const n = 11;
  const { t, eats, over } = runRound(n);
  assert.ok(over, 'round should end');
  assert.equal(over.final.length, n + 1, 'everyone appears in the order once');
  assert.equal(new Set(over.final.map(f => f.id)).size, n + 1);
  assert.equal(over.final[0].id, 'host01', 'AFK host is eaten first');
  assert.equal(eats.length, n, 'all but the survivor get eaten');
  durations.push(t);
}
console.log('12-skier round durations (s):', durations.map(d => d.toFixed(1)).join(', '));

// room codes: joining a code nobody created fails; creating claims it; a taken code is refused
{
  const room = new RoomLogic('ABCD', { now: () => fakeNow });
  const box = (arr) => ({ send: (s) => arr.push(JSON.parse(s)), close() { this.closed = true; } });
  const a = [], b = [], c = [], d = [];
  const wa = box(a); room.attach(wa); clearInterval(room.timer);
  room.message(wa, JSON.stringify({ t: 'join', name: 'Typo', id: 'typo01' }));
  assert.equal(a[0].t, 'error'); assert.equal(a[0].code, 'noroom'); assert.ok(wa.closed);
  const wb = box(b); room.attach(wb); clearInterval(room.timer);
  room.message(wb, JSON.stringify({ t: 'join', name: 'Host', id: 'host02', create: true }));
  assert.equal(b[0].t, 'hello');
  const wc = box(c); room.attach(wc); clearInterval(room.timer);
  room.message(wc, JSON.stringify({ t: 'join', name: 'Guest', id: 'gst001' }));
  assert.equal(c[0].t, 'hello');
  const wd = box(d); room.attach(wd); clearInterval(room.timer);
  room.message(wd, JSON.stringify({ t: 'join', name: 'Other', id: 'oth001', create: true }));
  assert.equal(d[0].code, 'taken');
  // everyone leaves; the room stays joinable for a while (host refreshes), then expires
  room.detach(wb); room.detach(wc);
  const we = box([]); room.attach(we); clearInterval(room.timer);
  fakeNow += 5 * 60 * 1000;
  const e = []; we.send = (s) => e.push(JSON.parse(s));
  room.message(we, JSON.stringify({ t: 'join', name: 'Host', id: 'host02' }));
  assert.equal(e[0].t, 'hello', 'rejoin after refresh works');
  room.detach(we);
  fakeNow += 31 * 60 * 1000;
  const f = []; const wf = box(f); room.attach(wf); clearInterval(room.timer);
  room.message(wf, JSON.stringify({ t: 'join', name: 'Late', id: 'late01' }));
  assert.equal(f[0].code, 'noroom', 'expired room is gone');
  // a fresh object restored from storage still knows the room exists
  const restored = new RoomLogic('ABCD', { now: () => fakeNow, openedAt: fakeNow - 60 * 1000 });
  assert.ok(restored.exists());
  console.log('room code checks ok');
}

// solo round: monster eats you and it ends
{
  const { over } = runRound(0);
  assert.ok(over && over.final.length === 1);
}
console.log('ok');
