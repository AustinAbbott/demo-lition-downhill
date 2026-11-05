// Stress + edge cases: many simulated humans (real physics, random steering,
// pickups, invites, emotes) against the real RoomLogic, with a hand-driven clock.
// Run: node test/stress.test.mjs
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { RoomLogic } from '../public/js/room.js';
import { newSkier, stepSkier, steer, GRAB_RADIUS, hitMeeting, crash, MEETING_SECS, ST, ST_NAME, Terrain } from '../public/js/sim.js';

let now = 0;
const rnd = (() => { let s = 12345; return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); })();

class SimClient {
  constructor(room, name, { create = false, id, secret } = {}) {
    this.room = room; this.name = name; this.inbox = []; this.bytes = 0;
    this.id = id || Math.random().toString(36).slice(2, 10);
    this.secret = secret || 'secret-' + Math.random().toString(36).slice(2, 12);
    this.ws = { send: (s) => { this.bytes += s.length; this.onMsg(JSON.parse(s)); }, close: () => { this.closed = true; } };
    this.taken = new Set(); this.meetings = []; this.inv = 0;
    room.attach(this.ws);
    room.message(this.ws, JSON.stringify({ t: 'join', id: this.id, secret: this.secret, name, create }));
  }
  onMsg(m) {
    this.inbox.push(m);
    if (m.t === 'hello') { this.you = m.you; this.terrain = new Terrain(m.seed); this.me = newSkier(m.x, m.y, ST_NAME[m.st]); this.phase = m.phase; for (const id of m.taken || []) this.taken.add(id); }
    if (m.t === 'phase') {
      this.phase = m.ph;
      if (m.seed !== undefined) { this.terrain = new Terrain(m.seed); this.taken = new Set(); }
      if (m.spawns && m.spawns[this.you]) this.me = newSkier(m.spawns[this.you][0], m.spawns[this.you][1], m.ph === 'count' ? 'frozen' : 'ski');
      if (m.ph === 'run' && this.me && this.me.st === 'frozen') this.me.st = 'ski';
    }
    if (m.t === 's') {
      const mine = m.p.find(e => e[0] === this.you);
      if (mine && mine[4] === ST.eaten) this.me.st = 'eaten';
      if (mine) this.inv = mine[6];
      this.meetings = (m.mt || []).map(([id, x, y, by]) => ({ id, x, y, by }));
    }
    if (m.t === 'ev' && m.k === 'grab') this.taken.add(m.id);
  }
  step(dt) {
    if (this.closed || !this.me || !['lobby', 'run', 'over'].includes(this.phase)) return;
    const me = this.me;
    if (me.st === 'eaten' || me.st === 'wait') return;
    if (rnd() < 0.04) steer(me, ['L', 'R', 'D', 'D', 'D', 'J'][Math.floor(rnd() * 6)]);
    stepSkier(me, dt, this.terrain);
    for (const pk of this.terrain.pickupsNear(me.y - GRAB_RADIUS, me.y + GRAB_RADIUS)) {
      if (!this.taken.has(pk.id) && Math.hypot(pk.x - me.x, pk.y - me.y) < GRAB_RADIUS) { this.taken.add(pk.id); this.send({ t: 'grab', id: pk.id }); }
    }
    const mt = hitMeeting(me, this.meetings, this.you);
    if (mt) { this.meetings = this.meetings.filter(x => x.id !== mt.id); crash(me, MEETING_SECS); this.send({ t: 'meet', id: mt.id }); }
    if (this.inv > 0 && rnd() < 0.01) this.send({ t: 'drop' });
    if (rnd() < 0.003) this.send({ t: 'emote', i: Math.floor(rnd() * 4) });
  }
  sendPos() {
    if (this.closed || !this.me || this.me.st === 'eaten' || this.me.st === 'wait' || this.phase === 'count') return;
    const s = this.me.st === 'crash' ? 1 : this.me.st === 'air' ? (this.me.big ? 3 : 2) : 0;
    this.send({ t: 'p', x: this.me.x, y: this.me.y, d: this.me.d, s });
  }
  send(o) { if (!this.closed) this.room.message(this.ws, JSON.stringify(o)); }
  disconnect() { this.closed = true; this.room.detach(this.ws); }
}

function makeRoom(code = 'LOAD') {
  const room = new RoomLogic(code, { now: () => now });
  const origAttach = room.attach.bind(room);
  room.attach = (ws) => { origAttach(ws); clearInterval(room.timer); room.timer = 1; }; // we drive the clock
  return room;
}

function runFor(room, clients, secs, until) {
  const times = [];
  for (let t = 0; t < secs; t += 0.05) {
    for (let k = 0; k < 3; k++) for (const c of clients) c.step(1 / 60);
    for (const c of clients) c.sendPos();
    const t0 = performance.now(); room.tick(0.05); times.push(performance.now() - t0);
    now += 50;
    if (until && until()) break;
  }
  return times;
}

// --- 1. load: 20 humans + 4 bots, a full round -----------------------------------
{
  const room = makeRoom();
  const host = new SimClient(room, 'Host', { create: true });
  const clients = [host];
  for (let i = 1; i < 20; i++) clients.push(new SimClient(room, 'Player ' + i));
  for (let i = 0; i < 4; i++) host.send({ t: 'bot' });
  assert.equal(room.players.size, 24);
  runFor(room, clients, 5);                       // warm-up
  host.send({ t: 'start' });
  const bytes0 = clients.map(c => c.bytes);
  const times = runFor(room, clients, 400, () => room.phase === 'over');
  assert.equal(room.phase, 'over', 'round finished');
  const final = room.final.map(f => f.id);
  assert.equal(final.length, 24); assert.equal(new Set(final).size, 24, 'everyone exactly once');
  const secs = times.length * 0.05;
  const kbps = (clients[5].bytes - bytes0[5]) / secs / 1024;
  times.sort((a, b) => a - b);
  console.log(`load: 24 skiers, round ${secs.toFixed(0)} s, tick avg ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2)} ms, p99 ${times[Math.floor(times.length * 0.99)].toFixed(2)} ms, max ${times[times.length - 1].toFixed(2)} ms; ~${kbps.toFixed(1)} KB/s down per player`);
  assert.ok(times[Math.floor(times.length * 0.99)] < 10, 'tick stays far below the 50 ms budget');
  // a 25th person can't squeeze in
  const extra = new SimClient(room, 'Too many');
  assert.equal(extra.inbox[0].code, 'full'); assert.ok(extra.closed);
}

// --- 2. host leaves mid-round: host moves on, round still ends ----------------
{
  const room = makeRoom('HOST');
  const host = new SimClient(room, 'Host', { create: true });
  const a = new SimClient(room, 'A'), b = new SimClient(room, 'B');
  host.send({ t: 'bot' });
  host.send({ t: 'start' });
  runFor(room, [host, a, b], 6);
  host.disconnect();
  assert.equal(room.hostId, a.you, 'host passes to the next person');
  a.send({ t: 'kick', id: b.you }); // kicking isn't allowed mid-round
  assert.ok(room.players.has(b.you));
  runFor(room, [a, b], 400, () => room.phase === 'over');
  assert.equal(room.phase, 'over');
  assert.ok(room.final.some(f => f.id === host.you), 'the host who left is still in the order (eaten while away)');
  console.log('host leaves mid-round: ok');
}

// --- 3. reconnect mid-round keeps your skier; someone else can't hijack it ------
{
  const room = makeRoom('RECO');
  const host = new SimClient(room, 'Host', { create: true });
  const a = new SimClient(room, 'A');
  host.send({ t: 'start' });
  runFor(room, [host, a], 8);
  const yBefore = room.players.get(a.you).sk.y;
  a.disconnect();
  assert.equal(room.players.get(a.you).connected, false);
  // a prankster tries a's public id without the secret
  const thief = new SimClient(room, 'Thief', { id: a.you, secret: 'wrong-secret-123' });
  assert.notEqual(thief.you, a.you, 'no hijacking with a stolen id');
  assert.ok(thief.inbox.find(m => m.t === 'hello').late, 'the thief is just a late joiner');
  // the real a comes back
  const a2 = new SimClient(room, 'A', { id: a.you, secret: a.secret });
  assert.equal(a2.you, a.you);
  assert.ok(Math.abs(room.players.get(a.you).sk.y - yBefore) < 1, 'same skier, same place');
  assert.ok(!room.players.get(a.you).late, "a reconnect isn't 'late'");
  console.log('reconnect + hijack guard: ok');
}

// --- 4. abort, run it back from results, late joiners at each phase ----------
{
  const room = makeRoom('PHAS');
  const host = new SimClient(room, 'Host', { create: true });
  host.send({ t: 'bot' }); host.send({ t: 'bot' });
  host.send({ t: 'start' });
  const duringCount = new SimClient(room, 'Count');       // joins during the countdown: plays
  assert.equal(duringCount.inbox.find(m => m.t === 'hello').late, false);
  runFor(room, [host, duringCount], 5);
  host.send({ t: 'abort' });
  assert.equal(room.phase, 'lobby'); assert.equal(room.order.length, 0);
  host.send({ t: 'start' });
  runFor(room, [host, duringCount], 6);
  const late = new SimClient(room, 'Late');               // joins mid-run: missed the lift
  assert.equal(late.inbox.find(m => m.t === 'hello').late, true);
  runFor(room, [host, duringCount, late], 400, () => room.phase === 'over');
  assert.equal(room.final[0].id, late.you, 'missed the lift demos first');
  const afterOver = new SimClient(room, 'After');         // joins on the results screen
  assert.ok(afterOver.inbox.find(m => m.t === 'hello').final, 'sees the results');
  host.send({ t: 'start' });                              // run it back straight from results
  assert.equal(room.phase, 'count');
  assert.ok(room.players.has(late.you) && !room.players.get(late.you).late, 'late flag cleared for the new round');
  console.log('abort / rerun / late joiners: ok');
}

// --- 5. everyone leaves mid-round: room resets, still joinable for a while ----
{
  const room = makeRoom('EMPT');
  const host = new SimClient(room, 'Host', { create: true });
  const a = new SimClient(room, 'A');
  host.send({ t: 'start' });
  runFor(room, [host, a], 20);
  host.disconnect(); a.disconnect();
  assert.equal(room.phase, 'lobby'); assert.equal(room.order.length, 0); assert.equal(room.final, null);
  now += 60 * 1000;
  const back = new SimClient(room, 'Host');
  assert.equal(back.inbox[0].t, 'hello'); assert.equal(back.inbox[0].phase, 'lobby');
  console.log('everyone leaves mid-round: ok');
}

// --- 6. junk input never throws or breaks the room ---------------------------
{
  const room = makeRoom('FUZZ');
  const host = new SimClient(room, 'Host', { create: true });
  const junk = ['', 'null', '[]', '{"t":5}', '{"t":"p","x":"NaN","y":1e309}', '{"t":"p","x":-1e12,"y":1e12,"d":99,"s":-4}',
    '{"t":"grab","id":"__proto__"}', '{"t":"grab","id":-1}', '{"t":"emote","i":99}', '{"t":"look","hat":{"x":1},"scarf":[]}',
    '{"t":"kick","id":{"a":1}}', '{"t":"bot","name":"<img src=x onerror=alert(1)>"}', '{"t":"meet","id":"x"}', 'x'.repeat(5000),
    '{"t":"join","id":"' + host.you + '"}'];
  for (const j of junk) room.message(host.ws, j);
  runFor(room, [host], 2);
  const p = room.players.get(host.you).sk;
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1800, 'position stays sane');
  const botNames = [...room.players.values()].filter(q => q.bot).map(q => q.name);
  assert.ok(botNames.every(n => !/[<>]/.test(n)), 'no markup in names');
  console.log('junk input: ok');
}

console.log('stress ok');
process.exit(0);
