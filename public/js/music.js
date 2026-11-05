// music.js — a tiny chiptune soundtrack, sequenced live with Web Audio.
// Three original loops that escalate with the game:
//   cruise — lobby / warm-up / results: breezy, major key
//   race   — from the countdown: driving 8th-note bass, backbeat, faster
//   chase  — once the Scope Creep is loose: minor key, and it speeds up a
//            little with every skier the monster eats
// Going up in intensity switches immediately (punchier); going back down to
// cruise waits for the bar line.
import { getCtx } from './audio.js';

let on = true;
try { on = localStorage.getItem('dd.music') !== '0'; } catch {}

const _ = null;
// MIDI note numbers, one entry per 16th note, 16 steps per bar.
const CRUISE = {
  bpm: 112, level: 0,
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
  snare: [],
  leadWave: 'square', leadVol: 0.5,
};
const RACE = {
  bpm: 152, level: 1,
  // I – vi – IV – V in D: syncopated, bright, on the gas
  lead: [
    74, _, 78, _, 81, _, _, 81, 83, _, 81, _, 78, _, 76, _,
    74, _, 78, _, 83, _, _, 83, 86, _, 83, _, 78, _, 74, _,
    71, _, 74, _, 79, _, _, 79, 83, _, 79, _, 74, _, 79, _,
    76, _, 81, _, 85, _, _, 85, 88, _, 85, _, 81, _, 79, 81,
    74, _, 78, _, 81, _, _, 81, 83, _, 81, _, 78, _, 76, _,
    74, _, 78, _, 83, _, _, 83, 86, _, 83, _, 86, _, 88, _,
    90, _, 86, _, 83, _, 79, _, 83, _, 86, _, 91, _, 86, _,
    88, _, 85, _, 81, _, 76, _, 81, _, 85, _, 88, _, _, _,
  ],
  roots: [38, 35, 43, 45, 38, 35, 43, 45],
  bass: [0, _, 12, _, 0, _, 12, _, 0, _, 12, _, 0, 12, 0, 12],
  hats: [1, _, 1, _, 1, _, 1, _, 1, _, 1, _, 1, _, 1, 1],
  snare: [_, _, _, _, 1, _, _, _, _, _, _, _, 1, _, _, _],
  leadWave: 'square', leadVol: 0.44,
};
const CHASE = {
  bpm: 146, level: 2,
  // i – VI – VII – V in A minor: running arpeggios over a pumping bass
  lead: [
    81, _, 76, _, 72, _, 76, _, 81, _, 76, _, 84, _, 83, _,
    81, _, 77, _, 72, _, 77, _, 81, _, 77, _, 72, _, 77, _,
    79, _, 74, _, 71, _, 74, _, 79, _, 74, _, 83, _, 79, _,
    80, _, 76, _, 71, _, 76, _, 80, _, 83, _, 80, _, 76, _,
  ],
  roots: [45, 41, 43, 40],
  bass: [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 12, 0, 12],
  hats: [1, _, 1, _, 1, _, 1, 1, 1, _, 1, _, 1, _, 1, 1],
  snare: [_, _, _, _, 1, _, _, _, _, _, _, _, 1, _, _, 1],
  leadWave: 'square', leadVol: 0.42,
};
const TRACKS = { cruise: CRUISE, race: RACE, chase: CHASE };

const VOLUME = 0.045;   // light: sits well under the sound effects
const BOOST_PER = 4;    // chase: +4 bpm for every skier eaten...
const BOOST_MAX = 32;   // ...up to +32

let bus = null, want = null, cur = null, step = 0, nextAt = 0, timer = null, level = 0, boost = 0;
let hatBuf = null, snareBuf = null;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function noiseBuf(ctx, secs, curve) {
  const n = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, curve);
  return b;
}

function setup(ctx) {
  if (bus) return;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = 2600; filter.Q.value = 0.3;
  bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(filter).connect(ctx.destination);
  hatBuf = noiseBuf(ctx, 0.04, 3);
  snareBuf = noiseBuf(ctx, 0.14, 2);
}

function note(ctx, t, midi, dur, wave, vol, dest) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = wave; o.frequency.setValueAtTime(mtof(midi), t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(vol * 0.4, t + dur * 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.02);
}
function perc(ctx, t, buf, type, freq, vol, dest) {
  const s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq;
  s.buffer = buf; g.gain.value = vol;
  s.connect(f).connect(g).connect(dest); s.start(t);
}

function bpmOf(tr, extra) { return tr.bpm + (tr === CHASE ? extra : 0); }

function playStep(ctx, tr, step, t, dest, bufs, extra = 0) {
  const sd = 60 / bpmOf(tr, extra) / 4;
  const i = step % tr.lead.length, s16 = step % 16, bar = Math.floor(step / 16) % tr.roots.length;
  const m = tr.lead[i];
  if (m !== null) {
    // hold until the next note (max an 8th) for a legato-ish feel
    let len = 1;
    while (len < 2 && tr.lead[(i + len) % tr.lead.length] === null) len++;
    note(ctx, t, m, sd * len * 0.95, tr.leadWave, tr.leadVol, dest);
  }
  const b = tr.bass[s16];
  if (b !== null) note(ctx, t, tr.roots[bar] + b, sd * (tr.level ? 0.9 : 1.8), 'triangle', 0.9, dest);
  if (tr.hats[s16]) perc(ctx, t, bufs.hat, 'highpass', 6000, s16 % 4 === 0 ? 0.35 : 0.22, dest);
  if (tr.snare[s16]) perc(ctx, t, bufs.snare, 'bandpass', 1800, 0.55, dest);
}

function schedule() {
  const ctx = getCtx();
  if (!ctx || ctx.state !== 'running' || !bus || !cur) return;
  if (nextAt < ctx.currentTime) nextAt = ctx.currentTime + 0.05;
  while (nextAt < ctx.currentTime + 0.15) {
    if (!want) { cur = null; return; } // stopping: right away (the bus fades out)
    if (want !== cur) {
      const up = TRACKS[want].level > TRACKS[cur].level;
      if (up || step % 16 === 0) { cur = want; step = 0; }
    }
    const tr = TRACKS[cur];
    playStep(ctx, tr, step, nextAt, bus, { hat: hatBuf, snare: snareBuf }, boost);
    nextAt += 60 / bpmOf(tr, boost) / 4; step++;
  }
}

function fade(to) {
  const ctx = getCtx();
  if (!ctx || !bus) return;
  bus.gain.cancelScheduledValues(ctx.currentTime);
  bus.gain.setTargetAtTime(to, ctx.currentTime, 0.25);
}

// Call every frame with 'cruise' | 'race' | 'chase' | null.
// meals = skiers eaten so far (speeds up the chase loop).
export function setTrack(name, meals = 0) {
  const ctx = getCtx();
  if (!ctx) return;
  setup(ctx);
  want = on && !document.hidden ? name : null;
  boost = Math.min(BOOST_MAX, BOOST_PER * meals);
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

// Render a loop into any context (e.g. an OfflineAudioContext) for previews/tests.
export function renderLoop(ctx, name, bars, volume = VOLUME * 6, meals = 0) {
  const tr = TRACKS[name];
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = 2600; filter.Q.value = 0.3;
  const out = ctx.createGain(); out.gain.value = volume;
  out.connect(filter).connect(ctx.destination);
  const bufs = { hat: noiseBuf(ctx, 0.04, 3), snare: noiseBuf(ctx, 0.14, 2) };
  const extra = Math.min(BOOST_MAX, BOOST_PER * meals);
  const sd = 60 / bpmOf(tr, extra) / 4;
  for (let st = 0; st < bars * 16; st++) playStep(ctx, tr, st, 0.05 + st * sd, out, bufs, extra);
  return 0.05 + bars * 16 * sd + 0.3;
}

export function nowPlaying() { return cur; }
