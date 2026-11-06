// sprites.js — every picture in the game, drawn as pixel art in code.
// All original artwork; nothing is loaded from image files.

const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function fromRows(rows, pal) {
  const h = rows.length, w = Math.max(...rows.map(r => r.length));
  const c = canvas(w, h), g = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const col = pal[rows[y][x]];
      if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
    }
  }
  return c;
}

function mirror(src) {
  const c = canvas(src.width, src.height), g = c.getContext('2d');
  g.translate(src.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0);
  return c;
}

export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

// --- skiers -------------------------------------------------------------------
const BODY = [
  '.....WW.....',
  '....hhhh....',
  '...hhhhhh...',
  '...kooook...',
  '...ssssss...',
  '....ssss....',
  '..dccccccd..',
  '.dccccccccd.',
  'sdcccwwcccds',
  'l.dccccccd.l',
  'l..pppppp..l',
  'l..pp..pp..l',
  'l..pp..pp..l',
  'l..kk..kk..l',
];
const BODY_TURNED = BODY.slice();
BODY_TURNED[3] = '....ksoook..';
BODY_TURNED[4] = '...sssssss..';

const SKIS = {
  0: ['...gg..gg...', '...gg..gg...', '...gg..gg...', '...gg..gg...', '...GG..GG...'],
  1: ['...gg..gg...', '....gg..gg..', '....gg..gg..', '.....gg..gg.', '.....GG..GG.'],
  2: ['....gg..gg..', '.....gg..gg.', '......gg..gg', '.......G...G', '............'],
  3: ['.gggggggggG.', 'gggggggggG..', '............', '............', '............'],
};
const CRASH = [
  '..........ww......',
  '.....g...hhhh..g..',
  '......g.hhhhhh.g..',
  '.......gkooook.g..',
  '..dccccsgssss.g...',
  '.dcccwwccgsss.g...',
  'sdcccwwcccg..g....',
  '.ldccccccd.gg.....',
  '.l.pppppppkkg.....',
  '.l.pp...pp..g.....',
  '...kk.......G.....',
];

// --- cosmetics: hats sit on the head (their bottom row lands just above the
// goggles); scarves wrap the neck with a tail hanging down -------------------------
const HAT_ART = {
  cowboy: { pal: { b: '#8b5a2b', B: '#a9713a', k: '#3d2614' }, rows: [
    '....bbbb....',
    '...bBBBBb...',
    '...bkkkkb...',
    'bbbbbbbbbbbb'] },
  tophat: { pal: { k: '#1d1b2f', K: '#34304f', r: '#e63946' }, rows: [
    '...kkkkkk...',
    '...kKKKKk...',
    '...kKKKKk...',
    '...krrrrk...',
    '.kkkkkkkkkk.'] },
  crown: { pal: { y: '#ffd23f', Y: '#d99a00', r: '#e63946', b: '#4cc9f0' }, rows: [
    '..y..yy..y..',
    '..yyyyyyyy..',
    '..yrybbyry..',
    '..YYYYYYYY..'] },
  party: { pal: { p: '#9b5de5', Y: '#ffd60a', w: '#ffffff' }, rows: [
    '.....ww.....',
    '.....pp.....',
    '....pYYp....',
    '....pppp....',
    '...pYYYYp...',
    '..pppppppp..'] },
  viking: { pal: { g: '#9aa5b1', G: '#6b7785', w: '#f1e3c6' }, rows: [
    'w..........w',
    'w...gggg...w',
    'ww.gGGGGg.ww',
    '.wggggggggw.'] },
  propeller: { pal: { r: '#e63946', b: '#457b9d', y: '#ffd60a', g: '#2a9d8f', k: '#1d1b2f' }, rows: [
    'rrrr.kk.bbbb',
    '.....kk.....',
    '...yyyyyy...',
    '..yrrbbggy..',
    '..yyyyyyyy..'] },
  chef: { pal: { w: '#ffffff', W: '#d6dde6' }, rows: [
    '...wwwwww...',
    '..wwWwwWww..',
    '..wwwwwwww..',
    '...wWwwWw...',
    '...wwwwww...',
    '...WWWWWW...'] },
};
const SCARF_COL = { red: '#e63946', gold: '#ffb703', mint: '#2ec4b6', navy: '#1d3557' };
const HAT_HEADROOM = 4; // extra rows above the base sprite for tall hats

function withScarf(rows) {
  const r = rows.slice();
  const put = (i, col, ch) => { r[i] = r[i].slice(0, col) + ch + r[i].slice(col + 1); };
  r[5] = '...SqSqSq...';
  put(6, 8, 'S'); put(7, 8, 'q'); put(8, 8, 'S'); // tail hanging over the jacket
  return r;
}

export function skier(pose, color, hat = 'beanie', scarf = 'none') {
  // pose: -3..3 for headings, 'crash'
  const key = `sk|${pose}|${color}|${hat}|${scarf}`;
  let s = cache.get(key);
  if (s) return s;
  const bare = hat !== 'beanie' && HAT_ART[hat];
  const pal = {
    w: '#ffffff', W: bare ? null : '#ffffff', h: bare ? null : color, c: color, d: shade(color, -0.35), k: '#1d1b2f', o: '#7ad7f0',
    s: '#f1c27d', p: '#34344a', g: '#f4a020', G: '#b8741a', l: '#6b6b7b',
    S: SCARF_COL[scarf] || null, q: '#ffffff',
  };
  if (pose === 'crash') {
    s = fromRows(CRASH, { ...pal, h: color, W: '#ffffff' }); // the hat fell off in the crash
  } else {
    const a = Math.abs(pose);
    let rows = (a >= 2 ? BODY_TURNED : BODY).concat(SKIS[a]);
    if (SCARF_COL[scarf]) rows = withScarf(rows);
    let body = fromRows(rows, pal);
    if (pose < 0) body = mirror(body);
    // compose with headroom so the anchor (bottom-centre) doesn't move
    s = canvas(14, body.height + HAT_HEADROOM);
    const g = s.getContext('2d');
    g.drawImage(body, 1, HAT_HEADROOM);
    if (bare) {
      const art = HAT_ART[hat];
      const hatImg = fromRows(art.rows, art.pal);
      g.drawImage(hatImg, 1, HAT_HEADROOM + 3 - art.rows.length);
    }
  }
  cache.set(key, s);
  return s;
}

// --- pickups ---------------------------------------------------------------------
const ICON_ART = {
  // hot cocoa: red mug, marshmallows, steam (internal id 'coffee')
  coffee: { pal: { s: '#b8c4d6', k: '#1d1b2f', b: '#6b3e1f', w: '#ffffff', r: '#e63946', R: '#b5262f' }, rows: [
    '.....s..s...',
    '....s..s....',
    '.....s..s...',
    '..kkkkkkkk..',
    '..kwbwwbwkkk',
    '..krrrrrrk.k',
    '..krwrrwrkkk',
    '..krrrrrrk..',
    '...kRRRRk...',
    '....kkkk....'] },
  // snowman decoy (internal id 'pto')
  pto: { pal: { k: '#1d1b2f', w: '#ffffff', s: '#c9d6ea', o: '#ff7b00', r: '#e63946' }, rows: [
    '....kkkk....',
    '...kwwwwk...',
    '...kwkwkk...',
    '...kwwoook..',
    '....kwwwk...',
    '..krrrrrrk..',
    '.kwwwkwwwsk.',
    '.kwwwwwwwsk.',
    '.kwwwkwwssk.',
    '..kkkkkkkk..'] },
  // a snowball (internal id 'invite')
  invite: { pal: { k: '#1d1b2f', w: '#ffffff', s: '#c9d6ea', S: '#9fb0cc' }, rows: [
    '....kkkk....',
    '..kkwwwwkk..',
    '.kwwwwwwwsk.',
    '.kwwwwwwwsk.',
    'kwwwwwwwwssk',
    'kwwwwwwwsssk',
    '.kwwwwwsssk.',
    '.kswwssssSk.',
    '..kkssSSkk..',
    '....kkkk....'] },
};
export function icon(type) {
  const key = `ic|${type}`;
  let s = cache.get(key);
  if (!s) { const a = ICON_ART[type]; s = fromRows(a.rows, a.pal); cache.set(key, s); }
  return s;
}
// Snowballs dropped on the slope: a little pile of three. (Function name kept
// from the work edition, where this was a meeting invite on an easel.)
export function meetingSign() {
  const key = 'meeting';
  let s = cache.get(key);
  if (s) return s;
  s = canvas(16, 18);
  const g = s.getContext('2d');
  const pile = fromRows([
    '.....kkkkk......',
    '....kwwwwwk.....',
    '...kwwwwwwsk....',
    '...kwwwwwssk....',
    '...kwwwwsssk....',
    '..kkksssskkkk...',
    '.kwwwwkkkwwwwk..',
    'kwwwwwwkwwwwwsk.',
    'kwwwwwwkwwwwssk.',
    'kwwwwwskwwwsssk.',
    'kwwwwsskwwssssk.',
    '.kwssskkksssSk..',
    '..kkkkk.kkkkk...',
    '................',
    '.ssssssssssssss.'], { k: '#1d1b2f', w: '#ffffff', s: '#c9d6ea', S: '#9fb0cc' });
  g.drawImage(pile, 0, 3);
  cache.set(key, s);
  return s;
}
// --- terrain ------------------------------------------------------------------
function pine(w, h, tiers, variant) {
  const c = canvas(w, h), g = c.getContext('2d');
  const cx = (w - 1) / 2;
  const trunkH = Math.round(h * 0.14);
  const bodyH = h - trunkH;
  const dark = '#1b4332', mid = variant % 2 ? '#2d6a4f' : '#2f7a4f', light = '#52b788';
  g.fillStyle = '#6b4226';
  g.fillRect(Math.round(cx) - 1, bodyH - 1, 3, trunkH + 1);
  g.fillStyle = '#4a2e1a';
  g.fillRect(Math.round(cx) + 1, bodyH - 1, 1, trunkH + 1);
  for (let t = 0; t < tiers; t++) {
    const top = Math.round(t * bodyH / (tiers + 0.6));
    const bot = Math.round(top + bodyH * 1.6 / (tiers + 0.6));
    const maxHW = (w / 2 - 1) * (0.55 + 0.45 * (t + 1) / tiers);
    for (let y = top; y < Math.min(bot, bodyH); y++) {
      const hw = maxHW * (y - top + 1) / (bot - top);
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        if (Math.abs(dx) > hw) continue;
        let col = mid;
        if (Math.abs(dx) > hw - 1.2) col = dark;
        else if (dx < -1 && ((x + y) % 3 === 0)) col = light;
        if (y - top < 2 + (variant & 1) && Math.abs(dx) < hw - 0.5) col = '#ffffff';
        if (y === Math.min(bot, bodyH) - 1 && Math.abs(dx) > hw - 3 && variant > 1) col = '#ffffff';
        g.fillStyle = col; g.fillRect(x, y, 1, 1);
      }
    }
  }
  return c;
}

function blob(w, h, fn) {
  const c = canvas(w, h), g = c.getContext('2d');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const col = fn(x, y, w, h);
    if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
  }
  return c;
}

function rock(v) {
  return blob(22, 14, (x, y, w, h) => {
    const nx = (x - w / 2 + 0.5) / (w / 2), ny = (y - h + 0.5) / h;
    const r = nx * nx + ny * ny * (1 + 0.15 * Math.sin(x * 1.7 + v));
    if (r > 1) return null;
    if (r > 0.82) return '#3a3a4a';
    if (y < 4 + (v & 1) && r < 0.7) return '#ffffff';
    if (nx < -0.2 && ny < -0.4) return '#c3c3d3';
    if (nx > 0.3 || ny > -0.15) return '#5c5c70';
    return '#8d8da0';
  });
}

function stump() {
  return blob(14, 11, (x, y, w, h) => {
    const nx = (x - w / 2 + 0.5) / (w / 2);
    if (Math.abs(nx) > 0.95) return null;
    if (y < 4) {
      const ny = (y - 2) / 2.2;
      const r = nx * nx + ny * ny;
      if (r > 1) return null;
      if (r > 0.75) return '#4a2e1a';
      return (Math.round(Math.sqrt(r) * 4) % 2) ? '#c8935b' : '#e0b07a';
    }
    if (Math.abs(nx) > 0.75) return '#4a2e1a';
    return x % 3 === 0 ? '#5c3a20' : '#7a4b2a';
  });
}

function mogul() {
  return blob(32, 10, (x, y, w, h) => {
    const nx = (x - w / 2 + 0.5) / (w / 2), ny = (y - h + 0.5) / h;
    const r = nx * nx + ny * ny;
    if (r > 1) return null;
    if (ny > -0.35 && nx > -0.4) return '#c6d4ea';
    if (r > 0.85) return '#d6e2f2';
    return nx < -0.2 && ny < -0.5 ? '#ffffff' : '#eef4fc';
  });
}

function ramp() {
  return blob(32, 14, (x, y, w, h) => {
    // a wooden kicker seen from above-front: wide at the bottom, lip at the top
    const inset = Math.round((y / h) * 0 + (1 - y / h) * 5);
    if (x < inset || x >= w - inset) return null;
    if (y === 0) return '#3d2614';
    if (y >= h - 3) return y === h - 1 ? '#3d2614' : '#8a5a2b';
    if (x === inset || x === w - inset - 1) return '#3d2614';
    const chev = ((x - Math.abs(y - 6) * 1.2 + 64) % 8) < 4;
    if (y >= 2 && y <= 9) return chev ? '#ff6b35' : '#ffd23f';
    return (x % 6 === 0) ? '#8a5a2b' : '#c98a4b';
  });
}

function deadTree(v) {
  const c = canvas(18, 28), g = c.getContext('2d');
  g.fillStyle = '#5c3a20';
  g.fillRect(8, 6, 2, 22);
  const br = [[8, 10, -1, 6], [10, 13, 1, 6], [8, 17, -1, 5], [10, 7, 1, 4], [8, 6, -1, 3]];
  for (const [x0, y0, dir, len] of br) {
    for (let i = 0; i < len; i++) { g.fillRect(x0 + dir * i, y0 - Math.floor(i * (0.7 + 0.1 * v)), 1, 1); }
  }
  g.fillStyle = '#ffffff';
  g.fillRect(8, 5, 2, 1); g.fillRect(3, 6, 2, 1); g.fillRect(14, 6, 2, 1);
  g.fillStyle = '#3d2614';
  g.fillRect(9, 6, 1, 22);
  return c;
}

export function obstacle(type, v) {
  const key = `ob|${type}|${v}`;
  let s = cache.get(key);
  if (s) return s;
  switch (type) {
    case 'tree': s = pine(20, 32, 3, v); break;
    case 'bigtree': s = pine(30, 48, 4, v); break;
    case 'deadtree': s = deadTree(v); break;
    case 'rock': s = rock(v); break;
    case 'stump': s = stump(); break;
    case 'mogul': s = mogul(); break;
    case 'ramp': s = ramp(); break;
  }
  cache.set(key, s);
  return s;
}

// --- the Yeti ---------------------------------------------------------------------
// A classic folklore yeti, drawn from scratch: big shaggy white fur, a
// blue-grey face, hands and feet, a heavy brow, dark eyes and fangs, and a
// party hat (it's an Avalanche Party, after all).
// Redrawn every frame into a small buffer so it can lumber, swing its arms,
// look around and chew.
const CW = 64, CH = 70;
let creepBuf = null;
export function creep(t, look, mouth) {
  if (!creepBuf) creepBuf = canvas(CW, CH);
  const g = creepBuf.getContext('2d');
  g.clearRect(0, 0, CW, CH);
  const px = (x, y, col) => { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), 1, 1); };
  const rect = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), w, h); };

  const FUR = '#f6f8fc', FUR2 = '#e2e8f2', SHADE = '#c3cedf', DEEP = '#a6b4ca', LINE = '#2c3445';
  const SKIN = '#8396b0', SKIN2 = '#647893', SKIN3 = '#4c5d75';
  const walk = Math.sin(t * 8);
  const chew = mouth > 0.3;

  // Build one fur silhouette (body + head + arms + legs) in a mask, then
  // outline it once so every part joins cleanly.
  const mask = new Uint8Array(CW * CH);
  const set = (x, y) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < CW && y < CH) mask[y * CW + x] = 1; };
  const blobFill = (cx, cy, rx, ry, seed, tuftAmt) => {
    for (let y = Math.floor(cy - ry - 3); y <= cy + ry + 3; y++) for (let x = Math.floor(cx - rx - 3); x <= cx + rx + 3; x++) {
      const dx = x - cx, dy = y - cy, a = Math.atan2(dy, dx);
      const tuft = Math.max(0, Math.sin(a * 15 + seed)) * tuftAmt + Math.max(0, Math.sin(a * 6 - seed)) * 0.06;
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1 + tuft) set(x, y);
    }
  };
  const hy = 16 + (chew ? Math.abs(Math.sin(t * 14)) : 0);
  const hands = [];
  // body: barrel chest
  blobFill(32, 39, 18, 19, 1.3 + Math.sin(t * 3) * 0.1, 0.22);
  // head: sits low between the shoulders
  blobFill(32, hy, 12, 11, 2.4, 0.3);
  // arms: chains of shaggy blobs from shoulder to wrist, swinging
  const armPaths = [];
  for (const [sx, dir, swing] of [[17, -1, walk * 3], [47, 1, -walk * 3]]) {
    const sy = 25, hx = sx + dir * 11 + swing, hyy = 49;
    for (let i = 0; i <= 8; i++) {
      const f = i / 8;
      blobFill(sx + (hx - sx) * f, sy + (hyy - sy) * f, 5 - f * 1.5, 4.5, i * 1.7, 0.35);
    }
    hands.push([hx, hyy + 3, dir]);
    armPaths.push([sx, sy, hx, hyy, dir]);
  }
  // legs: thick and short, stepping
  const feet = [];
  for (const [lx, ph] of [[24, 1], [40, -1]]) {
    const lift = Math.max(0, walk * ph) * 3;
    const y0 = 50 - lift, y1 = CH - 6 - lift;
    for (let y = y0; y <= y1; y++) for (let x = lx - 6; x <= lx + 6; x++) {
      if (Math.abs(x - lx) <= 5 + ((y % 3 === 0) ? 1 : 0)) set(x, y);
    }
    feet.push([lx, y1 + 1]);
  }
  // paint fur with a single outline around the whole silhouette
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    if (!mask[y * CW + x]) continue;
    const edge = !mask[y * CW + x - 1] || !mask[y * CW + x + 1] || !mask[(y - 1) * CW + x] || !mask[(y + 1) * CW + x] || x === 0 || x === CW - 1;
    if (edge) { px(x, y, LINE); continue; }
    // shading: lighter up-left, cooler down-right, with short fur strands
    const k = (y - 8) / 64 + Math.max(0, x - 30) / 120 + (Math.abs(x - 32) > 13 ? 0.08 : 0);
    const strand = ((x * 3 + y) % 7 === 0) || ((x + y * 2) % 13 === 0);
    px(x, y, k > 0.62 ? (strand ? DEEP : SHADE) : k > 0.3 ? (strand ? SHADE : FUR2) : (strand ? FUR2 : FUR));
  }
  // crease where each arm lies against the torso, so the arms read as arms
  for (const [sx, sy, hx, hyy, dir] of armPaths) {
    for (let i = 10; i <= 22; i++) {
      const f = i / 24, cx = sx + (hx - sx) * f, cy = sy + (hyy - sy) * f;
      const inner = cx - dir * (4.6 - f * 1.5);
      px(inner, cy, '#8a99b2'); px(inner - dir, cy, i > 13 ? DEEP : SHADE);
    }
  }
  // a striped party hat, tipped jauntily to one side, bobbing with the head
  {
    const by = 8 + (hy - 16);
    for (let r = 0; r <= 7; r++) {
      const y = by - r, half = Math.max(0, (7 - r) * 0.65), cx = 35 + r * 0.55;
      const x0 = Math.round(cx - half), x1 = Math.round(cx + half);
      for (let x = x0; x <= x1; x++) px(x, y, x === x0 || x === x1 ? LINE : ((x + r) % 4 < 2 ? '#f15bb5' : '#ffd60a'));
    }
    rect(30, by + 1, 11, 1, LINE);                               // brim
    const tx = Math.round(35 + 7 * 0.55), ty = by - 8;
    rect(tx - 1, ty - 1, 3, 2, '#00bbf9');                       // pompom
  }
  // big blue-grey feet
  for (const [lx, fy] of feet) {
    rect(lx - 7, fy, 15, 3, SKIN2); rect(lx - 7, fy + 3, 15, 1, LINE);
    for (let k = -5; k <= 5; k += 3) px(lx + k, fy, SKIN3);
  }
  // hands with claws
  for (const [hx, hy2, dir] of hands) {
    for (let y = 0; y < 6; y++) for (let x = -3; x <= 3; x++) {
      const edge = Math.abs(x) === 3 || y === 5;
      px(hx + x, hy2 + y, edge ? SKIN3 : (x * dir > 0 ? SKIN2 : SKIN));
    }
    for (let k = -2; k <= 2; k += 2) { px(hx + k, hy2 + 6, '#ffffff'); px(hx + k, hy2 + 7, '#ffffff'); }
  }
  // face: blue-grey, longer than wide
  for (let y = hy - 6; y < hy + 11; y++) for (let x = 22; x < 43; x++) {
    const dx = (x - 32.5) / 8.5, dy = (y - (hy + 2.5)) / 8.5;
    if (dx * dx + dy * dy < 1) px(x, y, dy > 0.45 ? SKIN2 : (dx > 0.45 ? SKIN2 : SKIN));
  }
  // heavy furry brow
  for (let x = 23; x <= 42; x++) {
    const yb = hy - 4 + (Math.abs(x - 32.5) > 6 ? 1 : 0);
    px(x, yb, x % 2 ? FUR : FUR2); px(x, yb - 1, FUR);
    if (x % 3 === 0) px(x, yb + 1, FUR2);
  }
  // eyes: dark, deep-set, with a glint; they glance toward the target
  const lx = Math.round(Math.max(-1, Math.min(1, look[0]))), ly = Math.round(Math.max(-1, Math.min(1, look[1])));
  const blink = (Math.floor(t * 1.3) % 5 === 0) && (t * 1.3 % 1 < 0.12);
  for (const ex of [28, 37]) {
    const ey = hy - 1;
    if (blink) { rect(ex - 2, ey, 4, 1, SKIN3); continue; }
    rect(ex - 2, ey - 1, 4, 3, '#ffffff');
    rect(ex - 1 + lx * 0.5, ey - 1 + Math.max(0, ly) * 0.5, 2, 2, '#14181f');
    px(ex - 1 + lx * 0.5, ey - 1, '#ffffff');
  }
  // nose
  rect(31, hy + 2, 3, 1, SKIN3); px(31, hy + 3, SKIN3); px(33, hy + 3, SKIN3);

  // mouth: a wide grimace with fangs; opens to chomp
  const mw = 12, mx = 32.5 - mw / 2, my = hy + 6;
  const open = Math.round(1 + mouth * 7);
  rect(mx, my, mw, open, '#1a0f14');
  if (mouth > 0.3) rect(mx + 3, my + open - 2, 6, 2, '#c9374a');
  // upper fangs, lower teeth
  rect(mx + 1, my, 2, 2 + (mouth > 0.3 ? 1 : 0), '#ffffff'); rect(mx + mw - 3, my, 2, 2 + (mouth > 0.3 ? 1 : 0), '#ffffff');
  if (open > 3) for (let i = 3; i < mw - 3; i += 2) px(mx + i, my + open - 1, '#ffffff');

  return creepBuf;
}
export const CREEP_W = CW, CREEP_H = CH;

// --- 5x7 pixel font -----------------------------------------------------------
const GLYPHS = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31],
  3: [31, 2, 4, 2, 1, 17, 14], 4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14],
  6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8], 8: [14, 17, 17, 14, 17, 17, 14],
  9: [14, 17, 17, 15, 1, 2, 12],
  '!': [4, 4, 4, 4, 4, 0, 4], '?': [14, 17, 1, 2, 4, 0, 4], '.': [0, 0, 0, 0, 0, 12, 12],
  '-': [0, 0, 0, 31, 0, 0, 0], '#': [10, 10, 31, 10, 31, 10, 10], ':': [0, 12, 12, 0, 12, 12, 0],
  "'": [4, 4, 8, 0, 0, 0, 0], '/': [1, 1, 2, 4, 8, 16, 16], ',': [0, 0, 0, 0, 12, 4, 8],
  '&': [12, 18, 20, 8, 21, 18, 13], '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8],
  '+': [0, 4, 4, 31, 4, 4, 0], '_': [0, 0, 0, 0, 0, 0, 31], ' ': [0, 0, 0, 0, 0, 0, 0],
  '^': [4, 10, 17, 0, 0, 0, 0],
};
export function fontText(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}
export function textWidth(s, scale = 1) { return fontText(s).length * 6 * scale - scale; }
// Draws text with its top-left at (x,y). Optional outline colour.
export function drawText(g, s, x, y, scale, color, outline) {
  s = fontText(s);
  const draw = (ox, oy, col) => {
    g.fillStyle = col;
    for (let i = 0; i < s.length; i++) {
      const gl = GLYPHS[s[i]] || GLYPHS['?'];
      for (let r = 0; r < 7; r++) {
        const bits = gl[r];
        if (!bits) continue;
        for (let b = 0; b < 5; b++) if (bits & (16 >> b)) g.fillRect(x + ox + (i * 6 + b) * scale, y + oy + r * scale, scale, scale);
      }
    }
  };
  if (outline) {
    const o = Math.max(1, Math.round(scale / 2));
    for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o], [-o, -o], [o, o], [-o, o], [o, -o]]) draw(dx, dy, outline);
  }
  draw(0, 0, color);
}
