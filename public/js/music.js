// music.js — a tiny chiptune soundtrack, sequenced live with Web Audio.
// Two original loops: "cruise" (lobby, warm-up, results) and "chase"
// (once the Scope Creep is loose). Switches happen on the next bar line.
import { getCtx } from './audio.js';

let on = true;
try { on = localStorage.getItem('dd.music') !== '0'; } catch {}

const _ = null;
// MIDI note numbers, one entry per 16th note, 16 steps per bar.
const CRUISE = {
  bpm: 112,
  // I – vi – IV – V, twice; the second pass resolves home
  lead: [
    76, _, 79, _, 84, _, 79, _, 81, _, 79, _, 76, _, _, _,
    72, _, 76, _, 81, _, 76, _, 79, _, 76, _, 72, _, 74, _,
    77, _, 81, _, 84, _, 81, _, 79, _, 77, _, 76, _, 74, _,
    74, _, 79, _, 83, _, 79, _, 74, _, _, _, 71, _, 74, _,
    76, _, 79, _, 84, _, 79, _, 81, _, 79, _, 76, _, _, _,
    72, _, 76, _, 81, _, 76, _, 79, _, 76, _, 72, _, 74, _,
    77, _, 81, _, 84, _, 86, _, 84, _, 81, _, 79, _, 77, _,
    76, _, 74, _, 72, _, _, _, 79, _, 76, _, 72, _, _, _,
  ],
  roots: [48, 45, 41, 43, 48, 45, 41, 43],
  bass: [0, _, _, _, 12, _, _, _, 0, _, _, _, 12, _, 7, _],
  hats: [_, _, 1, _, _, _, 1, _, _, _, 1, _, _, _, 1, 1],
  leadWave: 'square', leadVol: 0.5,
};
const CHASE = {
  bpm: 140,
  // i – VI – VII – V in A minor: running arpeggios, still light on its feet
  lead: [
    81, _, 76, _, 72, _, 76, _, 81, _, 76, _, 84, _, 83, _,
    81, _, 77, _, 72, _, 77, _, 81, _, 77, _, 72, _, 77, _,
    79, _, 74, _, 71, _, 74, _, 79, _, 74, _, 83, _, 79, _,
    80, _, 76, _, 71, _, 76, _, 80, _, 83, _, 80, _, 76, _,
  ],
  roots: [45, 41, 43, 40],
  bass: [0, _, 12, _, 0, _, 12, _, 0, _, 12, _, 0, _, 12, _],
  hats: [1, _, 1, _, 1, _, 1, 1, 1, _, 1, _, 1, _, 1, 1],
  leadWave: 'square', leadVol: 0.42,
};
const TRACKS = { cruise: CRUISE, chase: CHASE };

const VOLUME = 0.045; // light: sits well under the sound effects

let bus = null, want = null, cur = null, step = 0, nextAt = 0, timer = null, hatBuf = null, level = 0;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function setup(ctx) {
  if (bus) return;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = 2600; filter.Q.value = 0.3;
  bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(filter).connect(ctx.destination);
  const n = Math.floor(ctx.sampleRate * 0.04);
  hatBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = hatBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
}

function note(ctx, t, midi, dur, wave, vol, dest = bus) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = wave; o.frequency.setValueAtTime(mtof(midi), t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(vol * 0.4, t + dur * 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.02);
}
function hat(ctx, t, vol, dest = bus, buf = hatBuf) {
  const s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = 6000;
  s.buffer = buf; g.gain.value = vol;
  s.connect(f).connect(g).connect(dest); s.start(t);
}

function schedule() {
  const ctx = getCtx();
  if (!ctx || ctx.state !== 'running' || !bus) return;
  if (!cur) return;
  if (nextAt < ctx.currentTime) nextAt = ctx.currentTime + 0.05;
  while (nextAt < ctx.currentTime + 0.15) {
    if (!want) { cur = null; return; }           // stopping: right away (the bus fades out)
    if (step % 16 === 0 && want !== cur) { cur = want; step = 0; } // switching: on a bar line
    const tr = TRACKS[cur];
    playStep(ctx, tr, step, nextAt, bus, hatBuf);
    nextAt += 60 / tr.bpm / 4; step++;
  }
}

function playStep(ctx, tr, step, t, dest, buf) {
  const sd = 60 / tr.bpm / 4;
  const i = step % tr.lead.length, s16 = step % 16, bar = Math.floor(step / 16) % tr.roots.length;
  const m = tr.lead[i];
  if (m !== null) {
    // hold until the next note (max an 8th) for a legato-ish feel
    let len = 1;
    while (len < 2 && tr.lead[(i + len) % tr.lead.length] === null) len++;
    note(ctx, t, m, sd * len * 0.95, tr.leadWave, tr.leadVol, dest);
  }
  const b = tr.bass[s16];
  if (b !== null) note(ctx, t, tr.roots[bar] + b, sd * 1.8, 'triangle', 0.9, dest);
  if (tr.hats[s16]) hat(ctx, t, s16 % 4 === 0 ? 0.35 : 0.22, dest, buf);
}

// Render a loop into any context (e.g. an OfflineAudioContext) for previews/tests.
export function renderLoop(ctx, name, bars, volume = VOLUME * 6) {
  const tr = TRACKS[name];
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = 2600; filter.Q.value = 0.3;
  const out = ctx.createGain(); out.gain.value = volume;
  out.connect(filter).connect(ctx.destination);
  const n = Math.floor(ctx.sampleRate * 0.04), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
  const sd = 60 / tr.bpm / 4;
  for (let st = 0; st < bars * 16; st++) playStep(ctx, tr, st, 0.05 + st * sd, out, buf);
  return 0.05 + bars * 16 * sd + 0.3;
}

function fade(to) {
  const ctx = getCtx();
  if (!ctx || !bus) return;
  bus.gain.cancelScheduledValues(ctx.currentTime);
  bus.gain.setTargetAtTime(to, ctx.currentTime, 0.25);
}

// Call every frame with 'cruise' | 'chase' | null.
export function setTrack(name) {
  const ctx = getCtx();
  if (!ctx) return;
  setup(ctx);
  want = on && !document.hidden ? name : null;
  const target = want ? VOLUME : 0;
  if (target !== level) { level = target; fade(target); }
  if (want && !cur) { cur = want; step = 0; nextAt = 0; }
  if (!timer) timer = setInterval(schedule, 25);
}

export function isMusicOn() { return on; }
export function setMusicOn(v) {
  on = v;
  try { localStorage.setItem('dd.music', v ? '1' : '0'); } catch {}
  if (!v) { want = null; level = 0; fade(0); }
}
