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
  '.....ww.....',
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

export function skier(pose, color) {
  // pose: -3..3 for headings, 'crash'
  const key = `sk|${pose}|${color}`;
  let s = cache.get(key);
  if (s) return s;
  const pal = {
    w: '#ffffff', h: color, c: color, d: shade(color, -0.35), k: '#1d1b2f', o: '#7ad7f0',
    s: '#f1c27d', p: '#34344a', g: '#f4a020', G: '#b8741a', l: '#6b6b7b',
  };
  if (pose === 'crash') s = fromRows(CRASH, pal);
  else {
    const a = Math.abs(pose);
    const rows = (a >= 2 ? BODY_TURNED : BODY).concat(SKIS[a]);
    s = fromRows(rows, pal);
    if (pose < 0) s = mirror(s);
  }
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

// --- the Scope Creep --------------------------------------------------------------
// A lumpy indigo snow-slug, three eyes, too many teeth, covered in sticky notes.
// Redrawn every frame into a small buffer so it can wobble and look around.
const CW = 56, CH = 60;
let creepBuf = null;
export function creep(t, look, mouth) {
  if (!creepBuf) creepBuf = canvas(CW, CH);
  const g = creepBuf.getContext('2d');
  g.clearRect(0, 0, CW, CH);
  const cx = CW / 2, cy = 36;
  const px = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };

  // body
  for (let y = 4; y < CH; y++) for (let x = 0; x < CW; x++) {
    const dx = x - cx + 0.5, dy = y - cy;
    const ang = Math.atan2(dy, dx);
    const rx = 24 + Math.sin(ang * 4 + t * 5) * 1.6;
    const ry = (dy < 0 ? 30 : 23) + Math.sin(ang * 3 - t * 4) * 1.4;
    const r = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
    if (r > 1 || y >= CH - 1) continue;
    let col = '#5a4fcf';
    if (r > 0.86) col = '#221d55';
    else if (dy > 12) col = '#3f37a0';
    else if (dx < -6 && dy < -8 && (x + y) % 2 === 0) col = '#8a80ff';
    if (dy < -24 + Math.sin(x * 0.9) * 2 && r <= 0.86) col = '#ffffff'; // snow on its head
    px(x, y, col);
  }
  // drippy base
  for (let x = 6; x < CW - 6; x++) {
    const d = Math.round(1.5 + Math.sin(x * 0.8 + t * 6) * 1.5);
    for (let k = 0; k < d; k++) px(x, CH - 3 + k, '#3f37a0');
  }
  // sticky notes stuck all over it
  const notes = [[9, 25, '#ffd60a'], [41, 21, '#ff8fab'], [12, 43, '#90e0ef'], [39, 41, '#ffd60a']];
  for (const [nx, ny, col] of notes) {
    g.fillStyle = col; g.fillRect(nx, ny, 6, 6);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(nx + 1, ny + 2, 4, 1); g.fillRect(nx + 1, ny + 4, 3, 1);
  }
  // stubby flailing arms
  const wave = Math.sin(t * 9) * 3;
  g.fillStyle = '#4b42b8';
  g.fillRect(1, 30 + wave, 5, 4); g.fillRect(0, 26 + wave, 3, 5);
  g.fillRect(CW - 6, 30 - wave, 5, 4); g.fillRect(CW - 3, 26 - wave, 3, 5);
  // eyes that track their target
  const lx = Math.max(-1, Math.min(1, look[0])), ly = Math.max(-1, Math.min(1, look[1]));
  const blink = (Math.floor(t * 1.3) % 5 === 0) && (t * 1.3 % 1 < 0.12);
  for (const [ex, ey, r] of [[17, 20, 4], [28, 14, 5], [39, 20, 4]]) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r + 1) continue;
      px(ex + x, ey + y, blink ? '#3f37a0' : (x * x + y * y > (r - 1) * (r - 1) + 1 ? '#221d55' : '#ffffff'));
    }
    if (!blink) { g.fillStyle = '#ff2e63'; g.fillRect(ex + Math.round(lx * (r - 2)) - 1, ey + Math.round(ly * (r - 2)) - 1, 3, 3); g.fillStyle = '#000'; g.fillRect(ex + Math.round(lx * (r - 2)), ey + Math.round(ly * (r - 2)), 1, 1); }
  }
  // mouth
  const mw = 30, mx = cx - mw / 2;
  const open = Math.round(2 + mouth * 12);
  const my = 31;
  g.fillStyle = '#2b0a2e';
  g.fillRect(mx, my, mw, open);
  if (mouth > 0.3) { g.fillStyle = '#e5383b'; g.fillRect(mx + 8, my + open - 4, 14, 3); }
  g.fillStyle = '#ffffff';
  for (let i = 0; i < mw; i += 4) {
    g.fillRect(mx + i, my, 3, 2); g.fillRect(mx + i + 1, my + 2, 1, 1);
    g.fillRect(mx + i + 2, my + open - 2, 3, 2); g.fillRect(mx + i + 3, my + open - 3, 1, 1);
  }
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
