// main.js — the browser side: UI, input, networking, and rendering.
import {
  Terrain, newSkier, stepSkier, steer, collideSkiers, mulberry32, hash2,
  WORLD_W, CHUNK_H, PX_PER_M, START_Y, CLEAR_Y, MONSTER, ST, ST_NAME,
} from './sim.js';
import * as S from './sprites.js';
import { sfx, unlock, isMuted, setMuted } from './audio.js';
import { setTrack, isMusicOn, setMusicOn } from './music.js';
import { RoomLogic, COLORS } from './room.js';

const $ = (s) => document.querySelector(s);
const cv = $('#game');
const g = cv.getContext('2d');

// ---------------------------------------------------------------------------
// identity (id is per-tab so two tabs = two skiers; name/colour persist)
const ls = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
let myId;
try { myId = sessionStorage.getItem('dd.id'); } catch {}
if (!myId) { myId = Math.random().toString(36).slice(2, 10); try { sessionStorage.setItem('dd.id', myId); } catch {} }
let myName = ls.get('dd.name', '');
let myColor = ls.get('dd.color', COLORS[Math.floor(Math.random() * COLORS.length)]);

// ---------------------------------------------------------------------------
const G = {
  conn: null, code: null, practice: false,
  phase: 'none', phaseStart: 0, seed: 0, terrain: new Terrain(20261105),
  you: null, me: null,
  hostId: null, roster: new Map(),
  snaps: [], view: null, lastPt: 0,
  order: [], missed: [], final: null, survivor: null,
  trails: new Map(), banner: null, pops: [],
  camX: WORLD_W / 2 - 400, camY: -200,
  lastSend: 0, lastBeep: 0, eatenSlot: null, resultsDismissed: false,
};

// ---------------------------------------------------------------------------
// networking
function newCode() {
  const L = 'BCDFGHJKLMNPQRSTVWXZ';
  let code = '';
  for (let i = 0; i < 4; i++) code += L[Math.floor(Math.random() * L.length)];
  return code;
}

// create = true claims a fresh room code; false joins one that must already exist
function connect(code, create = false, attempt = 0) {
  G.code = code; G.practice = false;
  G.creating = create ? { attempt } : null;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws, retry = 0, stopped = false, joined = false;
  const open = () => {
    ws = new WebSocket(`${proto}://${location.host}/api/room/${code}/ws`);
    ws.onopen = () => {
      retry = 0; $('#conn').hidden = true;
      // only the very first join creates; reconnects rejoin the existing room
      ws.send(JSON.stringify({ t: 'join', id: myId, name: myName, color: myColor, create: create && !joined }));
    };
    ws.addEventListener('message', (e) => { if (!joined && e.data.includes('"t":"hello"')) joined = true; });
    ws.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    ws.onclose = (e) => {
      if (stopped) return;
      if (e.code === 4000) { stopped = true; toast('This tab was replaced by another one.'); return; }
      if (e.code === 4001 || e.code === 4002) { stopped = true; return; }
      $('#conn').hidden = false; $('#conn').textContent = 'Reconnecting…';
      setTimeout(open, Math.min(5000, 400 * 2 ** retry++));
    };
  };
  open();
  G.conn = {
    send: (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); },
    close: () => { stopped = true; try { ws.close(); } catch {} },
  };
}

function connectPractice() {
  const room = new RoomLogic('SOLO');
  const sock = { send: (s) => { const m = JSON.parse(s); queueMicrotask(() => handle(m)); }, close() {} };
  room.attach(sock);
  G.conn = { send: (o) => room.message(sock, JSON.stringify(o)), close: () => room.detach(sock) };
  G.code = 'SOLO'; G.practice = true;
  G.conn.send({ t: 'join', id: myId, name: myName, color: myColor, create: true });
  for (let i = 0; i < 7; i++) G.conn.send({ t: 'bot' });
}

function leave() {
  if (G.conn) G.conn.close();
  G.conn = null; G.phase = 'none'; G.me = null; G.snaps = []; G.view = null; G.roster = new Map();
  G.trails.clear(); G.final = null; G.banner = null;
  history.replaceState(null, '', location.pathname);
  $('#hud').hidden = true; $('#results').hidden = true; $('#landing').hidden = false;
}

function handle(m) {
  switch (m.t) {
    case 'hello': {
      G.you = m.you; G.creating = null;
      if (m.you !== myId) { myId = m.you; try { sessionStorage.setItem('dd.id', myId); } catch {} }
      setSeed(m.seed);
      G.phase = m.phase; G.phaseStart = performance.now();
      G.me = newSkier(m.x, m.y, ST_NAME[m.st] || 'ski');
      G.final = m.final || null;
      G.snaps = [];
      enterGame();
      if (m.late) banner('YOU MISSED THE LIFT', "SO YOU'LL DEMO FIRST. ENJOY THE SHOW.", 4000);
      break;
    }
    case 'roster':
      G.hostId = m.host;
      G.roster = new Map(m.players.map(p => [p.id, p]));
      renderLobby(); renderPanels(true);
      break;
    case 'phase': onPhase(m); break;
    case 's': onState(m); break;
    case 'ev': onEvent(m); break;
    case 'error': {
      const c = G.creating;
      if (m.code === 'taken' && c && c.attempt < 5) {
        // someone else is using that random code; quietly pick another
        G.conn.close(); G.conn = null;
        connect(newCode(), true, c.attempt + 1);
        break;
      }
      const wasCode = G.code;
      leave();
      $('#landing-err').textContent = m.msg || 'Could not join that room.';
      if (m.code === 'noroom') { $('#code').value = wasCode || ''; $('#code').select(); }
      break;
    }
    case 'kicked': leave(); $('#landing-err').textContent = 'The host removed you from that room.'; break;
  }
}

function setSeed(seed) {
  if (seed === undefined || seed === G.seed) return;
  G.seed = seed; G.terrain = new Terrain(seed);
  edgeCache.clear(); speckCache.clear();
}

function onPhase(m) {
  G.phase = m.ph; G.phaseStart = performance.now();
  setSeed(m.seed);
  if (m.spawns) {
    G.snaps = []; G.trails.clear();
    const sp = m.spawns[G.you];
    if (sp) G.me = newSkier(sp[0], sp[1], m.ph === 'count' ? 'frozen' : 'ski');
  }
  if (m.ph === 'count') {
    G.order = []; G.missed = []; G.final = null; G.eatenSlot = null; G.lastBeep = 4;
    G.resultsDismissed = false; $('#results').hidden = true; G.banner = null;
  } else if (m.ph === 'run') {
    if (G.me && G.me.st === 'frozen') G.me.st = 'ski';
    banner('GO!', '', 900); sfx.go();
  } else if (m.ph === 'over') {
    G.final = m.final; G.survivor = m.survivor; G.resultsDismissed = false;
    showResults(); sfx.win();
  } else if (m.ph === 'lobby') {
    G.final = null; G.order = []; G.missed = []; G.eatenSlot = null; G.banner = null;
    $('#results').hidden = true;
  }
  renderLobby(); renderPanels(true);
}

function onState(m) {
  const now = performance.now();
  G.snaps.push({ at: now, m });
  if (G.snaps.length > 40) G.snaps.shift();
  G.order = m.o; G.missed = m.ms; G.lastPt = m.pt;
  const mine = m.p.find(e => e[0] === G.you);
  if (G.me) {
    if (mine && mine[4] === ST.eaten && G.me.st !== 'eaten') G.me.st = 'eaten';
    if (!mine && m.ph === 'run' && G.me.st !== 'eaten') G.me.st = 'wait';
    // the room clamped us hard (or we were away): accept its position
    if (mine && G.me.st !== 'eaten' && G.me.st !== 'wait' && m.ph !== 'count') {
      if (Math.hypot(mine[1] - G.me.x, mine[2] - G.me.y) > 280) { G.me.x = mine[1]; G.me.y = mine[2]; }
    }
  }
}

function onEvent(m) {
  if (m.k === 'spawn') {
    banner('THE SCOPE CREEP IS LOOSE!', 'IT EATS WHOEVER IS FURTHEST BACK', 2800);
    sfx.spawn();
  } else if (m.k === 'eat') {
    const p = G.roster.get(m.id);
    const name = p ? p.name : '???';
    const mine = m.id === G.you;
    if (mine) G.eatenSlot = m.n;
    if (!G.order.includes(m.id)) G.order = [...G.order, m.id];
    const meals = G.order.length;
    const hungrier = meals > 0 && meals % 3 === 0 ? ' - AND IT JUST GOT FASTER' : '';
    banner('CHOMP!', (mine ? `THAT'S YOU. YOU DEMO #${m.n}` : `${name} DEMOS #${m.n}`) + hungrier, 2400);
    const snap = G.view && G.view.monster;
    if (snap) G.pops.push({ x: snap.x, y: snap.y, n: m.n, at: performance.now() });
    sfx.chomp();
  }
  renderPanels(true);
}

function banner(text, sub, ms) { G.banner = { text, sub, until: performance.now() + ms, at: performance.now() }; }
function toast(msg) { const t = $('#conn'); t.textContent = msg; t.hidden = false; }

// ---------------------------------------------------------------------------
// input
const queue = [];
const held = { L: 0, R: 0 };
const KEYS = {
  ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R', ArrowDown: 'D', KeyS: 'D',
  Space: 'J', ArrowUp: 'J', KeyW: 'J', KeyR: 'reset', KeyM: 'music',
};
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const c = KEYS[e.code];
  if (!c) return;
  e.preventDefault();
  unlock();
  if (e.repeat) return;
  if (c === 'reset') { lobbyReset(); return; }
  if (c === 'music') { toggleMusic(); return; }
  queue.push(c);
  if (c === 'L' || c === 'R') held[c] = performance.now() + 230;
});
addEventListener('keyup', (e) => { const c = KEYS[e.code]; if (c === 'L' || c === 'R') held[c] = 0; });
addEventListener('blur', () => { held.L = held.R = 0; });
addEventListener('pointerdown', unlock, { passive: true });

for (const b of document.querySelectorAll('#touch button')) {
  const c = b.dataset.cmd;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); unlock(); queue.push(c); if (c === 'L' || c === 'R') held[c] = performance.now() + 230; });
  const up = () => { if (c === 'L' || c === 'R') held[c] = 0; };
  b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
}

function lobbyReset() {
  if (!G.me || (G.phase !== 'lobby' && G.phase !== 'over')) return;
  G.me = newSkier(260 + Math.random() * (WORLD_W - 520), START_Y, 'ski');
  G.trails.delete(G.you);
  G.conn && G.conn.send({ t: 'p', x: G.me.x, y: G.me.y, d: 0, s: 0, reset: 1 });
}

function controllable() {
  return G.me && G.conn && (G.phase === 'lobby' || G.phase === 'run' || G.phase === 'over');
}

const STEP = 1 / 60;
let acc = 0;
function simulate(dt) {
  acc = Math.min(acc + dt, 0.25);
  while (acc >= STEP) { acc -= STEP; stepMe(STEP); }
}
function stepMe(dt) {
  const me = G.me;
  if (!controllable()) { queue.length = 0; return; }
  const now = performance.now();
  while (queue.length) {
    const r = steer(me, queue.shift());
    if (r === 'hop') sfx.hop();
  }
  for (const k of ['L', 'R']) {
    if (held[k] && now > held[k]) { steer(me, k); held[k] = now + 140; }
  }
  const ev = stepSkier(me, dt, G.terrain);
  if (ev === 'crash' || ev === 'rock') sfx.crash();
  else if (ev === 'mogul') sfx.mogul();
  else if (ev === 'ramp') sfx.ramp();
  if (G.view) { if (collideSkiers(me, G.view.players, G.you)) sfx.bump(); }
}

function stCode(sk) {
  if (sk.st === 'crash') return ST.crash;
  if (sk.st === 'air') return sk.big ? ST.bigair : ST.air;
  return ST.ski;
}
function sendPosition(now) {
  const me = G.me;
  if (!controllable() || me.st === 'eaten' || me.st === 'wait' || now - G.lastSend < 50) return;
  G.lastSend = now;
  G.conn.send({ t: 'p', x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, d: me.d, s: stCode(me) });
}

// interpolate other skiers ~110ms in the past for smoothness
function viewState(now) {
  const s = G.snaps;
  if (!s.length) return null;
  const rt = now - 110;
  let a, b;
  if (rt >= s[s.length - 1].at) a = b = s[s.length - 1];
  else if (rt <= s[0].at) a = b = s[0];
  else for (let i = s.length - 1; i > 0; i--) if (s[i - 1].at <= rt) { a = s[i - 1]; b = s[i]; break; }
  const span = b.at - a.at;
  const f = span > 0 ? Math.max(0, Math.min(1, (rt - a.at) / span)) : 1;
  const prev = new Map(a.m.p.map(e => [e[0], e]));
  const players = [];
  for (const e of b.m.p) {
    const p = prev.get(e[0]);
    let x = e[1], y = e[2];
    if (p && Math.abs(p[2] - e[2]) < 400) { x = p[1] + (e[1] - p[1]) * f; y = p[2] + (e[2] - p[2]) * f; }
    players.push({ id: e[0], x, y, d: e[3], st: ST_NAME[e[4]] });
  }
  let monster = null;
  const ma = a.m.m, mb = b.m.m;
  if (mb) {
    monster = { x: mb[0], y: mb[1], eat: mb[2] === 1, target: mb[3] };
    if (ma) { monster.x = ma[0] + (mb[0] - ma[0]) * f; monster.y = ma[1] + (mb[1] - ma[1]) * f; }
  }
  return { players, monster };
}

// ---------------------------------------------------------------------------
// rendering
let Z = 2, VW = 400, VH = 280;
function resize() {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
  Z = Math.max(1, Math.round((cv.height / 560) * 2) / 2);
  if (cv.width / Z < 420) Z = Math.max(1, Math.round((cv.width / 420) * 2) / 2); // narrow phones
  VW = cv.width / Z; VH = cv.height / Z;
}
addEventListener('resize', resize);
resize();

const sx = (x) => Math.round((x - G.camX) * Z);
const sy = (y) => Math.round((y - G.camY) * Z);

function sprite(img, x, y, alpha = 1) {
  const w = img.width * Z, h = img.height * Z;
  if (alpha !== 1) g.globalAlpha = alpha;
  g.drawImage(img, Math.round(sx(x) - w / 2), Math.round(sy(y) - h), w, h);
  if (alpha !== 1) g.globalAlpha = 1;
}

const edgeCache = new Map();
function edgeTrees(c) {
  let a = edgeCache.get(c);
  if (a) return a;
  a = [];
  const rng = mulberry32(hash2(G.seed ^ 0x5eed, c));
  for (let i = 0; i < 26; i++) {
    const side = i % 2;
    const depth = rng() * 260;
    const x = side ? WORLD_W + 8 + depth : -8 - depth;
    const y = c * CHUNK_H + rng() * CHUNK_H;
    a.push({ type: rng() < 0.3 ? 'bigtree' : 'tree', x: Math.round(x), y: Math.round(y), v: Math.floor(rng() * 4) });
  }
  if (edgeCache.size > 200) edgeCache.clear();
  edgeCache.set(c, a);
  return a;
}
const speckCache = new Map();
function specks(c) {
  let a = speckCache.get(c);
  if (a) return a;
  a = [];
  const rng = mulberry32(hash2(G.seed ^ 0x51ec, c));
  for (let i = 0; i < 90; i++) a.push([Math.round(-300 + rng() * (WORLD_W + 600)), Math.round(c * CHUNK_H + rng() * CHUNK_H), rng() < 0.3 ? 2 : 1]);
  if (speckCache.size > 200) speckCache.clear();
  speckCache.set(c, a);
  return a;
}

function colorOf(id) { const p = G.roster.get(id); return p ? p.color : '#888888'; }
function nameOf(id) { const p = G.roster.get(id); return p ? p.name : '?'; }

function trackTrail(id, x, y, air) {
  let t = G.trails.get(id);
  if (!t) { t = []; G.trails.set(id, t); }
  const l = t[t.length - 1];
  if (l && Math.hypot(x - l[0], y - l[1]) > 120) t.length = 0;
  if (!l || Math.hypot(x - l[0], y - l[1]) > 5) { t.push([x, y, air]); if (t.length > 90) t.shift(); }
}

function updateCamera(dt) {
  let fx = WORLD_W / 2, fy = G.camY + VH * 0.32 + 40 * dt, follow = 'drift';
  const me = G.me;
  if (G.conn && me && me.st !== 'eaten' && me.st !== 'wait') { fx = me.x; fy = me.y; follow = 'me'; }
  else if (G.view && G.view.monster) { fx = G.view.monster.x; fy = G.view.monster.y; follow = 'other'; }
  else if (G.view && G.view.players.length) {
    const alive = G.view.players.filter(p => p.st !== 'eaten');
    if (alive.length) { const lead = alive.reduce((a, b) => (b.y > a.y ? b : a)); fx = lead.x; fy = lead.y; follow = 'other'; }
  }
  let tx = fx - VW / 2;
  const frac = G.phase === 'lobby' && innerWidth <= 700 ? 0.6 : 0.32; // lobby panel sits on top on phones
  const ty = fy - VH * frac;
  if (VW >= WORLD_W + 160) tx = (WORLD_W - VW) / 2;
  else tx = Math.max(-80, Math.min(WORLD_W - VW + 80, tx));
  const k = 1 - Math.pow(0.0005, dt);
  G.camX += (tx - G.camX) * k;
  G.camY = follow === 'me' ? ty : follow === 'drift' ? G.camY + 50 * dt : G.camY + (ty - G.camY) * k;
}

function render(now, dt) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#f7fbff';
  g.fillRect(0, 0, cv.width, cv.height);
  updateCamera(dt);
  const top = G.camY - 60, bot = G.camY + VH + 60;

  // out-of-bounds tint
  g.fillStyle = '#e8eef6';
  if (G.camX < 0) g.fillRect(0, 0, sx(0), cv.height);
  if (G.camX + VW > WORLD_W) g.fillRect(sx(WORLD_W), 0, cv.width, cv.height);

  // snow specks
  g.fillStyle = '#dce7f4';
  for (let c = Math.floor(top / CHUNK_H); c <= Math.floor(bot / CHUNK_H); c++) {
    for (const [x, y, w] of specks(c)) if (y > top && y < bot) g.fillRect(sx(x), sy(y), w * Z, Z);
  }

  // start line
  if (top < START_Y + 30 && bot > START_Y - 60) drawStartLine();

  // trails
  g.lineWidth = Z; g.lineCap = 'square';
  for (const [id, t] of G.trails) {
    if (t.length < 2) continue;
    g.strokeStyle = id === '__creep' ? 'rgba(90,79,207,0.22)' : '#d3deec';
    if (id === '__creep') g.lineWidth = Z * 6;
    g.beginPath();
    for (const off of id === '__creep' ? [0] : [-2.5, 2.5]) {
      for (let i = 1; i < t.length; i++) {
        if (t[i][2] || t[i - 1][2]) continue;
        g.moveTo(sx(t[i - 1][0] + off), sy(t[i - 1][1])); g.lineTo(sx(t[i][0] + off), sy(t[i][1]));
      }
    }
    g.stroke();
    g.lineWidth = Z;
  }

  // everything that needs depth-sorting
  const items = [];
  for (const o of G.terrain.near(top, bot + 50)) items.push({ y: o.y, k: 'ob', o });
  for (let c = Math.floor(top / CHUNK_H); c <= Math.floor((bot + 50) / CHUNK_H); c++) {
    for (const o of edgeTrees(c)) if (o.y > top && o.y < bot + 50 && o.x > G.camX - 40 && o.x < G.camX + VW + 40) items.push({ y: o.y, k: 'ob', o });
  }
  const view = G.view;
  const skiers = [];
  if (view) for (const p of view.players) {
    if (p.id === G.you || p.st === 'eaten' || p.st === 'wait') continue;
    skiers.push(p);
  }
  if (G.me && G.conn && G.me.st !== 'eaten' && G.me.st !== 'wait') skiers.push({ id: G.you, x: G.me.x, y: G.me.y, d: G.me.d, st: G.me.st === 'air' && G.me.big ? 'bigair' : G.me.st, me: true });
  for (const p of skiers) {
    trackTrail(p.id, p.x, p.y, p.st === 'air' || p.st === 'bigair');
    items.push({ y: p.y, k: 'sk', p });
  }
  if (view && view.monster) {
    trackTrail('__creep', view.monster.x, view.monster.y + 2, false);
    items.push({ y: view.monster.y + 10, k: 'mon', m: view.monster });
  } else G.trails.delete('__creep');
  items.sort((a, b) => a.y - b.y);

  for (const it of items) {
    if (it.k === 'ob') {
      const img = S.obstacle(it.o.type, it.o.v);
      if (img) sprite(img, it.o.x, it.o.y);
    } else if (it.k === 'sk') drawSkier(it.p, now);
    else drawCreep(it.m, now);
  }

  // name tags on top of everything
  const ts = Math.max(1, Math.round(Z));
  const tags = skiers.map(p => {
    const label = p.me ? 'YOU' : nameOf(p.id);
    const w = S.textWidth(label, ts);
    const lift = p.st === 'bigair' ? 14 : p.st === 'air' ? 7 : 0;
    return { p, label, w, x: Math.round(sx(p.x) - w / 2), y: sy(p.y - lift) - 28 * Z };
  }).sort((a, b) => a.x - b.x);
  const placed = [];
  for (const t of tags) {
    let row = 0;
    while (row < 4 && placed.some(o => o.row === row && Math.abs(o.y - t.y) < 12 * ts && o.x + o.w + 4 * ts > t.x)) row++;
    t.row = row; placed.push(t);
    const yy = t.y - row * 9 * ts;
    if (row) { g.fillStyle = 'rgba(29,27,47,0.35)'; g.fillRect(Math.round(sx(t.p.x)), yy + 8 * ts, Z, t.y - yy); }
    S.drawText(g, t.label, t.x, yy, ts, t.p.me ? '#ffd60a' : '#ffffff', '#1d1b2f');
  }

  // floating sticky-note numbers when someone's eaten
  G.pops = G.pops.filter(p => now - p.at < 1600);
  for (const p of G.pops) {
    const k = (now - p.at) / 1600;
    const x = sx(p.x), y = sy(p.y) - (50 + k * 70) * Z;
    const s = 2 * ts, label = '#' + p.n, w = S.textWidth(label, s);
    g.globalAlpha = 1 - k * k;
    g.fillStyle = '#ffd60a'; g.fillRect(x - w / 2 - 4 * ts, y - 4 * ts, w + 8 * ts, 7 * s + 8 * ts);
    S.drawText(g, label, Math.round(x - w / 2), Math.round(y), s, '#1d1b2f');
    g.globalAlpha = 1;
  }

  drawOverlay(now);
}

function drawStartLine() {
  const y = START_Y + 14;
  g.fillStyle = '#e63946';
  for (let x = 120; x < WORLD_W - 120; x += 24) g.fillRect(sx(x), sy(y), 12 * Z, 2 * Z);
  const label = G.phase === 'lobby' || G.phase === 'none' ? 'WARM-UP RUN' : 'START';
  // a banner on two poles
  const bw = 150, bx = WORLD_W / 2 - bw / 2, by = START_Y - 64;
  g.fillStyle = '#6b6b7b';
  g.fillRect(sx(bx), sy(by), 2 * Z, 70 * Z); g.fillRect(sx(bx + bw), sy(by), 2 * Z, 70 * Z);
  g.fillStyle = '#000080'; g.fillRect(sx(bx), sy(by), bw * Z, 18 * Z);
  g.fillStyle = '#1084d0'; g.fillRect(sx(bx), sy(by + 15), bw * Z, 3 * Z);
  const ts = Math.max(1, Math.round(Z));
  const tw = S.textWidth(label, ts);
  S.drawText(g, label, Math.round(sx(WORLD_W / 2) - tw / 2), sy(by + 5), ts, '#ffffff');
}

const SPIN = [0, 1, 2, 3, 2, 1, 0, -1, -2, -3, -2, -1];
function drawSkier(p, now) {
  const color = p.me ? myColor : colorOf(p.id);
  let pose = p.d, lift = 0;
  if (p.st === 'crash') pose = 'crash';
  else if (p.st === 'frozen') pose = 0;
  else if (p.st === 'air') lift = 7;
  else if (p.st === 'bigair') { lift = 14; pose = SPIN[Math.floor(now / 55) % SPIN.length]; }
  if (lift) {
    g.fillStyle = 'rgba(40,60,110,0.22)';
    g.beginPath(); g.ellipse(sx(p.x), sy(p.y), 7 * Z, 2.5 * Z, 0, 0, Math.PI * 2); g.fill();
  }
  const img = S.skier(pose, color);
  const blink = p.me && G.me.inv > 0 && Math.floor(now / 80) % 2 === 0;
  sprite(img, p.x, p.y - lift, blink ? 0.35 : 1);
  if (p.me && (G.phase === 'lobby' || G.phase === 'count')) {
    // little bobbing arrow so you can find yourself in a crowd
    const bob = Math.round(Math.sin(now / 150) * 2);
    g.fillStyle = '#ffd60a';
    const ax = sx(p.x), ay = sy(p.y - lift) - (40 + bob) * Z;
    g.beginPath(); g.moveTo(ax - 5 * Z, ay); g.lineTo(ax + 5 * Z, ay); g.lineTo(ax, ay + 6 * Z); g.closePath(); g.fill();
  }
}

function drawCreep(m, now) {
  let look = [0, 1];
  const tgt = m.target && (m.target === G.you && G.me ? G.me : G.view.players.find(p => p.id === m.target));
  if (tgt) { const dx = tgt.x - m.x, dy = tgt.y - m.y, d = Math.hypot(dx, dy) || 1; look = [dx / d, dy / d]; }
  const mouth = m.eat ? 0.5 + 0.5 * Math.abs(Math.sin(now / 90)) : 0.12 + 0.08 * Math.sin(now / 200);
  const img = S.creep(now / 1000, look, mouth);
  const grow = 1.15 + 0.05 * Math.min(8, (G.order || []).length); // it grows as it eats
  const w = Math.round(img.width * Z * grow), h = Math.round(img.height * Z * grow);
  const bounce = m.eat ? Math.abs(Math.sin(now / 90)) * 3 * Z : 0;
  g.fillStyle = 'rgba(40,40,110,0.18)';
  g.beginPath(); g.ellipse(sx(m.x), sy(m.y + 9), w * 0.38, 5 * Z, 0, 0, Math.PI * 2); g.fill();
  g.drawImage(img, Math.round(sx(m.x) - w / 2), Math.round(sy(m.y + 10) - h - bounce), w, h);
}

// bottom edge for overlay text: on phones, stay above the touch buttons
function bottomY() { return innerWidth <= 700 ? cv.height - 110 * (cv.width / innerWidth) : cv.height; }

function bigText(text, cy, maxScale, color, outline) {
  let s = maxScale;
  while (s > 1 && S.textWidth(text, s) > cv.width * 0.92) s--;
  const w = S.textWidth(text, s);
  S.drawText(g, text, Math.round(cv.width / 2 - w / 2), Math.round(cy), s, color, outline);
  return 7 * s;
}

function drawOverlay(now) {
  if (!G.conn) return;
  const ts = Math.max(1, Math.round(Z));
  const cy = cv.height * 0.56;

  if (G.phase === 'lobby') {
    const msg = G.hostId === G.you
      ? 'WARM-UP: NO MONSTER UNTIL YOU HIT START'
      : 'WARM-UP: NO MONSTER UNTIL THE HOST STARTS';
    // top of the screen on desktop (lobby window is bottom-left); above the touch buttons on phones
    const dpr = cv.width / innerWidth;
    const y = innerWidth <= 700 ? cv.height - 140 * dpr : 16 * dpr;
    bigText(msg, y, ts * 2, '#5a4fcf', '#ffffff');
  }

  if (G.phase === 'count') {
    const left = 3 - (now - G.phaseStart) / 1000;
    const n = Math.max(1, Math.ceil(left));
    if (n < G.lastBeep) { G.lastBeep = n; sfx.beep(); }
    const h = bigText(String(n), cy - 20 * ts, 8 * ts, '#e63946', '#ffffff');
    bigText('GET READY', cy - 20 * ts + h + 14 * ts, 3 * ts, '#1d1b2f', '#ffffff');
  } else if (G.phase === 'run' && G.lastPt < MONSTER.grace && !(G.view && G.view.monster) && !(G.me && G.me.st === 'wait')) {
    const n = Math.max(0, Math.ceil(MONSTER.grace - G.lastPt));
    if (n <= 10) bigText(`SCOPE CREEP ARRIVES IN ${n}`, bottomY() - 70 * ts, 2 * ts, '#5a4fcf', '#ffffff');
  }

  if (G.banner && now < G.banner.until) {
    const k = Math.min(1, (now - G.banner.at) / 120);
    const h = bigText(G.banner.text, cy - (1 - k) * 30, 5 * ts, '#e63946', '#ffffff');
    if (G.banner.sub) bigText(G.banner.sub, cy + h + 10 * ts, 2 * ts, '#1d1b2f', '#ffffff');
  }

  const me = G.me;
  if (me && me.st === 'eaten' && G.phase === 'run') {
    bigText(G.eatenSlot ? `YOU DEMO #${G.eatenSlot}` : 'YOU GOT EATEN', bottomY() - 90 * ts, 3 * ts, '#ffffff', '#5a4fcf');
    bigText('SPECTATING THE SCOPE CREEP', bottomY() - 60 * ts, ts, '#1d1b2f', '#ffffff');
  } else if (me && me.st === 'wait' && G.phase === 'run') {
    bigText("MISSED THE LIFT: YOU'RE DEMOING FIRST", bottomY() - 70 * ts, 2 * ts, '#1d1b2f', '#ffffff');
  }

  // monster off-screen indicator
  const m = G.view && G.view.monster;
  if (m && me && me.st !== 'eaten' && me.st !== 'wait') {
    const off = sy(m.y) < 0 || sx(m.x) < 0 || sx(m.x) > cv.width;
    if (off) {
      const dist = Math.max(0, Math.round((me.y - m.y) / PX_PER_M));
      const pad = (innerWidth > 700 ? 260 : 190) * (cv.width / innerWidth);
      const x = Math.max(pad, Math.min(cv.width - pad, sx(m.x)));
      const danger = dist < 25 && Math.floor(now / 200) % 2 === 0;
      g.fillStyle = danger ? '#e63946' : '#5a4fcf';
      g.beginPath(); g.moveTo(x, 6 * ts); g.lineTo(x - 8 * ts, 18 * ts); g.lineTo(x + 8 * ts, 18 * ts); g.closePath(); g.fill();
      const label = `SCOPE CREEP ${dist}M`;
      const w = S.textWidth(label, ts);
      S.drawText(g, label, Math.round(Math.max(4, Math.min(cv.width - w - 4, x - w / 2))), 22 * ts, ts, g.fillStyle, '#ffffff');
    }
  }

  if (G.phase === 'run' && G.view) drawMinimap(ts);

  // your own distance, big and always visible during a round
  if ((G.phase === 'run' || G.phase === 'count') && me && me.st !== 'wait') {
    const dpr = cv.width / innerWidth;
    const big = 3 * ts, small = ts;
    const x = 14 * dpr;
    const y = innerWidth <= 700 ? cv.height * 0.42 : cv.height - 14 * dpr - 7 * big - 10 * small;
    const label = me.st === 'eaten' ? 'YOU MADE IT' : 'DISTANCE';
    S.drawText(g, label, x, y, small, '#1d1b2f', '#ffffff');
    S.drawText(g, `${metres(me.y)}M`, x, y + 10 * small, big, me.st === 'eaten' ? '#5a4fcf' : '#000080', '#ffffff');
  }
}

function drawMinimap(ts) {
  const ps = G.view.players.filter(p => p.st !== 'eaten' && p.st !== 'wait');
  if (!ps.length) return;
  const m = G.view.monster;
  let y0 = Math.min(...ps.map(p => p.y)), y1 = Math.max(...ps.map(p => p.y));
  if (m) y0 = Math.min(y0, m.y);
  if (y1 - y0 < 300) y1 = y0 + 300;
  const phone = innerWidth <= 700;
  const H = cv.height * (phone ? 0.3 : 0.42), X = cv.width - 22 * ts, Y = cv.height * (phone ? 0.38 : 0.5);
  g.fillStyle = 'rgba(192,192,192,0.85)'; g.fillRect(X - 6 * ts, Y - 6 * ts, 16 * ts, H + 12 * ts);
  g.fillStyle = '#ffffff'; g.fillRect(X - 2 * ts, Y, 8 * ts, H);
  const my = (y) => Y + (y - y0) / (y1 - y0) * H;
  for (const p of ps) {
    const me = p.id === G.you;
    g.fillStyle = me ? '#1d1b2f' : colorOf(p.id);
    const sz = me ? 6 : 4;
    g.fillRect(X + 2 * ts - sz / 2 * ts, my(me && G.me ? G.me.y : p.y) - sz / 2 * ts, sz * ts, sz * ts);
  }
  if (m) { g.fillStyle = '#5a4fcf'; g.fillRect(X - 3 * ts, my(m.y) - 4 * ts, 10 * ts, 8 * ts); g.fillStyle = '#fff'; g.fillRect(X, my(m.y) - 2 * ts, 2 * ts, 2 * ts); g.fillRect(X + 3 * ts, my(m.y) - 2 * ts, 2 * ts, 2 * ts); }
}

// ---------------------------------------------------------------------------
// DOM panels
const metres = (y) => Math.max(0, Math.round((y - START_Y) / PX_PER_M));
function li(html, cls) { const e = document.createElement('li'); if (cls) e.className = cls; e.innerHTML = html; return e; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function sw(color) { return `<span class="swatch" style="background:${esc(color)}"></span>`; }

let lastPanels = 0;
function renderPanels(force) {
  const now = performance.now();
  if (!force && now - lastPanels < 250) return;
  lastPanels = now;
  if (!G.conn) return;

  // demo order so far
  const ol = $('#order-list');
  ol.replaceChildren();
  const order = [...(G.missed || []), ...(G.order || [])];
  order.forEach((id, i) => {
    const late = G.missed.includes(id);
    ol.append(li(`<span class="num">${i + 1}.</span>${sw(colorOf(id))}<span class="nm">${esc(nameOf(id))}</span>${late ? '<span class="meta">late</span>' : ''}`, id === G.you ? 'me' : ''));
  });
  $('#order-empty').hidden = order.length > 0 || G.phase !== 'run';
  $('#order-panel').hidden = G.phase === 'lobby' || G.phase === 'none' || G.phase === 'count';

  // who's still going, furthest down first
  const ap = $('#alive-panel');
  ap.hidden = G.phase !== 'run';
  if (G.phase === 'run' && G.view) {
    const ul = $('#alive-list');
    ul.replaceChildren();
    const withMe = G.view.players.filter(p => p.st !== 'wait')
      .map(p => (p.id === G.you && G.me && G.me.st !== 'eaten' ? { ...p, y: G.me.y } : p));
    const alive = withMe.filter(p => p.st !== 'eaten').sort((a, b) => b.y - a.y);
    const eaten = withMe.filter(p => p.st === 'eaten').sort((a, b) => G.order.indexOf(b.id) - G.order.indexOf(a.id));
    alive.forEach((p, i) => {
      const r = G.roster.get(p.id) || {};
      ul.append(li(`<span class="num">${i + 1}.</span>${sw(colorOf(p.id))}<span class="nm">${esc(nameOf(p.id))}${r.bot ? ' 🤖' : ''}</span><span class="meta">${metres(p.y)} m</span>`, (p.id === G.you ? 'me ' : '') + (r.on === false ? 'off' : '')));
    });
    for (const p of eaten) {
      const slot = G.missed.length + G.order.indexOf(p.id) + 1;
      ul.append(li(`<span class="num">🍽</span>${sw(colorOf(p.id))}<span class="nm">${esc(nameOf(p.id))}</span><span class="meta">${metres(p.y)} m · demos #${slot}</span>`, 'gone' + (p.id === G.you ? ' me' : '')));
    }
    $('#abort').hidden = G.hostId !== G.you;
  }
  $('#controls-hint').hidden = G.phase === 'over' && !G.resultsDismissed;
  $('#show-results').hidden = !(G.phase === 'over' && G.resultsDismissed);
}

function renderLobby() {
  const lp = $('#lobby-panel');
  lp.hidden = G.phase !== 'lobby';
  if (lp.hidden) return;
  const isHost = G.hostId === G.you;
  $('#lobby-title').textContent = G.practice ? 'Practice: warm-up' : `Lobby: ${G.roster.size} skier${G.roster.size === 1 ? '' : 's'}`;
  $('#start').textContent = G.practice ? 'Start practice round (monster on) ▶' : 'Start the round ▶';
  $('#share-row').hidden = G.practice;
  $('#room-code').textContent = G.code;
  $('#share-link').value = `${location.origin}${location.pathname}?room=${G.code}`;
  const ul = $('#lobby-list');
  ul.replaceChildren();
  for (const p of G.roster.values()) {
    const tags = [p.id === G.hostId ? 'host' : '', p.bot ? 'bot' : '', p.id === G.you ? 'you' : ''].filter(Boolean).join(', ');
    const e = li(`${sw(p.color)}<span class="nm">${esc(p.name)}</span><span class="meta">${tags}</span>`, p.id === G.you ? 'me' : '');
    if (isHost && p.id !== G.you) {
      const x = document.createElement('button');
      x.className = 'x'; x.title = `Remove ${p.name}`; x.textContent = '✕';
      x.onclick = () => G.conn.send({ t: 'kick', id: p.id });
      e.append(x);
    }
    ul.append(e);
  }
  $('#host-controls').hidden = !isHost;
  $('#guest-note').hidden = isHost;
  const h = G.roster.get(G.hostId);
  $('#host-name').textContent = h ? h.name : 'the host';
}

function showResults() {
  const ol = $('#final-list');
  ol.replaceChildren();
  for (const f of G.final || []) {
    const tags = [];
    if (G.missed && G.missed.includes(f.id)) tags.push('<span class="tagpill">missed the lift</span>');
    if (f.id === G.survivor) tags.push('<span class="tagpill win">last one standing</span>');
    if (f.bot) tags.push('<span class="tagpill">bot</span>');
    const dist = G.missed && G.missed.includes(f.id) ? '' : `<span class="dist">${f.dist ?? 0} m</span>`;
    ol.append(li(`${sw(f.color || '#888')}<span class="nm">${esc(f.name)}</span>${tags.join('')}${dist}`));
  }
  const isHost = G.hostId === G.you;
  for (const b of document.querySelectorAll('.host-only')) b.hidden = !isHost;
  $('#copied').hidden = true;
  $('#results').hidden = false;
  renderPanels(true);
}

function enterGame() {
  $('#landing').hidden = true;
  $('#hud').hidden = false;
  $('#landing-err').textContent = '';
  $('#touch').hidden = !matchMedia('(pointer: coarse)').matches;
  if (!G.practice) history.replaceState(null, '', `?room=${G.code}`);
  renderLobby(); renderPanels(true);
  if (G.phase === 'over' && G.final) showResults();
}

// ---------------------------------------------------------------------------
// landing page wiring
function drawLogo() {
  const c = $('#logo'), lg = c.getContext('2d');
  lg.imageSmoothingEnabled = false;
  lg.fillStyle = '#f7fbff'; lg.fillRect(0, 0, c.width, c.height);
  // "DEMO" gets the emphasis: it's the whole point
  S.drawText(lg, 'DEMO', 8, 8, 2, '#e63946');
  S.drawText(lg, '-LITION', 8 + S.textWidth('DEMO-', 2) - S.textWidth('-', 2), 8, 2, '#000080');
  S.drawText(lg, 'DOWNHILL', 8, 28, 2, '#000080');
  lg.fillStyle = '#5a4fcf';
  S.drawText(lg, 'WHO DEMOS FIRST?', 8, 50, 1, '#555');
  const sk = S.skier(1, myColor);
  lg.drawImage(sk, 164, 18, sk.width * 2, sk.height * 2);
  const t = S.obstacle('tree', 2);
  lg.drawImage(t, 144, 2, t.width, t.height);
  const cr = S.creep(performance.now() / 1000, [-1, 0.6], 0.6);
  lg.drawImage(cr, 192, 7, cr.width * 0.8, cr.height * 0.8);
}

function initLanding() {
  const nameIn = $('#name'), codeIn = $('#code');
  nameIn.value = myName;
  const params = new URLSearchParams(location.search);
  const room = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (room) { codeIn.value = room; $('#join').classList.add('primary'); $('#create').classList.remove('primary'); }

  const colors = $('#colors');
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.style.background = c; b.title = c; b.setAttribute('aria-pressed', String(c === myColor));
    b.onclick = () => {
      myColor = c; ls.set('dd.color', c);
      for (const o of colors.children) o.setAttribute('aria-pressed', String(o === b));
      drawLogo();
    };
    colors.append(b);
  }
  drawLogo();
  setInterval(() => { if (!$('#landing').hidden) drawLogo(); }, 120);

  const needName = () => {
    myName = nameIn.value.trim().slice(0, 16);
    if (!myName) { $('#landing-err').textContent = 'Type your name first, so the monster knows who it ate.'; nameIn.focus(); return false; }
    ls.set('dd.name', myName);
    $('#landing-err').textContent = '';
    unlock();
    return true;
  };
  $('#create').onclick = () => {
    if (!needName()) return;
    connect(newCode(), true);
  };
  $('#join').onclick = () => {
    if (!needName()) return;
    const code = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 3) { $('#landing-err').textContent = 'Enter the room code from whoever made the room.'; codeIn.focus(); return; }
    connect(code);
  };
  $('#practice').onclick = () => { if (needName()) connectPractice(); };
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') (room ? $('#join') : $('#create')).click(); });
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#join').click(); });
  (myName ? (room ? $('#join') : nameIn) : nameIn).focus();
}

$('#copy-link').onclick = async () => {
  const v = $('#share-link').value;
  try { await navigator.clipboard.writeText(v); $('#copy-link').textContent = 'Copied!'; }
  catch { $('#share-link').select(); document.execCommand('copy'); $('#copy-link').textContent = 'Copied!'; }
  setTimeout(() => { $('#copy-link').textContent = 'Copy link'; }, 1500);
};
$('#add-bot').onclick = () => {
  G.conn.send({ t: 'bot', name: $('#bot-name').value.trim() || undefined });
  $('#bot-name').value = '';
};
$('#bot-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#add-bot').click(); });
$('#start').onclick = () => { $('#start').blur(); G.conn.send({ t: 'start' }); };
$('#abort').onclick = () => { if (confirm('Abort this round and go back to the lobby?')) G.conn.send({ t: 'abort' }); };
$('#again').onclick = () => G.conn.send({ t: 'lobby' });
$('#close-results').onclick = () => { $('#results').hidden = true; G.resultsDismissed = true; renderPanels(true); };
$('#show-results').onclick = () => { G.resultsDismissed = false; showResults(); };
$('#leave').onclick = () => leave();
const muteBtn = $('#mute');
const syncMute = () => { muteBtn.textContent = isMuted() ? 'SFX: off' : 'SFX: on'; };
muteBtn.onclick = () => { setMuted(!isMuted()); syncMute(); muteBtn.blur(); };
syncMute();
const musicBtn = $('#music');
const syncMusic = () => { musicBtn.textContent = isMusicOn() ? 'Music: on' : 'Music: off'; };
function toggleMusic() { setMusicOn(!isMusicOn()); syncMusic(); }
musicBtn.onclick = () => { unlock(); toggleMusic(); musicBtn.blur(); };
syncMusic();
document.addEventListener('visibilitychange', () => { if (document.hidden) setTrack(null); });
// cruise in the lobby and on the results screen, race from the countdown,
// chase once the monster is loose (and faster with every skier it eats)
function musicFor() {
  if (!G.conn || G.phase === 'none') return null;
  if (G.phase === 'run' && G.view && G.view.monster) return 'chase';
  if (G.phase === 'count' || G.phase === 'run') return 'race';
  return 'cruise';
}
$('#copy-order').onclick = async () => {
  const d = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const lines = [`:skier: Demo order for ${d} (decided by the Scope Creep)`];
  (G.final || []).forEach((f, i) => {
    const note = G.missed && G.missed.includes(f.id) ? ' (missed the lift)' : f.id === G.survivor ? ' (last one standing)' : '';
    const dist = G.missed && G.missed.includes(f.id) ? '' : ` · ${f.dist ?? 0} m`;
    lines.push(`${i + 1}. ${f.name}${note}${dist}`);
  });
  const text = lines.join('\n');
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  $('#copied').hidden = false;
};

// ---------------------------------------------------------------------------
// main loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (G.conn) {
    G.view = viewState(now);
    simulate(dt);
    sendPosition(now);
    renderPanels(false);
  }
  setTrack(musicFor(), (G.order || []).length);
  render(now, dt);
  requestAnimationFrame(frame);
}

initLanding();
requestAnimationFrame(frame);

// for automated tests
window.__dd = G;
