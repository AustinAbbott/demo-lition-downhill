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
  const inf = room.info();
  assert.equal(inf.exists, true); assert.equal(inf.host, 'Host'); assert.equal(inf.skiers, 2); assert.equal(inf.phase, 'lobby');
  assert.deepEqual(new RoomLogic('NONE', { now: () => fakeNow }).info(), { exists: false });
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

// extras: pickups are server-checked, PTO saves you once, invites trip others, emotes rate-limit
{
  const room = new RoomLogic('XTRA', { now: () => fakeNow });
  const box = (arr) => ({ send: (s) => arr.push(JSON.parse(s)), close() {} });
  const a = [], b = [];
  const wa = box(a), wb = box(b);
  room.attach(wa); room.attach(wb); clearInterval(room.timer);
  room.message(wa, JSON.stringify({ t: 'join', name: 'Ann', id: 'ann001', create: true, hat: 'crown', scarf: 'gold' }));
  room.message(wb, JSON.stringify({ t: 'join', name: 'Bo', id: 'bo0001', hat: 'nonsense' }));
  const ann = room.players.get('ann001'), bo = room.players.get('bo0001');
  assert.equal(ann.hat, 'crown'); assert.equal(ann.scarf, 'gold'); assert.equal(bo.hat, undefined, 'bad hat ignored');
  // find a pickup of each type on this mountain
  const find = (type) => { for (let c = 1; c < 200; c++) for (const pk of room.terrain.pickups(c)) if (pk.type === type && !room.taken.has(pk.id)) return pk; };
  const inv = find('invite');
  room.message(wa, JSON.stringify({ t: 'grab', id: inv.id }));
  assert.ok(!room.taken.has(inv.id), 'grab from far away is refused');
  ann.sk.x = inv.x; ann.sk.y = inv.y;
  room.message(wa, JSON.stringify({ t: 'grab', id: inv.id }));
  room.message(wb, JSON.stringify({ t: 'grab', id: inv.id }));
  assert.equal(ann.invites, 1); assert.equal(bo.invites || 0, 0, 'only one person gets a pickup');
  // drop it; Bo skis into it
  room.message(wa, JSON.stringify({ t: 'drop' }));
  assert.equal(room.meetings.length, 1); assert.equal(ann.invites, 0);
  const mt = room.meetings[0];
  room.message(wa, JSON.stringify({ t: 'meet', id: mt.id }));
  assert.equal(room.meetings.length, 1, "you can't trip on your own invite");
  bo.sk.x = mt.x; bo.sk.y = mt.y;
  room.message(wb, JSON.stringify({ t: 'meet', id: mt.id }));
  assert.equal(room.meetings.length, 0, 'invite used up');
  assert.ok(b.some(m => m.t === 'ev' && m.k === 'meet' && m.pid === 'bo0001'));
  // PTO: the yeti catches Bo once and is foiled
  const pto = find('pto'); bo.sk.x = pto.x; bo.sk.y = pto.y;
  room.message(wb, JSON.stringify({ t: 'grab', id: pto.id }));
  assert.equal(bo.pto, true);
  room.phase = 'run'; room.phaseT = 99; ann.sk.y = bo.sk.y + 2000;
  room.monster = { x: bo.sk.x, y: bo.sk.y - 5, st: 'hunt', t: 0, age: 0, target: bo.id, mood: 'hunt', moodT: 0, nextMood: 99, sniffDir: 1, jitter: 1, jitterT: 9, phase: 0 };
  room.runMonster(0.05);
  assert.equal(bo.sk.st !== 'eaten', true, 'PTO saved Bo'); assert.equal(bo.pto, false); assert.equal(room.monster.mood, 'ooo');
  assert.ok(a.some(m => m.t === 'ev' && m.k === 'pto'));
  // immune for a moment, then fair game
  room.monster.x = bo.sk.x; room.monster.y = bo.sk.y; room.monster.mood = 'hunt';
  room.runMonster(0.05);
  assert.notEqual(bo.sk.st, 'eaten', 'grace period after PTO');
  bo.ptoT = 0; room.monster.x = bo.sk.x; room.monster.y = bo.sk.y;
  room.runMonster(0.05);
  assert.equal(bo.sk.st, 'eaten');
  // coffee: flagged as boosted in the state
  const cof = find('coffee'); ann.sk.x = cof.x; ann.sk.y = cof.y; room.phase = 'lobby';
  room.message(wa, JSON.stringify({ t: 'grab', id: cof.id }));
  assert.ok(ann.boostT > 0);
  // emotes are rate-limited
  const before = a.filter(m => m.k === 'emote').length;
  room.message(wa, JSON.stringify({ t: 'emote', i: 1 }));
  room.message(wa, JSON.stringify({ t: 'emote', i: 2 }));
  fakeNow += 1500;
  room.message(wa, JSON.stringify({ t: 'emote', i: 3 }));
  assert.equal(a.filter(m => m.k === 'emote').length - before, 2);
  console.log('extras checks ok');
}

// solo round: monster eats you and it ends
{
  const { over } = runRound(0);
  assert.ok(over && over.final.length === 1);
}
console.log('ok');
