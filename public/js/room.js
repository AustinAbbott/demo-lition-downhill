// room.js — one game room. Pure JS with no platform APIs, so the same class
// runs inside the Cloudflare Durable Object, the local Node dev server, and
// the browser's offline practice mode.
//
// The room is authoritative for: who's in the room, the phase, the bots, the
// Scope Creep, and the order people get eaten. Each human's own skier is
// simulated in their browser (snappy steering) and reported here ~20x/sec;
// the room sanity-checks those reports so nobody can teleport to safety.

import {
  Terrain, newSkier, stepSkier, steer, collideSkiers, botThink, newBrain,
  mulberry32, randomSeed, WORLD_W, START_Y, PX_PER_M, MONSTER, RAMP_SPEED, ST, ST_NAME, monsterSpeed, monsterChew,
  MOODS, MOOD, COFFEE_SECS, PTO_IMMUNE_SECS, MEETING_SECS, MEETING_TTL, MAX_INVITES, GRAB_RADIUS,
  EMOTES, HATS, SCARVES, hitMeeting, crash,
} from './sim.js';

const TICK_MS = 50;
const COUNTDOWN = 3;
const MAX_PLAYERS = 24;
const LOBBY_WRAP_Y = 5200;
export const ROOM_TTL_MS = 30 * 60 * 1000; // an empty room stays joinable this long

export const COLORS = ['#e63946', '#2a9d8f', '#f4a261', '#457b9d', '#9b5de5', '#f15bb5', '#00bbf9', '#80b918', '#ff7b00', '#3d405b', '#d4a373', '#06d6a0'];
const BOT_NAMES = ['Ctrl Alt Elite', 'Null Pointer', 'Merge Conflict', 'Flaky Test', 'Hotfix Hank', 'Legacy Larry', 'Tech Debt', 'Prod Pusher', 'Rubber Duck', 'Off-By-One', 'Kernel Panic', 'Stand-up Stan'];

function cleanName(s) {
  s = String(s || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);
  return s || 'Anonymous Skier';
}
function shortId() { return Math.random().toString(36).slice(2, 8); }

export class RoomLogic {
  constructor(code, opts = {}) {
    this.code = code;
    this.players = new Map();   // id -> player (humans and bots)
    this.sockets = new Map();   // socket -> player id (or null before join)
    this.hostId = null;
    this.phase = 'lobby';
    this.phaseT = 0;            // seconds into the current phase
    this.round = 0;
    this.order = [];            // ids in the order they were eaten
    this.missed = [];           // ids who joined after the start
    this.final = null;          // final demo order (ids) once a round ends
    this.monster = null;
    this.rnd = mulberry32(randomSeed());
    this.newMountain();
    this.timer = null;
    this.endAt = null;
    this.onEmpty = opts.onEmpty || null;
    this.now = opts.now || (() => Date.now());
    // A room only exists once someone has created it. `lastSeen` is when it
    // was last occupied; the Durable Object persists it so a room survives
    // the object being evicted from memory.
    this.open = !!opts.openedAt && this.now() - opts.openedAt < ROOM_TTL_MS;
    this.lastSeen = opts.openedAt || 0;
    this.onActivity = opts.onActivity || null;
  }

  newMountain() {
    this.seed = randomSeed(); this.terrain = new Terrain(this.seed);
    this.taken = new Set();   // pickup ids already grabbed this mountain
    this.meetings = [];       // dropped meeting invites on the slope
    this.meetN = this.meetN || 0;
  }

  // --- socket lifecycle -------------------------------------------------
  attach(ws) {
    this.sockets.set(ws, null);
    if (!this.timer) this.timer = setInterval(() => this.tick(TICK_MS / 1000), TICK_MS);
  }

  detach(ws) {
    const id = this.sockets.get(ws);
    this.sockets.delete(ws);
    const p = id && this.players.get(id);
    if (p && p.ws === ws) {
      p.ws = null; p.connected = false;
      if (this.phase === 'lobby') this.players.delete(id);
      this.fixHost();
      this.sendRoster();
    }
    if (this.sockets.size === 0) {
      clearInterval(this.timer); this.timer = null;
      if (this.open) this.touch();
      // nobody's here: reset so the next visitor gets a fresh lobby
      this.players.clear(); this.phase = 'lobby'; this.hostId = null; this.monster = null;
      this.onEmpty && this.onEmpty();
    }
  }

  message(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'join') return this.join(ws, m);
    const id = this.sockets.get(ws);
    const p = id && this.players.get(id);
    if (!p) return;
    const isHost = id === this.hostId;
    switch (m.t) {
      case 'p': return this.position(p, m);
      case 'start': if (isHost && (this.phase === 'lobby' || this.phase === 'over')) this.startCountdown(); return;
      case 'lobby': if (isHost && this.phase === 'over') this.toLobby(); return;
      case 'bot': if (isHost && this.phase === 'lobby') this.addBot(m.name); return;
      case 'kick': if (isHost && this.phase === 'lobby') this.kick(m.id); return;
      case 'abort': if (isHost && (this.phase === 'run' || this.phase === 'count')) this.toLobby(); return;
      case 'grab': return this.grab(p, m.id | 0);
      case 'drop': return this.drop(p);
      case 'meet': return this.meetHit(p, m.id | 0);
      case 'emote': return this.emote(p, m.i | 0);
      case 'look': return this.look(p, m);
      case 'ping': return this.send(ws, { t: 'pong', c: m.c });
    }
  }

  // --- players ------------------------------------------------------------
  // What the start screen shows before you join: does it exist, whose is it, how many are in.
  info() {
    if (!this.exists()) return { exists: false };
    const humans = [...this.players.values()].filter(p => !p.bot && p.connected);
    const host = this.players.get(this.hostId);
    return {
      exists: true, phase: this.phase, host: host ? host.name : null,
      skiers: humans.length, bots: [...this.players.values()].filter(p => p.bot).length,
    };
  }

  exists() {
    if (!this.open) return false;
    if ([...this.players.values()].some(p => !p.bot && p.connected)) return true;
    return this.now() - this.lastSeen < ROOM_TTL_MS;
  }

  touch() { this.lastSeen = this.now(); this.onActivity && this.onActivity(this.lastSeen); }

  reject(ws, code, msg) {
    this.send(ws, { t: 'error', code, msg });
    this.sockets.delete(ws);
    try { ws.close(4002, code); } catch {}
  }

  join(ws, m) {
    if (this.sockets.get(ws)) return;
    if (m.create) {
      if (this.exists()) return this.reject(ws, 'taken', 'That room code is already in use.');
      this.open = true; this.players.clear(); this.phase = 'lobby'; this.hostId = null;
    } else if (!this.exists()) {
      return this.reject(ws, 'noroom', `There's no room with the code ${this.code}. Check the code with whoever made the room, or create a new one.`);
    }
    this.touch();
    let p = typeof m.id === 'string' && this.players.get(m.id);
    if (p && !p.bot) {
      // reconnecting: take over the existing skier
      if (p.ws && p.ws !== ws) { this.sockets.delete(p.ws); try { p.ws.close(4000, 'replaced'); } catch {} }
      p.ws = ws; p.connected = true;
      if (m.name) p.name = cleanName(m.name);
      this.setLook(p, m);
    } else {
      const humans = [...this.players.values()].filter(q => !q.bot).length;
      if (this.players.size >= MAX_PLAYERS || humans >= MAX_PLAYERS) {
        this.send(ws, { t: 'error', msg: 'This room is full.' });
        return;
      }
      const id = (typeof m.id === 'string' && /^[a-z0-9]{4,12}$/.test(m.id) && !this.players.has(m.id)) ? m.id : shortId();
      const color = COLORS.includes(m.color) ? m.color : COLORS[this.players.size % COLORS.length];
      p = { id, name: cleanName(m.name), color, bot: false, ws, connected: true, lastPos: 0 };
      this.setLook(p, m);
      if (this.phase === 'run') {
        p.sk = newSkier(WORLD_W / 2, START_Y, 'wait');
        p.late = true;
        if (!this.missed.includes(id)) this.missed.push(id);
      } else if (this.phase === 'count') {
        p.sk = newSkier(this.freeSpawnX(), START_Y, 'frozen');
      } else {
        p.sk = newSkier(this.freeSpawnX(), START_Y, 'ski');
      }
      this.players.set(id, p);
    }
    this.sockets.set(ws, p.id);
    p.lastPos = this.now();
    this.fixHost();
    this.send(ws, {
      t: 'hello', you: p.id, code: this.code, seed: this.seed, phase: this.phase,
      x: p.sk.x, y: p.sk.y, st: ST[p.sk.st], late: !!p.late, final: this.final, taken: [...this.taken],
    });
    this.sendRoster();
  }

  fixHost() {
    const h = this.players.get(this.hostId);
    if (h && h.connected && !h.bot) return;
    const next = [...this.players.values()].find(p => !p.bot && p.connected);
    this.hostId = next ? next.id : null;
  }

  freeSpawnX() { return 260 + Math.floor(this.rnd() * (WORLD_W - 520)); }

  addBot(name) {
    if (this.players.size >= MAX_PLAYERS) return;
    const used = new Set([...this.players.values()].map(p => p.name));
    let nm = name ? cleanName(name) : BOT_NAMES.find(n => !used.has(n)) || `Bot ${this.players.size + 1}`;
    const id = 'b' + shortId();
    const counts = new Map(COLORS.map(c => [c, 0]));
    for (const p of this.players.values()) counts.set(p.color, (counts.get(p.color) || 0) + 1);
    const color = [...counts.entries()].sort((x, y) => x[1] - y[1])[0][0];
    this.players.set(id, {
      id, name: nm, color, bot: true, connected: true,
      hat: this.rnd() < 0.3 ? 'beanie' : HATS[1 + Math.floor(this.rnd() * (HATS.length - 1))],
      scarf: this.rnd() < 0.5 ? 'none' : SCARVES[1 + Math.floor(this.rnd() * (SCARVES.length - 1))],
      sk: newSkier(this.freeSpawnX(), START_Y, 'ski'), brain: newBrain(this.rnd),
    });
    this.sendRoster();
  }

  kick(id) {
    const p = this.players.get(id);
    if (!p || id === this.hostId) return;
    this.players.delete(id);
    if (p.ws) { this.send(p.ws, { t: 'kicked' }); this.sockets.delete(p.ws); try { p.ws.close(4001, 'kicked'); } catch {} }
    this.sendRoster();
  }

  position(p, m) {
    const sk = p.sk;
    if (p.bot || sk.st === 'eaten' || sk.st === 'wait' || this.phase === 'count') return;
    const x = +m.x, y = +m.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const now = this.now();
    const dt = Math.min(2, Math.max(0.02, (now - p.lastPos) / 1000));
    p.lastPos = now;
    // Plausibility: no faster than a ramp launch (with slack), no climbing.
    let nx = Math.max(0, Math.min(WORLD_W, x)), ny = y;
    if (this.phase === 'lobby' && m.reset) { sk.x = nx; sk.y = START_Y; return; }
    if (ny < sk.y - 4) ny = sk.y - 4;
    const dx = nx - sk.x, dy = ny - sk.y, dist = Math.hypot(dx, dy);
    const maxD = RAMP_SPEED * dt * 1.6 + 30;
    if (dist > maxD) { nx = sk.x + dx / dist * maxD; ny = sk.y + dy / dist * maxD; }
    sk.x = nx; sk.y = ny;
    sk.d = Math.max(-3, Math.min(3, m.d | 0));
    const st = ST_NAME[m.s | 0];
    sk.st = (st === 'crash' || st === 'air' || st === 'ski') ? st : (st === 'bigair' ? 'air' : 'ski');
    sk.big = st === 'bigair';
  }

  // --- phases ---------------------------------------------------------------
  participants() { return [...this.players.values()].filter(p => !p.late); }

  startCountdown() {
    this.round++;
    this.newMountain();
    this.order = []; this.missed = []; this.final = null; this.monster = null; this.endAt = null;
    // drop anyone who left, clear late flags
    for (const [id, p] of this.players) {
      if (!p.bot && !p.connected) this.players.delete(id);
      else p.late = false;
    }
    const list = [...this.players.values()];
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(this.rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    const gap = Math.min(80, (WORLD_W - 240) / Math.max(1, list.length));
    const x0 = WORLD_W / 2 - gap * (list.length - 1) / 2;
    const spawns = {};
    list.forEach((p, i) => {
      p.pto = false; p.invites = 0; p.ptoT = 0; p.boostT = 0;
      p.sk = newSkier(Math.round(x0 + i * gap), START_Y, 'frozen');
      if (p.bot) p.brain = newBrain(this.rnd);
      spawns[p.id] = [p.sk.x, p.sk.y];
    });
    this.setPhase('count', { seed: this.seed, spawns, round: this.round });
    this.sendRoster();
  }

  toLobby() {
    this.newMountain();
    this.monster = null; this.endAt = null;
    for (const [id, p] of this.players) {
      if (!p.bot && !p.connected) { this.players.delete(id); continue; }
      p.late = false; p.pto = false; p.invites = 0; p.ptoT = 0; p.boostT = 0;
      p.sk = newSkier(this.freeSpawnX(), START_Y, 'ski');
    }
    const spawns = {};
    for (const p of this.players.values()) spawns[p.id] = [p.sk.x, p.sk.y];
    this.setPhase('lobby', { seed: this.seed, spawns });
    this.sendRoster();
  }

  finish() {
    const alive = this.participants().filter(p => p.sk.st !== 'eaten').sort((a, b) => a.sk.y - b.sk.y);
    this.final = [...this.missed, ...this.order, ...alive.map(p => p.id)];
    const names = this.final.map(id => {
      const p = this.players.get(id);
      const dist = p ? Math.max(0, Math.round((p.sk.y - START_Y) / PX_PER_M)) : 0;
      return p ? { id, name: p.name, bot: p.bot, color: p.color, dist } : { id, name: '?', dist: 0 };
    });
    this.final = names;
    this.monster = null;
    this.setPhase('over', { final: names, survivor: alive.length ? alive[alive.length - 1].id : null, missed: this.missed.slice() });
  }

  setPhase(ph, extra = {}) {
    this.phase = ph; this.phaseT = 0;
    this.broadcast({ t: 'phase', ph, ...extra });
  }

  // --- the loop ---------------------------------------------------------------
  tick(dt) {
    this.phaseT += dt;
    this.tickN = (this.tickN || 0) + 1;
    const all = [...this.players.values()];

    if (this.phase === 'count' && this.phaseT >= COUNTDOWN) {
      for (const p of all) if (p.sk.st === 'frozen') p.sk.st = 'ski';
      this.setPhase('run');
    }

    // bots
    if (this.phase !== 'count') {
      const others = all.filter(p => !p.late).map(p => ({ id: p.id, x: p.sk.x, y: p.sk.y, st: p.sk.st }));
      for (const p of all) {
        if (!p.bot) continue;
        const sk = p.sk;
        if (this.phase !== 'run' && sk.y > LOBBY_WRAP_Y) { sk.y = START_Y; sk.x = this.freeSpawnX(); }
        const cmd = botThink(sk, p.brain, this.terrain, this.rnd, dt);
        if (cmd) steer(sk, cmd);
        const ev = stepSkier(sk, dt, this.terrain);
        collideSkiers(sk, others, p.id);
        if ((ev === 'crash' || ev === 'rock') && this.rnd() < 0.12) this.emoteNow(p, this.rnd() < 0.5 ? 3 : 0);
        this.botExtras(p, others);
      }
    }

    for (const p of all) {
      if (p.boostT > 0) p.boostT = Math.max(0, p.boostT - dt);
      if (p.ptoT > 0) p.ptoT = Math.max(0, p.ptoT - dt);
    }
    if (this.meetings.length) {
      for (const mt of this.meetings) mt.age += dt;
      this.meetings = this.meetings.filter(mt => mt.age < MEETING_TTL);
    }
    if (this.phase === 'run') this.runMonster(dt);
    if (this.endAt !== null && this.phaseT >= this.endAt) { this.endAt = null; this.finish(); }

    this.broadcastState();
  }

  runMonster(dt) {
    const parts = this.participants();
    const alive = parts.filter(p => p.sk.st !== 'eaten');
    if (this.endAt !== null || !alive.length) return;
    let last = alive[0];
    for (const p of alive) if (p.sk.y < last.sk.y) last = p;

    if (!this.monster) {
      if (this.phaseT < MONSTER.grace) return;
      this.monster = {
        x: last.sk.x, y: last.sk.y - MONSTER.spawnBehind, st: 'hunt', t: 0, age: 0, target: last.id,
        mood: 'hunt', moodT: 0, nextMood: 3 + this.rnd() * 2, sniffDir: 1, jitter: 1, jitterT: 0, phase: this.rnd() * 6,
      };
      this.broadcast({ t: 'ev', k: 'spawn' });
      return;
    }
    const m = this.monster;
    m.age += dt;
    if (m.st === 'eat') {
      m.t -= dt;
      if (m.t <= 0) m.st = 'hunt';
      return;
    }
    const meals = this.order.length;

    // --- moods: roll a new one every few seconds -------------------------
    if (m.mood !== 'hunt') {
      m.moodT -= dt;
      if (m.moodT <= 0) { m.mood = 'hunt'; m.nextMood = MOOD.gapMin + this.rnd() * (MOOD.gapMax - MOOD.gapMin); }
    } else if ((m.nextMood -= dt) <= 0) {
      const lastDist = Math.hypot(last.sk.x - m.x, last.sk.y - m.y);
      const options = Object.keys(MOOD).filter(k => typeof MOOD[k] === 'object')
        .filter(k => k !== 'lunge' || lastDist < MOOD.lungeRange)
        .filter(k => k !== 'fickle' || alive.length >= 3);
      const weight = (k) => k === 'sniff' ? Math.max(2, MOOD.sniff.w - meals * MOOD.sniffFadesPerMeal) : MOOD[k].w;
      let r = this.rnd() * options.reduce((s, k) => s + weight(k), 0);
      let pick = options[0];
      for (const k of options) { if ((r -= weight(k)) < 0) { pick = k; break; } }
      m.mood = pick; m.moodT = MOOD[pick].secs;
      if (pick === 'sniff') m.sniffDir = this.rnd() < 0.5 ? -1 : 1;
      if (pick === 'roar') this.broadcast({ t: 'ev', k: 'roar' });
    }

    // who it's after: usually last place; when fickle, second-to-last
    let target = last;
    if (m.mood === 'fickle') {
      const sorted = alive.slice().sort((a, b) => a.sk.y - b.sk.y);
      target = sorted[1] || last;
    }
    m.target = target.id;
    const dx = target.sk.x - m.x, dy = target.sk.y - m.y;
    const dist = Math.hypot(dx, dy) || 1;

    let speed = monsterSpeed(m.age, meals);
    if (dist > MONSTER.catchupDist) speed *= Math.min(MONSTER.catchupMax, MONSTER.catchup + MONSTER.catchupPerMeal * meals);
    // a little random surging and slacking, re-rolled every ~0.7s
    if ((m.jitterT -= dt) <= 0) { m.jitter = 0.85 + this.rnd() * 0.35; m.jitterT = 0.5 + this.rnd() * 0.5; }
    speed *= m.jitter * (m.mood === 'hunt' ? 1 : m.mood === 'ooo' ? 0.2 : MOOD[m.mood].speed);

    // heading: toward the target, plus a weave across it
    let ux = dx / dist, uy = dy / dist;
    if (m.mood === 'sniff' || m.mood === 'ooo') { ux = m.sniffDir * 0.9; uy = 0.3; }
    else if (dist > 70) {
      const amp = m.mood === 'zigzag' ? 1.4 : 0.45, freq = m.mood === 'zigzag' ? 5 : 2.2;
      const wv = Math.sin(m.age * freq + m.phase) * amp;
      ux += -dy / dist * wv; uy += dx / dist * wv;
      const l = Math.hypot(ux, uy) || 1; ux /= l; uy /= l;
    }
    const step = (m.mood === 'sniff' || m.mood === 'ooo') ? speed * dt : Math.min(dist, speed * dt);
    m.x = Math.max(0, Math.min(WORLD_W, m.x + ux * step)); m.y += uy * step;

    const r2 = MONSTER.eatRadius * MONSTER.eatRadius;
    for (const p of alive) {
      const ex = p.sk.x - m.x, ey = p.sk.y - m.y;
      if (ex * ex + ey * ey >= r2 || p.ptoT > 0) continue;
      if (p.pto) {
        // out of office! the yeti is baffled for a moment and you slip away
        p.pto = false; p.ptoT = PTO_IMMUNE_SECS;
        m.mood = 'ooo'; m.moodT = 1.4; m.sniffDir = ex >= 0 ? -1 : 1;
        this.broadcast({ t: 'ev', k: 'pto', pid: p.id });
        break;
      }
      this.eat(p, parts.length, alive.length);
      if (p.bot && this.rnd() < 0.4) this.emoteNow(p, 1); // "GG"
      break;
    }
  }

  eat(p, total, aliveBefore) {
    const m = this.monster;
    p.sk.st = 'eaten';
    this.order.push(p.id);
    m.st = 'eat'; m.t = monsterChew(this.order.length - 1); m.x = p.sk.x; m.y = p.sk.y;
    const slot = this.missed.length + this.order.length;
    this.broadcast({ t: 'ev', k: 'eat', id: p.id, n: slot });
    const aliveAfter = aliveBefore - 1;
    if (total > 1 ? aliveAfter <= 1 : aliveAfter <= 0) this.endAt = this.phaseT + 2.2;
  }

  // --- extras: pickups, meeting invites, emotes, cosmetics ---------------------
  extrasLive() { return this.phase === 'lobby' || this.phase === 'run'; }
  alive(p) { return p.sk && p.sk.st !== 'eaten' && p.sk.st !== 'wait' && p.sk.st !== 'frozen'; }

  grab(p, id) {
    if (!this.extrasLive() || !this.alive(p) || this.taken.has(id)) return;
    const pk = this.terrain.pickupById(id);
    // the room's copy of your position lags a little, so allow some slack
    if (!pk || Math.hypot(pk.x - p.sk.x, pk.y - p.sk.y) > (p.bot ? GRAB_RADIUS : 70)) return;
    this.taken.add(id);
    if (pk.type === 'coffee') { p.boostT = COFFEE_SECS; if (p.bot) p.sk.boost = COFFEE_SECS; }
    else if (pk.type === 'pto') p.pto = true;
    else if (pk.type === 'invite') p.invites = Math.min(MAX_INVITES, (p.invites || 0) + 1);
    this.broadcast({ t: 'ev', k: 'grab', id, pid: p.id, item: pk.type });
  }

  drop(p) {
    if (!this.extrasLive() || !this.alive(p) || !(p.invites > 0)) return;
    p.invites--;
    this.meetings.push({ id: ++this.meetN, x: p.sk.x, y: p.sk.y - 8, by: p.id, age: 0 });
    if (this.meetings.length > 40) this.meetings.shift();
    this.broadcast({ t: 'ev', k: 'drop', pid: p.id });
  }

  // someone skied into a dropped invite: it's used up, they're "in a meeting"
  meetHit(p, id) {
    const i = this.meetings.findIndex(mt => mt.id === id);
    if (i < 0) return;
    const mt = this.meetings[i];
    if (mt.by === p.id || Math.hypot(mt.x - p.sk.x, mt.y - p.sk.y) > 90) return;
    this.meetings.splice(i, 1);
    this.broadcast({ t: 'ev', k: 'meet', pid: p.id, id, by: mt.by });
  }

  emote(p, i) {
    const now = this.now();
    if (now - (p.lastEmote || 0) < 1200) return; // keep the chatter readable
    this.emoteNow(p, i, now);
  }
  emoteNow(p, i, now = this.now()) {
    if (i < 0 || i >= EMOTES.length) return;
    p.lastEmote = now;
    this.broadcast({ t: 'ev', k: 'emote', pid: p.id, i });
  }

  setLook(p, m) {
    if (HATS.includes(m.hat)) p.hat = m.hat;
    if (SCARVES.includes(m.scarf)) p.scarf = m.scarf;
  }
  look(p, m) { this.setLook(p, m); this.sendRoster(); }

  botExtras(p, others) {
    const sk = p.sk;
    if (!this.extrasLive() || !this.alive(p)) return;
    for (const pk of this.terrain.pickupsNear(sk.y - GRAB_RADIUS, sk.y + GRAB_RADIUS)) {
      if (!this.taken.has(pk.id) && Math.hypot(pk.x - sk.x, pk.y - sk.y) < GRAB_RADIUS) this.grab(p, pk.id);
    }
    const mt = hitMeeting(sk, this.meetings, p.id);
    if (mt) { crash(sk, MEETING_SECS); this.meetHit(p, mt.id); }
    // drop an invite on someone close behind (sometimes)
    if (p.invites > 0 && this.rnd() < 0.03) {
      const victim = others.find(o => o.id !== p.id && o.st === 'ski' && o.y < sk.y - 40 && o.y > sk.y - 240 && Math.abs(o.x - sk.x) < 70);
      if (victim) this.drop(p);
    }
  }

  // --- output -------------------------------------------------------------
  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }

  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const ws of this.sockets.keys()) { try { ws.send(s); } catch {} }
  }

  sendRoster() {
    const players = [...this.players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color, bot: p.bot, on: p.connected, late: !!p.late,
      hat: p.hat || 'beanie', scarf: p.scarf || 'none',
    }));
    this.broadcast({ t: 'roster', host: this.hostId, players });
  }

  broadcastState() {
    const p = [];
    for (const pl of this.players.values()) {
      const sk = pl.sk;
      if (sk.st === 'wait') continue;
      const st = sk.st === 'air' && sk.big ? ST.bigair : ST[sk.st];
      const flags = (pl.pto ? 1 : 0) | ((pl.boostT > 0 || sk.boost > 0) ? 2 : 0) | (pl.ptoT > 0 ? 4 : 0);
      p.push([pl.id, Math.round(sk.x), Math.round(sk.y), sk.d, st, flags, pl.invites || 0]);
    }
    const m = this.monster;
    this.broadcast({
      t: 's', k: this.tickN, ph: this.phase, pt: Math.round(this.phaseT * 10) / 10, p,
      m: m ? [Math.round(m.x), Math.round(m.y), m.st === 'eat' ? 1 : 0, m.target, m.st === 'eat' ? 0 : MOODS.indexOf(m.mood)] : null,
      o: this.order, ms: this.missed,
      mt: this.meetings.map(mt => [mt.id, Math.round(mt.x), Math.round(mt.y), mt.by]),
    });
  }
}
