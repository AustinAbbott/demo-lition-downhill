// sim.js — the shared rules of the mountain.
// Imported by the browser (your own skier, practice mode) and by the
// Durable Object (bots, the monster, who-got-eaten). Terrain is generated
// deterministically from a seed so every client sees the same mountain
// without the server ever sending a tree.

export const WORLD_W = 1800;      // course width in world px (forest beyond)
export const CHUNK_H = 512;       // terrain is generated in horizontal bands
export const PX_PER_M = 16;       // for the HUD's "metres"
export const START_Y = 40;        // where everyone lines up
export const CLEAR_Y = 260;       // no obstacles above this line

export const MAX_SPEED = 380;     // straight downhill, px/s
export const RAMP_SPEED = 470;    // launch speed off a ramp
const ACCEL = 300;
const DECEL = 420;
const SIDESTEP = 75;              // shuffling sideways when fully turned
// Heading notches: 0 = straight down, ±3 = sideways. Angles in radians.
export const DIR_ANGLE = [0, 0.42, 0.95, Math.PI / 2];
const DIR_SPEED = [MAX_SPEED, 330, 220, 0];

// The Scope Creep starts sluggish and gets more aggressive the longer it's
// loose AND with every skier it eats (it literally grows). Speeds are px/s;
// a skier pointed straight downhill does MAX_SPEED (380).
export const MONSTER = {
  grace: 14,          // seconds of skiing before it shows up
  base: 240,          // starting speed: only catches people who are crashing a lot
  ramp: 3.5,          // +px/s for every second it's been loose
  perMeal: 22,        // +px/s for every skier it has eaten
  cap: 820,
  catchupDist: 900,   // when it's this far from its target it sprints...
  catchup: 1.25,      // ...this much faster at first
  catchupPerMeal: 0.08, // ...and the sprint gets stronger with every meal
  catchupMax: 1.8,
  eatTime: 2.4,       // seconds spent chewing its first meal (it stops moving)
  eatTimeMin: 1.0,    // chewing gets quicker as it gets hungrier
  eatTimeStep: 0.15,
  eatRadius: 26,
  spawnBehind: 800,
};
// Moods make it erratic. Between moods it hunts (with a wobbly weave);
// every few seconds it rolls a new one. `w` = pick weight, `secs` = duration.
export const MOODS = ['hunt', 'lunge', 'sniff', 'zigzag', 'roar', 'fickle'];
export const MOOD = {
  lunge:  { w: 25, secs: 0.9, speed: 1.75 },        // sudden burst when it's close
  sniff:  { w: 16, secs: 1.3, speed: 0.25 },        // distracted by a tree; wanders sideways
  zigzag: { w: 28, secs: 2.6, speed: 1.05 },        // big side-to-side weave
  roar:   { w: 14, secs: 0.9, speed: 0 },           // stops to roar (everyone's screen shakes)
  fickle: { w: 17, secs: 3.0, speed: 1.0 },         // changes its mind: chases 2nd-to-last instead
  gapMin: 2, gapMax: 5.5,                           // seconds of plain hunting between moods
  lungeRange: 340,                                  // only lunges if its target is this close
  sniffFadesPerMeal: 2.5,                           // gets less distractible as it eats
};

// helpers so the room and the HUD agree on how riled up it is
export function monsterSpeed(age, meals) {
  return Math.min(MONSTER.cap, MONSTER.base + MONSTER.ramp * age + MONSTER.perMeal * meals);
}
export function monsterChew(meals) {
  return Math.max(MONSTER.eatTimeMin, MONSTER.eatTime - MONSTER.eatTimeStep * meals);
}

// Status codes on the wire.
export const ST = { ski: 0, crash: 1, air: 2, bigair: 3, frozen: 4, eaten: 5, wait: 6 };
export const ST_NAME = ['ski', 'crash', 'air', 'bigair', 'frozen', 'eaten', 'wait'];

// --- deterministic randomness -------------------------------------------
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash2(a, b) {
  let h = Math.imul((a ^ 0x9e3779b9) | 0, 0x85ebca6b) ^ Math.imul((b + 0x7f4a7c15) | 0, 0xc2b2ae35);
  h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 16;
  return h >>> 0;
}
export function randomSeed() { return (Math.random() * 4294967296) >>> 0; }

// --- terrain ---------------------------------------------------------------
// r = collision radius, oy = offset of the hit circle from the sprite's base
export const OB = {
  tree:     { r: 9,  oy: -4, kind: 'crash', tall: true },
  bigtree:  { r: 12, oy: -5, kind: 'crash', tall: true },
  deadtree: { r: 7,  oy: -3, kind: 'crash', tall: true },
  rock:     { r: 10, oy: -4, kind: 'crash' },
  stump:    { r: 7,  oy: -3, kind: 'crash' },
  mogul:    { r: 15, oy: -4, kind: 'slow' },
  ramp:     { r: 15, oy: -6, kind: 'ramp' },
};
// The mountain gets busier the further down you go, so the longer a round
// runs, the harder it gets. It's keyed to depth (not the clock) so every
// client generates the same terrain. A chunk is 512px = 32 m.
export const TERRAIN = {
  baseCount: 16,      // obstacles per chunk at the top
  perChunk: 0.8,      // +obstacles for every chunk further down
  maxExtra: 38,       // ...up to 16 + 38 = 54 per chunk (from ~1,500 m)
  groveChance: 0.55,  // chance of a cluster of trees per chunk at the top
  grovePerChunk: 0.01,
  groveMaxChance: 0.95,
  groveGrowEvery: 12, // groves get one tree bigger every 12 chunks (~380 m)
  secondGroveFrom: 25, // past ~800 m, a second grove can appear in a chunk
};
const WEIGHTS = [['tree', 38], ['bigtree', 10], ['deadtree', 5], ['rock', 12], ['stump', 8], ['mogul', 17], ['ramp', 6]];
const WEIGHT_SUM = WEIGHTS.reduce((s, w) => s + w[1], 0);

function pickType(r) {
  let x = r * WEIGHT_SUM;
  for (const [t, w] of WEIGHTS) { if ((x -= w) < 0) return t; }
  return 'tree';
}

export class Terrain {
  constructor(seed) { this.seed = seed >>> 0; this.cache = new Map(); }

  chunk(c) {
    let ch = this.cache.get(c);
    if (ch) return ch;
    ch = [];
    if (c >= 0) {
      const rng = mulberry32(hash2(this.seed, c));
      const T = TERRAIN;
      const n = Math.floor(T.baseCount + Math.min(T.maxExtra, c * T.perChunk)); // gets denser as you go
      for (let i = 0; i < n; i++) {
        const x = 30 + rng() * (WORLD_W - 60);
        const y = c * CHUNK_H + rng() * CHUNK_H;
        const type = pickType(rng());
        const v = Math.floor(rng() * 4);
        if (y < CLEAR_Y) continue;
        ch.push({ type, x: Math.round(x), y: Math.round(y), v });
      }
      // little groves: more likely, bigger, and doubled up deeper down
      const groves = (rng() < Math.min(T.groveMaxChance, T.groveChance + c * T.grovePerChunk) ? 1 : 0)
        + (c >= T.secondGroveFrom && rng() < 0.5 ? 1 : 0);
      for (let gi = 0; gi < groves; gi++) {
        const cx = 120 + rng() * (WORLD_W - 240);
        const cy = c * CHUNK_H + rng() * CHUNK_H;
        const k = 4 + Math.floor(rng() * 5) + Math.min(4, Math.floor(c / T.groveGrowEvery));
        for (let i = 0; i < k; i++) {
          const x = cx + (rng() - 0.5) * 140, y = cy + (rng() - 0.5) * 110;
          const big = rng() < 0.3;
          if (y < CLEAR_Y) continue;
          ch.push({ type: big ? 'bigtree' : 'tree', x: Math.round(x), y: Math.round(y), v: Math.floor(rng() * 4) });
        }
      }
      ch.sort((a, b) => a.y - b.y);
    }
    if (this.cache.size > 300) this.cache.clear();
    this.cache.set(c, ch);
    return ch;
  }

  // every obstacle whose base lies between y0 and y1
  near(y0, y1, out = []) {
    const c0 = Math.floor(y0 / CHUNK_H), c1 = Math.floor(y1 / CHUNK_H);
    for (let c = c0; c <= c1; c++) {
      for (const o of this.chunk(c)) if (o.y >= y0 && o.y <= y1) out.push(o);
    }
    return out;
  }
}

// --- skiers -----------------------------------------------------------------
export function newSkier(x, y, st = 'ski') {
  return { x, y, d: 0, speed: 0, st, t: 0, inv: 0, hopCd: 0, slowCd: 0, air: 0, airMax: 0 };
}

export function crash(sk, secs) {
  sk.st = 'crash'; sk.t = secs; sk.speed = 0;
}

// cmd: 'L' | 'R' | 'D' (point downhill) | 'J' (hop)
export function steer(sk, cmd) {
  if (sk.st !== 'ski' && sk.st !== 'air') return false;
  if (cmd === 'L' && sk.d > -3) { sk.d--; if (sk.d === -3) sk.speed = 0; return true; }
  if (cmd === 'R' && sk.d < 3) { sk.d++; if (sk.d === 3) sk.speed = 0; return true; }
  if (cmd === 'D' && sk.d !== 0) { sk.d = 0; return true; }
  if (cmd === 'J' && sk.st === 'ski' && sk.hopCd <= 0) {
    sk.st = 'air'; sk.air = sk.airMax = 0.5; sk.big = false; sk.hopCd = 1.4;
    return 'hop';
  }
  return false;
}

// Advance one skier by dt seconds. Returns an event name or null.
export function stepSkier(sk, dt, terrain) {
  sk.inv = Math.max(0, sk.inv - dt);
  sk.hopCd = Math.max(0, sk.hopCd - dt);
  sk.slowCd = Math.max(0, sk.slowCd - dt);

  if (sk.st === 'crash') {
    sk.t -= dt;
    if (sk.t <= 0) { sk.st = 'ski'; sk.d = 0; sk.speed = 0; sk.inv = 0.8; }
    return null;
  }
  if (sk.st !== 'ski' && sk.st !== 'air') return null; // frozen / eaten / wait

  const a = Math.abs(sk.d);
  if (sk.st === 'air') {
    sk.air -= dt;
    if (sk.air <= 0) { sk.st = 'ski'; sk.big = false; sk.inv = Math.max(sk.inv, 0.1); }
  } else {
    const target = DIR_SPEED[a];
    if (a === 3) sk.speed = 0;
    else if (sk.speed < target) sk.speed = Math.min(target, sk.speed + ACCEL * dt);
    else sk.speed = Math.max(target, sk.speed - DECEL * dt);
  }

  let vx, vy;
  if (a === 3 && sk.st === 'ski') { vx = Math.sign(sk.d) * SIDESTEP; vy = 0; }
  else {
    const ang = DIR_ANGLE[a] * Math.sign(sk.d);
    vx = Math.sin(ang) * sk.speed; vy = Math.cos(ang) * sk.speed;
  }
  sk.x += vx * dt; sk.y += vy * dt;
  if (sk.x < 14) sk.x = 14;
  if (sk.x > WORLD_W - 14) sk.x = WORLD_W - 14;

  if (sk.inv > 0) return null;
  const obs = terrain.near(sk.y - 24, sk.y + 24);
  for (const ob of obs) {
    const def = OB[ob.type];
    const dx = sk.x - ob.x, dy = sk.y - (ob.y + def.oy);
    const rr = def.r + 5;
    if (dx * dx + dy * dy >= rr * rr) continue;
    if (sk.st === 'air') {
      if (sk.big || !def.tall) continue; // a hop clears rocks & stumps, not trees
    }
    if (def.kind === 'crash') { crash(sk, 1.1); return ob.type === 'rock' ? 'rock' : 'crash'; }
    if (def.kind === 'slow' && sk.slowCd <= 0) { sk.speed *= 0.5; sk.slowCd = 0.6; return 'mogul'; }
    if (def.kind === 'ramp' && sk.st === 'ski') {
      sk.st = 'air'; sk.big = true; sk.air = sk.airMax = 0.95;
      sk.speed = Math.max(sk.speed, RAMP_SPEED);
      if (a === 3) sk.d = Math.sign(sk.d) * 2;
      return 'ramp';
    }
  }
  return null;
}

// Bumping into another skier knocks *you* over (the one doing the ramming).
export function collideSkiers(sk, others, selfId) {
  if (sk.st !== 'ski' || sk.inv > 0 || sk.speed < 60) return null;
  for (const o of others) {
    if (o.id === selfId) continue;
    if (o.st !== 'ski' && o.st !== 'crash' && o.st !== 'frozen') continue;
    const dx = o.x - sk.x, dy = o.y - sk.y;
    if (dx * dx + dy * dy < 144) { crash(sk, 0.6); return 'bump'; }
  }
  return null;
}

// --- bots -------------------------------------------------------------------
const PROBE = [20, 40, 60, 80, 100, 125, 150];
export function newBrain(rnd) {
  return { cd: 0, skill: 0.8 + rnd() * 0.15, pref: 0 };
}
export function botThink(sk, brain, terrain, rnd, dt) {
  brain.cd -= dt;
  if (brain.cd > 0) return null;
  brain.cd = 0.1 + rnd() * 0.12;
  if (sk.st !== 'ski') return null;

  const nearby = terrain.near(sk.y - 20, sk.y + 175);
  let best = 0, bestScore = Infinity, hopWorthy = false;
  for (let d = -2; d <= 2; d++) {
    const ang = DIR_ANGLE[Math.abs(d)] * Math.sign(d);
    const sx = Math.sin(ang), sy = Math.cos(ang);
    let pen = Math.abs(d) * 18 + Math.abs(d - brain.pref) * 6;
    for (const dist of PROBE) {
      const px = sk.x + sx * dist, py = sk.y + sy * dist;
      if (px < 40 || px > WORLD_W - 40) { pen += (170 - dist) * 2; break; }
      let hit = null;
      for (const ob of nearby) {
        const def = OB[ob.type];
        if (def.kind === 'ramp') continue;
        const rr = def.r + 9;
        const ddx = px - ob.x, ddy = py - (ob.y + def.oy);
        if (ddx * ddx + ddy * ddy < rr * rr) { hit = def; break; }
      }
      if (hit) {
        pen += (hit.kind === 'slow' ? 0.4 : 1) * (180 - dist) * 2;
        if (d === sk.d && dist <= 40 && !hit.tall && hit.kind === 'crash') hopWorthy = true;
        break;
      }
    }
    if (pen < bestScore) { bestScore = pen; best = d; }
  }
  if (hopWorthy && sk.hopCd <= 0 && rnd() < 0.6) return 'J';
  if (rnd() > brain.skill) best = Math.max(-2, Math.min(2, best + (rnd() < 0.5 ? -1 : 1)));
  if (rnd() < 0.02) brain.pref = Math.floor(rnd() * 3) - 1;
  if (best === sk.d) return null;
  if (best === 0 && Math.abs(sk.d) >= 2) return 'D';
  return best < sk.d ? 'L' : 'R';
}
