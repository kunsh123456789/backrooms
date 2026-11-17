// Offline procedural sound synthesis into raw sample arrays.
// Every sound in the game is generated here at startup; no audio files.

import { RNG } from '../core/math.js';

export const SR = 44100;

// ---------- primitive DSP ----------
export function white(n, rng) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = rng.next() * 2 - 1;
  return a;
}
export function pink(n, rng) {
  const a = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rng.next() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    a[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return a;
}
export function brown(n, rng) {
  const a = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * (rng.next() * 2 - 1)) / 1.02;
    a[i] = last * 3.5;
  }
  return a;
}
export function lp1(a, fc) {
  const k = 1 - Math.exp((-2 * Math.PI * fc) / SR);
  let y = 0;
  for (let i = 0; i < a.length; i++) {
    y += (a[i] - y) * k;
    a[i] = y;
  }
  return a;
}
export function hp1(a, fc) {
  const k = 1 - Math.exp((-2 * Math.PI * fc) / SR);
  let y = 0;
  for (let i = 0; i < a.length; i++) {
    y += (a[i] - y) * k;
    a[i] = a[i] - y;
  }
  return a;
}
/** RBJ biquad; type 'bp' | 'lp' | 'hp'. fc may be a function of sample index. */
export function biquad(a, type, fc, q = 1, out = null) {
  const o = out || new Float32Array(a.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let b0, b1, b2, a1, a2;
  const fcFn = typeof fc === 'function' ? fc : null;
  const coef = (f) => {
    const w = (2 * Math.PI * Math.min(f, SR * 0.45)) / SR;
    const cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q);
    const a0 = 1 + al;
    if (type === 'bp') {
      b0 = al / a0; b1 = 0; b2 = -al / a0;
    } else if (type === 'lp') {
      b0 = (1 - cs) / 2 / a0; b1 = (1 - cs) / a0; b2 = b0;
    } else {
      b0 = (1 + cs) / 2 / a0; b1 = -(1 + cs) / a0; b2 = b0;
    }
    a1 = (-2 * cs) / a0;
    a2 = (1 - al) / a0;
  };
  coef(fcFn ? fcFn(0) : fc);
  for (let i = 0; i < a.length; i++) {
    if (fcFn && (i & 31) === 0) coef(fcFn(i));
    const x = a[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    o[i] = y;
  }
  return o;
}
function env(a, fn) {
  for (let i = 0; i < a.length; i++) a[i] *= fn(i / SR);
  return a;
}
function mix(dst, src, gain = 1, offset = 0) {
  for (let i = 0; i < src.length && i + offset < dst.length; i++) dst[i + offset] += src[i] * gain;
  return dst;
}
function normalize(a, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= peak / m;
  return a;
}
function sine(n, f, phase = 0) {
  const a = new Float32Array(n);
  let p = phase;
  for (let i = 0; i < n; i++) {
    const fr = typeof f === 'function' ? f(i / SR) : f;
    p += (2 * Math.PI * fr) / SR;
    a[i] = Math.sin(p);
  }
  return a;
}
function fadeEdges(a, ms = 4) {
  const n = Math.min(a.length >> 1, Math.floor((ms / 1000) * SR));
  for (let i = 0; i < n; i++) {
    a[i] *= i / n;
    a[a.length - 1 - i] *= i / n;
  }
  return a;
}
const N = (sec) => Math.floor(sec * SR);

// ---------- footsteps ----------
export function footstep(surface, seed) {
  const rng = new RNG(seed);
  const v = rng.range(0.85, 1.15);
  let out;
  switch (surface) {
    case 'carpet':
    case 'wetcarpet': {
      const wet = surface === 'wetcarpet';
      out = new Float32Array(N(wet ? 0.42 : 0.3));
      const thump = lp1(lp1(brown(N(0.12), rng), 260 * v), 300);
      env(thump, (t) => Math.exp(-t / 0.03) * Math.min(1, t / 0.004));
      mix(out, thump, 1.6);
      const sq = biquad(white(N(wet ? 0.35 : 0.2), rng), 'bp', (i) => (wet ? 900 : 700) * v * (1 - (i / SR) * 1.2), wet ? 1.6 : 1.1);
      env(sq, (t) => Math.min(1, t / 0.015) * Math.exp(-t / (wet ? 0.09 : 0.045)));
      mix(out, sq, wet ? 0.55 : 0.25, N(0.008));
      if (wet) {
        // squelch: wet crackle of little pops
        for (let k = 0; k < 14; k++) {
          const at = N(rng.range(0.02, 0.25));
          const pop = biquad(white(N(0.01), rng), 'bp', rng.range(1500, 3500), 4);
          env(pop, (t) => Math.exp(-t / 0.002));
          mix(out, pop, rng.range(0.05, 0.15), at);
        }
      }
      break;
    }
    case 'housecarpet': {
      out = new Float32Array(N(0.22));
      const thump = lp1(lp1(brown(N(0.12), rng), 220 * v), 260);
      env(thump, (t) => Math.exp(-t / 0.025) * Math.min(1, t / 0.004));
      mix(out, thump, 1.4);
      const sc = biquad(white(N(0.12), rng), 'bp', 1800 * v, 0.8);
      env(sc, (t) => Math.min(1, t / 0.02) * Math.exp(-t / 0.03));
      mix(out, sc, 0.06);
      break;
    }
    case 'wood': {
      out = new Float32Array(N(0.3));
      const body = sine(N(0.12), (t) => 140 * v * (1 - t * 2));
      env(body, (t) => Math.exp(-t / 0.03));
      mix(out, body, 0.5);
      const tr = biquad(white(N(0.04), rng), 'bp', 1200 * v, 1.2);
      env(tr, (t) => Math.exp(-t / 0.008));
      mix(out, tr, 0.6);
      if (rng.chance(0.3)) {
        const creak = biquad(sine(N(0.18), (t) => 300 + 80 * Math.sin(t * 40)), 'bp', 900, 3);
        env(creak, (t) => Math.sin(Math.PI * Math.min(1, t / 0.18)) * 0.5);
        mix(out, creak, 0.25, N(0.05));
      }
      break;
    }
    case 'concrete': {
      out = new Float32Array(N(0.25));
      const tr = hp1(white(N(0.05), rng), 1400 * v);
      env(tr, (t) => Math.exp(-t / 0.006));
      mix(out, tr, 0.9);
      const grit = biquad(white(N(0.09), rng), 'bp', 3200 * v, 1.4);
      env(grit, (t) => Math.exp(-t / 0.02));
      mix(out, grit, 0.35, N(0.004));
      const body = sine(N(0.08), (t) => 110 * v * (1 - t * 3));
      env(body, (t) => Math.exp(-t / 0.018));
      mix(out, body, 0.6);
      break;
    }
    case 'tile': {
      out = new Float32Array(N(0.22));
      const tr = biquad(white(N(0.03), rng), 'bp', 3400 * v, 2);
      env(tr, (t) => Math.exp(-t / 0.004));
      mix(out, tr, 1.2);
      const ring = sine(N(0.06), 2300 * v);
      env(ring, (t) => Math.exp(-t / 0.012));
      mix(out, ring, 0.12);
      const body = sine(N(0.06), 160 * v);
      env(body, (t) => Math.exp(-t / 0.012));
      mix(out, body, 0.35);
      if (rng.chance(0.6)) {
        const sl = biquad(white(N(0.12), rng), 'bp', 1600, 2);
        env(sl, (t) => Math.sin(Math.PI * Math.min(1, t / 0.12)));
        mix(out, sl, 0.12, N(0.01));
      }
      break;
    }
    case 'water': {
      out = new Float32Array(N(0.6));
      const sp = biquad(white(N(0.55), rng), 'bp', (i) => 1400 * v * Math.exp(-(i / SR) * 3) + 250, 1.5);
      env(sp, (t) => Math.min(1, t / 0.03) * Math.exp(-t / 0.15));
      mix(out, sp, 0.9);
      for (let k = 0; k < 5; k++) {
        const f0 = rng.range(500, 1300);
        const b = sine(N(0.05), (t) => f0 * (1 + t * 14));
        env(b, (t) => Math.exp(-t / 0.012));
        mix(out, b, rng.range(0.05, 0.12), N(rng.range(0.05, 0.35)));
      }
      break;
    }
    case 'metal': {
      out = new Float32Array(N(0.6));
      const tr = hp1(white(N(0.03), rng), 2000);
      env(tr, (t) => Math.exp(-t / 0.005));
      mix(out, tr, 0.7);
      const modes = [380, 1040, 1760, 2590, 3400];
      for (const m of modes) {
        const s = sine(N(0.55), m * v * rng.range(0.97, 1.03));
        const d = rng.range(0.05, 0.18);
        env(s, (t) => Math.exp(-t / d));
        mix(out, s, 0.12 * rng.range(0.5, 1));
      }
      const body = sine(N(0.1), 90);
      env(body, (t) => Math.exp(-t / 0.02));
      mix(out, body, 0.4);
      break;
    }
    default: {
      out = new Float32Array(N(0.2));
      const tr = lp1(white(N(0.06), rng), 800);
      env(tr, (t) => Math.exp(-t / 0.01));
      mix(out, tr, 1);
    }
  }
  return fadeEdges(normalize(out, 0.8));
}

// ---------- breathing ----------
export function breath(kind, heavy, seed) {
  const rng = new RNG(seed);
  const dur = heavy ? rng.range(0.45, 0.65) : rng.range(0.9, 1.3);
  const n = N(dur);
  const src = pink(n, rng);
  const out = new Float32Array(n);
  const f1 = kind === 'in' ? 1150 : 780, f2 = kind === 'in' ? 2600 : 1700;
  const a = biquad(src, 'bp', (i) => f1 * (1 + 0.08 * Math.sin((i / n) * 3)), 1.6);
  const b = biquad(src, 'bp', f2, 2.2);
  mix(out, a, 1);
  mix(out, b, kind === 'in' ? 0.6 : 0.35);
  if (heavy && kind === 'out') {
    // a little voiced strain
    const vo = sine(n, (t) => 120 + 15 * Math.sin(t * 9));
    const vf = biquad(vo, 'bp', 600, 2);
    mix(out, vf, 0.06);
  }
  env(out, (t) => {
    const x = t / dur;
    return kind === 'in' ? Math.pow(Math.sin(Math.PI * Math.min(1, x * 1.1)), 1.5) * (0.6 + 0.4 * x) : Math.pow(Math.sin(Math.PI * x), 0.8) * (1 - x * 0.5);
  });
  return fadeEdges(normalize(out, heavy ? 0.85 : 0.55));
}

// ---------- formant voice ----------
const VOWELS = {
  a: [800, 1150, 2900], e: [530, 1840, 2480], i: [300, 2200, 3000], o: [500, 850, 2400], u: [330, 870, 2300],
  l: [380, 1200, 2700], m: [260, 1100, 2400], uh: [600, 1200, 2500], ee: [280, 2300, 3100],
};
/**
 * segs: [{p: phoneme | 'h' | 'stop' | 'noise', d: seconds, f0: Hz, amp}]
 */
export function voice(segs, { breathy = 0.15, seed = 1, f0Base = 140 } = {}) {
  const rng = new RNG(seed);
  const total = segs.reduce((s, x) => s + x.d, 0) + 0.3;
  const n = N(total);
  // per-sample parameter tracks
  const F = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const amp = new Float32Array(n), asp = new Float32Array(n), pitch = new Float32Array(n);
  let t0 = 0;
  let prev = VOWELS.uh;
  for (const s of segs) {
    const i0 = N(t0), i1 = Math.min(n, N(t0 + s.d));
    const tgt = VOWELS[s.p] || prev;
    for (let i = i0; i < i1; i++) {
      const x = (i - i0) / Math.max(1, i1 - i0);
      const k = Math.min(1, x * 3); // formant glide
      for (let f = 0; f < 3; f++) F[f][i] = prev[f] + (tgt[f] - prev[f]) * k;
      const f0 = s.f0 ? (Array.isArray(s.f0) ? s.f0[0] + (s.f0[1] - s.f0[0]) * x : s.f0) : f0Base;
      pitch[i] = f0;
      if (s.p === 'h') {
        amp[i] = 0.05;
        asp[i] = 0.5 * (s.amp ?? 1);
      } else if (s.p === 'stop') {
        amp[i] = 0;
        asp[i] = x > 0.75 ? 0.6 : 0;
      } else {
        amp[i] = (s.amp ?? 1) * (s.p === 'l' || s.p === 'm' ? 0.55 : 1);
        asp[i] = breathy;
      }
    }
    if (VOWELS[s.p]) prev = tgt;
    t0 += s.d;
  }
  // smooth amplitude
  lp1(amp, 30);
  lp1(asp, 40);
  // glottal source
  const src = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += (pitch[i] * (1 + (rng.next() - 0.5) * 0.02)) / SR;
    if (ph > 1) ph -= 1;
    const g = ph < 0.6 ? Math.sin((ph / 0.6) * Math.PI) : 0; // rosenberg-ish pulse
    src[i] = (g - 0.35) * amp[i] + (rng.next() * 2 - 1) * asp[i];
  }
  const out = new Float32Array(n);
  const gains = [1, 0.5, 0.25];
  for (let f = 0; f < 3; f++) {
    const y = biquad(src, 'bp', (i) => F[f][i], 6 + f * 2);
    mix(out, y, gains[f]);
  }
  return fadeEdges(normalize(out, 0.8), 10);
}

export const VOICE_LINES = {
  hello: [
    { p: 'h', d: 0.08 }, { p: 'e', d: 0.16, f0: [150, 160] }, { p: 'l', d: 0.07, f0: 158 }, { p: 'o', d: 0.42, f0: [160, 205] },
  ],
  help: [
    { p: 'h', d: 0.1 }, { p: 'e', d: 0.22, f0: [190, 175] }, { p: 'l', d: 0.08, f0: 170 }, { p: 'stop', d: 0.1 },
  ],
  helpme: [
    { p: 'h', d: 0.1 }, { p: 'e', d: 0.2, f0: [185, 175] }, { p: 'l', d: 0.06, f0: 170 }, { p: 'stop', d: 0.07 },
    { p: 'm', d: 0.08, f0: 175 }, { p: 'ee', d: 0.32, f0: [180, 150] },
  ],
  overhere: [
    { p: 'o', d: 0.14, f0: [150, 145] }, { p: 'uh', d: 0.1, f0: 140 }, { p: 'h', d: 0.06 }, { p: 'ee', d: 0.18, f0: [155, 170] }, { p: 'uh', d: 0.2, f0: [165, 140] },
  ],
  murmur: [
    { p: 'uh', d: 0.12, f0: 110 }, { p: 'm', d: 0.1, f0: 105 }, { p: 'o', d: 0.18, f0: 112 }, { p: 'h', d: 0.05 }, { p: 'a', d: 0.14, f0: 108 }, { p: 'm', d: 0.12, f0: 100 }, { p: 'uh', d: 0.2, f0: 95 },
  ],
  giggle: [
    { p: 'h', d: 0.04 }, { p: 'ee', d: 0.08, f0: 320 }, { p: 'h', d: 0.04 }, { p: 'ee', d: 0.08, f0: 340 }, { p: 'h', d: 0.04 }, { p: 'ee', d: 0.1, f0: 330 }, { p: 'h', d: 0.05 }, { p: 'ee', d: 0.14, f0: [320, 280] },
  ],
};

// ---------- world sounds ----------
export function makeSound(name, seed = 1) {
  const rng = new RNG(seed);
  switch (name) {
    case 'doorslam': {
      const out = new Float32Array(N(1.2));
      const th = lp1(lp1(brown(N(0.5), rng), 120), 160);
      env(th, (t) => Math.exp(-t / 0.08));
      mix(out, th, 2);
      const latch = hp1(white(N(0.03), rng), 2500);
      env(latch, (t) => Math.exp(-t / 0.004));
      mix(out, latch, 0.4, N(0.02));
      const rat = biquad(white(N(0.3), rng), 'bp', 900, 3);
      env(rat, (t) => Math.exp(-t / 0.05) * (0.6 + 0.4 * Math.sin(t * 160)));
      mix(out, rat, 0.2, N(0.03));
      return normalize(out);
    }
    case 'thump': {
      const out = new Float32Array(N(1.0));
      const s = sine(N(0.6), (t) => 55 * (1 - t * 0.6));
      env(s, (t) => Math.exp(-t / 0.12) * Math.min(1, t / 0.005));
      mix(out, s, 1);
      const b = lp1(brown(N(0.4), rng), 200);
      env(b, (t) => Math.exp(-t / 0.06));
      mix(out, b, 1.2);
      return normalize(out);
    }
    case 'knock': {
      const out = new Float32Array(N(1.6));
      const k = rng.int(2, 4);
      for (let i = 0; i < k; i++) {
        const s = lp1(white(N(0.08), rng), 900);
        env(s, (t) => Math.exp(-t / 0.012));
        const b = sine(N(0.08), 180);
        env(b, (t) => Math.exp(-t / 0.02));
        mix(out, s, 1, N(i * rng.range(0.22, 0.32)));
        mix(out, b, 0.5, N(i * 0.27));
      }
      return normalize(out);
    }
    case 'drag': {
      const d = rng.range(2.2, 3.6);
      const out = new Float32Array(N(d));
      const s = biquad(brown(N(d), rng), 'bp', (i) => 380 + 120 * Math.sin(i / SR * 3.1), 0.9);
      const grit = biquad(white(N(d), rng), 'bp', 1400, 1.2);
      let g = 0;
      env(s, (t) => {
        g += (rng.next() - 0.5) * 0.3;
        g = Math.max(-1, Math.min(1, g * 0.98));
        return (0.6 + 0.4 * g) * Math.sin(Math.PI * Math.min(1, t / d));
      });
      env(grit, (t) => (0.3 + 0.7 * Math.abs(Math.sin(t * 7 + Math.sin(t * 2.3) * 3))) * Math.sin(Math.PI * Math.min(1, t / d)));
      mix(out, s, 1.5);
      mix(out, grit, 0.25);
      return fadeEdges(normalize(out), 30);
    }
    case 'clank': {
      const out = new Float32Array(N(2.2));
      const tr = hp1(white(N(0.03), rng), 1500);
      env(tr, (t) => Math.exp(-t / 0.006));
      mix(out, tr, 0.6);
      const base = rng.range(180, 320);
      for (const r of [1, 2.76, 5.4, 8.93, 13.3]) {
        const s = sine(N(2.0), base * r * rng.range(0.98, 1.02));
        const dd = rng.range(0.2, 0.9) / Math.sqrt(r);
        env(s, (t) => Math.exp(-t / dd));
        mix(out, s, 0.25 / Math.sqrt(r));
      }
      return normalize(out);
    }
    case 'creak': {
      const d = rng.range(0.8, 1.6);
      const out = new Float32Array(N(d));
      let ph = 0;
      const f0 = rng.range(90, 170);
      for (let i = 0; i < out.length; i++) {
        const t = i / SR;
        const f = f0 * (1 + 0.3 * Math.sin(t * 3.0 + 1)) + (rng.next() - 0.5) * 20;
        ph += f / SR;
        out[i] = ph % 1 < 0.08 ? 1 : 0; // stick-slip pulses
      }
      const y = biquad(out, 'bp', 1100, 2);
      mix(y, biquad(out, 'bp', 2400, 3), 0.5);
      env(y, (t) => Math.sin(Math.PI * (t / d)));
      return fadeEdges(normalize(y), 10);
    }
    case 'drip': {
      const out = new Float32Array(N(0.4));
      const f0 = rng.range(900, 1600);
      const s = sine(N(0.12), (t) => f0 * (1 + t * 18));
      env(s, (t) => Math.exp(-t / 0.018) * Math.min(1, t / 0.001));
      mix(out, s, 1);
      return normalize(out, 0.7);
    }
    case 'lightclunk': {
      const out = new Float32Array(N(0.8));
      const cl = biquad(white(N(0.05), rng), 'bp', 1800, 1.5);
      env(cl, (t) => Math.exp(-t / 0.006));
      mix(out, cl, 0.6);
      const th = lp1(brown(N(0.3), rng), 180);
      env(th, (t) => Math.exp(-t / 0.05));
      mix(out, th, 1.2);
      // ballast buzz dying out
      const bz = new Float32Array(N(0.5));
      for (let i = 0; i < bz.length; i++) bz[i] = ((i * 120) / SR) % 1 < 0.5 ? 1 : -1;
      const bzf = biquad(bz, 'bp', 2000, 1);
      env(bzf, (t) => Math.exp(-t / 0.08));
      mix(out, bzf, 0.15, N(0.01));
      return normalize(out, 0.8);
    }
    case 'flick': {
      const out = new Float32Array(N(0.09));
      const z = new Float32Array(out.length);
      for (let i = 0; i < z.length; i++) z[i] = (((i * 120) / SR) % 1 < 0.5 ? 1 : -1) + (rng.next() - 0.5) * 1.5;
      const y = biquad(z, 'bp', rng.range(2500, 4500), 0.8);
      env(y, (t) => Math.exp(-t / 0.02));
      mix(out, y, 1);
      const tick = hp1(white(N(0.006), rng), 3000);
      mix(out, tick, 0.8);
      return normalize(out, 0.6);
    }
    case 'clocktick': {
      const out = new Float32Array(N(0.05));
      const s = biquad(white(N(0.02), rng), 'bp', rng.range(3200, 3800), 4);
      env(s, (t) => Math.exp(-t / 0.002));
      mix(out, s, 1);
      const r = sine(N(0.03), 4100);
      env(r, (t) => Math.exp(-t / 0.004));
      mix(out, r, 0.2);
      return normalize(out, 0.7);
    }
    case 'paper': {
      const out = new Float32Array(N(0.5));
      const s = biquad(white(N(0.5), rng), 'bp', 3000, 0.8);
      env(s, (t) => (rng.next() < 0.3 ? 1 : 0.3) * Math.sin(Math.PI * (t / 0.5)));
      mix(out, s, 1);
      return normalize(out, 0.5);
    }
    case 'bottle': {
      const out = new Float32Array(N(0.6));
      for (let k = 0; k < 8; k++) {
        const f0 = rng.range(300, 900);
        const b = sine(N(0.08), (t) => f0 * (1 + t * 8));
        env(b, (t) => Math.exp(-t / 0.02));
        mix(out, b, 0.3, N(rng.range(0, 0.4)));
      }
      const sl = biquad(white(N(0.5), rng), 'bp', 700, 1.5);
      env(sl, (t) => Math.sin(Math.PI * (t / 0.5)) * 0.4);
      mix(out, sl, 0.5);
      return normalize(out, 0.6);
    }
    case 'click': {
      const out = new Float32Array(N(0.06));
      const s = biquad(white(N(0.02), rng), 'bp', 2200, 3);
      env(s, (t) => Math.exp(-t / 0.003));
      mix(out, s, 1);
      mix(out, sine(N(0.01), 1200), 0.2);
      return normalize(out, 0.5);
    }
    case 'static': {
      const out = white(N(0.6), rng);
      biquad(out, 'bp', 3000, 0.5, out);
      env(out, (t) => Math.min(1, t / 0.01) * (t > 0.5 ? (0.6 - t) * 10 : 1));
      return normalize(out, 0.5);
    }
    case 'heartbeat': {
      const out = new Float32Array(N(0.8));
      for (const [at, g] of [[0, 1], [0.22, 0.7]]) {
        const s = sine(N(0.18), (t) => 55 * (1 - t * 1.5));
        env(s, (t) => Math.exp(-t / 0.04) * Math.min(1, t / 0.008));
        mix(out, s, g, N(at));
      }
      return normalize(out, 0.9);
    }
    case 'growl': {
      const d = rng.range(1.2, 2);
      const n = N(d);
      const src = new Float32Array(n);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const f = 62 + 18 * Math.sin(t * 5) + (rng.next() - 0.5) * 25;
        ph += f / SR;
        src[i] = (ph % 1) * 2 - 1 + (rng.next() - 0.5) * 0.8;
      }
      const out = new Float32Array(n);
      mix(out, biquad(src, 'bp', 380, 3), 1);
      mix(out, biquad(src, 'bp', 950, 4), 0.6);
      mix(out, lp1(src.slice(), 200), 0.5);
      env(out, (t) => Math.sin(Math.PI * Math.min(1, t / d)) * (0.7 + 0.3 * Math.sin(t * 23)));
      return fadeEdges(normalize(out), 20);
    }
    case 'pant': {
      const out = new Float32Array(N(1.6));
      for (let k = 0; k < 6; k++) {
        const s = biquad(white(N(0.14), rng), 'bp', k % 2 ? 1300 : 1800, 2);
        env(s, (t) => Math.sin(Math.PI * (t / 0.14)));
        mix(out, s, k % 2 ? 0.7 : 1, N(k * 0.25));
      }
      return normalize(out, 0.8);
    }
    case 'pad': {
      const out = new Float32Array(N(0.15));
      const th = lp1(brown(N(0.1), rng), 300);
      env(th, (t) => Math.exp(-t / 0.02));
      mix(out, th, 1);
      const cl = biquad(white(N(0.02), rng), 'bp', 2500, 2);
      env(cl, (t) => Math.exp(-t / 0.003));
      mix(out, cl, 0.25);
      return normalize(out, 0.8);
    }
    case 'boom': {
      const out = new Float32Array(N(1.2));
      const s = sine(N(0.7), (t) => 42 * (1 - t * 0.5));
      env(s, (t) => Math.exp(-t / 0.15) * Math.min(1, t / 0.004));
      mix(out, s, 1.3);
      const b = lp1(brown(N(0.5), rng), 260);
      env(b, (t) => Math.exp(-t / 0.08));
      mix(out, b, 1.5);
      return normalize(out);
    }
    case 'roar': {
      const d = 2.4;
      const n = N(d);
      const src = new Float32Array(n);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const f = 85 + 30 * Math.sin(t * 2.2) - t * 10 + (rng.next() - 0.5) * 40;
        ph += f / SR;
        src[i] = Math.tanh(((ph % 1) * 2 - 1) * 3 + (rng.next() - 0.5) * 1.5);
      }
      const out = new Float32Array(n);
      mix(out, biquad(src, 'bp', (i) => 500 + 300 * Math.sin((i / n) * 3), 2), 1);
      mix(out, biquad(src, 'bp', 1600, 3), 0.5);
      mix(out, lp1(src.slice(), 150), 0.6);
      env(out, (t) => Math.min(1, t / 0.2) * Math.min(1, (d - t) / 0.8));
      return fadeEdges(normalize(out), 20);
    }
    case 'whoosh': {
      const d = 2.5;
      const out = biquad(pink(N(d), rng), 'bp', (i) => 200 + 2500 * Math.pow(i / N(d), 2), 0.7);
      env(out, (t) => Math.pow(t / d, 2));
      return fadeEdges(normalize(out, 0.7), 10);
    }
    case 'splash': {
      const out = new Float32Array(N(1.0));
      const sp = biquad(white(N(0.9), rng), 'bp', (i) => 2000 * Math.exp(-(i / SR) * 4) + 200, 1);
      env(sp, (t) => Math.min(1, t / 0.01) * Math.exp(-t / 0.2));
      mix(out, sp, 1);
      return normalize(out, 0.8);
    }
    case 'pop': {
      const out = new Float32Array(N(0.3));
      const s = hp1(white(N(0.02), rng), 800);
      env(s, (t) => Math.exp(-t / 0.002));
      mix(out, s, 1);
      return normalize(out, 0.9);
    }
    case 'gurgle': {
      const out = new Float32Array(N(1.6));
      for (let k = 0; k < 7; k++) {
        const f0 = rng.range(140, 380);
        const b = sine(N(0.25), (t) => f0 * (1 + t * 3));
        env(b, (t) => Math.sin(Math.PI * Math.min(1, t / 0.25)));
        mix(out, b, 0.5, N(rng.range(0, 1.2)));
      }
      lp1(out, 900);
      return normalize(out, 0.7);
    }
    case 'whisper': {
      const d = rng.range(0.8, 1.4);
      const n = N(d);
      const src = pink(n, rng);
      const out = new Float32Array(n);
      const seq = [VOWELS.ee, VOWELS.uh, VOWELS.o, VOWELS.e, VOWELS.a];
      for (let f = 0; f < 2; f++) {
        mix(out, biquad(src, 'bp', (i) => seq[Math.floor((i / n) * 5) % 5][f + 1] * 0.95, 5), 1);
      }
      env(out, (t) => Math.pow(Math.abs(Math.sin(t * 9 + Math.sin(t * 3))), 2) * Math.sin(Math.PI * (t / d)));
      return fadeEdges(normalize(out, 0.6), 20);
    }
    default:
      return new Float32Array(100);
  }
}

// ---------- reverb impulse responses ----------
export function impulse(seconds, { decay = 3, pre = 0.01, damp = 6000, dampEnd = 1500, metallic = 0, early = 6, seed = 1 } = {}) {
  const rng = new RNG(seed);
  const n = N(seconds);
  const chans = [new Float32Array(n), new Float32Array(n)];
  const pd = N(pre);
  for (let c = 0; c < 2; c++) {
    const a = chans[c];
    for (let i = pd; i < n; i++) {
      const t = (i - pd) / SR;
      a[i] = (rng.next() * 2 - 1) * Math.exp((-t * 6.9) / decay);
    }
    // time-varying damping (high frequencies die first)
    let y = 0;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const fc = damp + (dampEnd - damp) * Math.sqrt(x);
      const k = 1 - Math.exp((-2 * Math.PI * fc) / SR);
      y += (a[i] - y) * k;
      a[i] = y;
    }
    for (let e = 0; e < early; e++) {
      const at = pd + N(rng.range(0.003, 0.06));
      if (at < n) a[at] += rng.range(-0.8, 0.8) * (1 - e / early);
    }
    if (metallic > 0) {
      for (let m = 0; m < 6; m++) {
        const f = rng.range(250, 2200);
        const dd = rng.range(0.15, 0.6) * decay * 0.3;
        let ph = rng.next() * 6.28;
        for (let i = pd; i < n; i++) {
          ph += (2 * Math.PI * f) / SR;
          a[i] += Math.sin(ph) * Math.exp(-(i - pd) / SR / dd) * 0.08 * metallic;
        }
      }
    }
    normalize(a, 0.6);
  }
  return chans;
}

/** A seamless loop of filtered noise. */
export function noiseLoop(seconds, kind, seed, filt) {
  const rng = new RNG(seed);
  const n = N(seconds);
  let a = kind === 'brown' ? brown(n, rng) : kind === 'pink' ? pink(n, rng) : white(n, rng);
  if (filt) a = filt(a);
  // crossfade end into start for a seamless loop
  const xf = N(0.25);
  for (let i = 0; i < xf; i++) {
    const t = i / xf;
    a[i] = a[i] * t + a[n - xf + i] * (1 - t);
  }
  return normalize(a.subarray(0, n - xf), 0.8);
}
