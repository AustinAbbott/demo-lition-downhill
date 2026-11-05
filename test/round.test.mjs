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
  room.message(host, JSON.stringify({ t: 'join', name: 'Host', id: 'host01' }));
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

// solo round: monster eats you and it ends
{
  const { over } = runRound(0);
  assert.ok(over && over.final.length === 1);
}
console.log('ok');
