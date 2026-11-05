// audio.js — tiny synthesized sound effects (no audio files).
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('dd.muted') === '1'; } catch {}

export function unlock() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; } }
  if (ctx.state === 'suspended') ctx.resume();
}
export function getCtx() { return ctx; }
export function isMuted() { return muted; }
export function setMuted(m) { muted = m; try { localStorage.setItem('dd.muted', m ? '1' : '0'); } catch {} }

function tone(freq, dur, { type = 'square', vol = 0.08, slide = 0, delay = 0 } = {}) {
  if (muted || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
}
function noise(dur, vol = 0.12, delay = 0) {
  if (muted || !ctx) return;
  const n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = ctx.createBufferSource(), g = ctx.createGain();
  s.buffer = buf; g.gain.value = vol; s.connect(g).connect(ctx.destination); s.start(ctx.currentTime + delay);
}

export const sfx = {
  beep: () => tone(440, 0.15),
  go: () => { tone(660, 0.12); tone(880, 0.25, { delay: 0.12 }); },
  crash: () => { noise(0.25, 0.15); tone(160, 0.2, { slide: -100 }); },
  bump: () => tone(220, 0.1, { slide: -80 }),
  mogul: () => tone(120, 0.08, { type: 'triangle', vol: 0.12 }),
  hop: () => tone(500, 0.12, { slide: 300, vol: 0.05 }),
  ramp: () => tone(300, 0.4, { slide: 700, vol: 0.06 }),
  spawn: () => { tone(220, 0.5, { type: 'sawtooth', slide: -120, vol: 0.06 }); tone(165, 0.7, { type: 'sawtooth', slide: -90, vol: 0.06, delay: 0.4 }); },
  chomp: () => { for (let i = 0; i < 3; i++) { tone(90, 0.09, { vol: 0.14, delay: i * 0.16 }); noise(0.06, 0.1, i * 0.16); } },
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, { delay: i * 0.12 })),
};
