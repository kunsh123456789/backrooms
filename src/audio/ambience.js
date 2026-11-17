// Per-level ambient soundscapes. Each returns { update(dt, state), stop() }.
// No music anywhere except Level Fun, where it is deliberately wrong.

import * as THREE from 'three';
import { RNG } from '../core/math.js';

function noiseBed(a, name, type, freq, q, gain, dest) {
  const ctx = a.ctx;
  const s = a.loopSource(name);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = 0;
  s.connect(f).connect(g).connect(dest || a.amb);
  s.start();
  g.gain.setTargetAtTime(gain, a.now, 1.5);
  return { s, f, g, stop: () => { g.gain.setTargetAtTime(0, a.now, 0.3); setTimeout(() => { try { s.stop(); } catch (e) { /* */ } }, 1500); } };
}

function scheduler(rng, minGap, maxGap, fn) {
  let t = rng.range(minGap * 0.3, maxGap);
  return (dt) => {
    t -= dt;
    if (t <= 0) {
      t = rng.range(minGap, maxGap);
      fn();
    }
  };
}

const around = (a, rng, minD, maxD, y = 1) => {
  const ang = rng.next() * Math.PI * 2, d = rng.range(minD, maxD);
  return new THREE.Vector3(a.listenerPos.x + Math.cos(ang) * d, y, a.listenerPos.z + Math.sin(ang) * d);
};

export function createAmbience(id, a) {
  if (!a.ready) return { update() {}, stop() {} };
  const rng = new RNG(Date.now() & 0xffff);
  const parts = [];
  const tickers = [];
  switch (id) {
    case 'house': {
      parts.push(noiseBed(a, 'loop_pink', 'lowpass', 200, 0.5, 0.025));
      break;
    }
    case 'level0': {
      // the air itself: a barely-there pressure
      parts.push(noiseBed(a, 'loop_pink', 'lowpass', 260, 0.5, 0.02));
      break;
    }
    case 'level1': {
      parts.push(noiseBed(a, 'loop_pink', 'bandpass', 180, 0.6, 0.09));
      const wind = noiseBed(a, 'loop_brown', 'bandpass', 420, 1.2, 0.03);
      parts.push(wind);
      let ph = 0;
      tickers.push((dt) => {
        ph += dt;
        wind.f.frequency.setTargetAtTime(380 + Math.sin(ph * 0.11) * 160 + Math.sin(ph * 0.37) * 60, a.now, 0.5);
        wind.g.gain.setTargetAtTime(0.02 + 0.02 * (0.5 + 0.5 * Math.sin(ph * 0.07)), a.now, 1);
      });
      tickers.push(scheduler(rng, 2, 9, () => a.playAt('drip', around(a, rng, 6, 30, rng.range(0, 4)), { gain: rng.range(0.15, 0.4), rate: rng.range(0.8, 1.2), reverb: 1.2 })));
      break;
    }
    case 'level2': {
      // machinery thrum and steam
      const ctx = a.ctx;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 43;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 140;
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(lp).connect(g).connect(a.amb);
      o.start();
      g.gain.setTargetAtTime(0.07, a.now, 2);
      parts.push({ stop: () => { g.gain.setTargetAtTime(0, a.now, 0.3); setTimeout(() => o.stop(), 1500); } });
      parts.push(noiseBed(a, 'loop_brown', 'lowpass', 300, 0.7, 0.08));
      let ph = 0;
      tickers.push((dt) => {
        ph += dt;
        o.frequency.setTargetAtTime(43 + Math.sin(ph * 0.3) * 1.5, a.now, 0.5);
      });
      tickers.push(scheduler(rng, 5, 16, () => a.playAt('clank', around(a, rng, 10, 45, rng.range(0.5, 2.5)), { gain: rng.range(0.15, 0.45), rate: rng.range(0.6, 1.1), reverb: 1.4 })));
      tickers.push(scheduler(rng, 3, 10, () => a.playAt('drip', around(a, rng, 4, 20, 2), { gain: 0.25, reverb: 1 })));
      break;
    }
    case 'level4': {
      parts.push(noiseBed(a, 'loop_pink', 'lowpass', 700, 0.5, 0.035)); // HVAC
      parts.push(noiseBed(a, 'loop_brown', 'lowpass', 90, 0.5, 0.05));
      break;
    }
    case 'level37': {
      // water lapping, a wide gentle wash
      const lap = noiseBed(a, 'loop_brown', 'bandpass', 500, 0.8, 0.05);
      parts.push(lap);
      const far = noiseBed(a, 'loop_pink', 'bandpass', 1400, 0.5, 0.012);
      parts.push(far);
      let ph = 0;
      tickers.push((dt) => {
        ph += dt;
        const s = 0.5 + 0.5 * Math.sin(ph * 0.9 + Math.sin(ph * 0.31) * 2);
        lap.g.gain.setTargetAtTime(0.02 + 0.05 * s, a.now, 0.3);
        lap.f.frequency.setTargetAtTime(380 + 260 * s, a.now, 0.3);
      });
      tickers.push(scheduler(rng, 1.5, 6, () => a.playAt('drip', around(a, rng, 5, 35, rng.range(0, 3)), { gain: rng.range(0.1, 0.35), rate: rng.range(0.7, 1.1), reverb: 1.6 })));
      break;
    }
    case 'levelRun': {
      const ctx = a.ctx;
      const o = ctx.createOscillator();
      o.type = 'square';
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100;
      bp.Q.value = 1.5;
      const sh = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 255) * 2 - 1) * 4);
      sh.curve = curve;
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(bp).connect(sh).connect(g).connect(a.amb);
      const rs = ctx.createGain();
      rs.gain.value = 0.8;
      g.connect(rs).connect(a.revIn);
      o.start();
      let t = 0, on = false, started = false;
      tickers.push((dt, st) => {
        t += dt;
        if (!started && st.alarm) {
          started = true;
          g.gain.setTargetAtTime(0.05, a.now, 0.05);
        }
        if (!started) return;
        const ph = (t % 1.2) / 1.2;
        const hi = ph < 0.5;
        if (hi !== on) {
          on = hi;
          o.frequency.setValueAtTime(hi ? 880 : 660, a.now);
        }
      });
      parts.push({ stop: () => { g.gain.setTargetAtTime(0, a.now, 0.05); setTimeout(() => o.stop(), 500); } });
      parts.push(noiseBed(a, 'loop_brown', 'lowpass', 90, 0.5, 0.12));
      break;
    }
    case 'levelFun': {
      parts.push(createPartyMusic(a));
      tickers.push(scheduler(rng, 14, 40, () => a.playAt('voice_giggle', around(a, rng, 12, 30, 1.5), { gain: 0.18, rate: rng.range(0.95, 1.2), reverb: 1.2 })));
      tickers.push(scheduler(rng, 20, 60, () => a.playAt('pop', around(a, rng, 8, 25, 2), { gain: 0.3, reverb: 1 })));
      break;
    }
    default:
      break;
  }
  const musicPart = parts.find((p) => p.update);
  return {
    update(dt, st = {}) {
      for (const t of tickers) t(dt, st);
      if (musicPart) musicPart.update(dt, st);
    },
    stop() {
      for (const p of parts) p.stop();
    },
  };
}

// Original cheerful party tune, played back on a warped tape through a cheap speaker.
function createPartyMusic(a) {
  const ctx = a.ctx;
  const out = ctx.createGain();
  out.gain.value = 0;
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = (i / 1023) * 2 - 1;
    curve[i] = Math.round(Math.tanh(x * 2.2) * 12) / 12; // saturate + bitcrush
  }
  shaper.curve = curve;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 180;
  const peak = ctx.createBiquadFilter();
  peak.type = 'peaking';
  peak.frequency.value = 2600;
  peak.gain.value = 7;
  out.connect(shaper).connect(hp).connect(peak).connect(a.music);
  const rs = ctx.createGain();
  rs.gain.value = 0.5;
  peak.connect(rs).connect(a.revIn);
  out.gain.setTargetAtTime(0.11, a.now, 1);
  // tape wow
  const wow = ctx.createOscillator();
  wow.frequency.value = 0.55;
  const wowG = ctx.createGain();
  wowG.gain.value = 22;
  wow.connect(wowG);
  wow.start();

  const lead = [72, 76, 79, 76, 77, 81, 79, 76, 74, 77, 76, 72, 74, 71, 72, -1, 76, 79, 84, 79, 81, 77, 79, 76, 77, 74, 76, 72, 74, 67, 72, -1];
  const bass = [48, 55, 48, 55, 53, 57, 53, 57, 48, 55, 48, 55, 43, 50, 48, -1];
  const bpm = 116;
  const beat = 60 / bpm;
  let next = a.now + 0.5;
  let step = 0;
  const rng = new RNG(5);
  const note = (midi, t, dur, type, gain) => {
    if (midi < 0) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    wowG.connect(o.detune);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(gain * 0.4, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  };
  let stutter = 0;
  return {
    update() {
      // schedule ahead
      while (next < a.now + 0.25) {
        const i = step % lead.length;
        let t = next;
        // occasional tape drag: the song slows and slurs
        if (rng.next() < 0.004) stutter = 6;
        const slow = stutter > 0 ? 1.35 : 1;
        if (stutter > 0) stutter--;
        note(lead[i], t, beat * 0.9 * slow, 'square', 0.25);
        if (i % 2 === 0) note(bass[(i / 2) % bass.length], t, beat * 1.8 * slow, 'triangle', 0.5);
        if (i % 4 === 2) note(lead[i] + 4, t + beat * 0.5, beat * 0.3, 'square', 0.1);
        next += beat * slow * (1 + (rng.next() - 0.5) * 0.03);
        step++;
      }
    },
    stop() {
      out.gain.setTargetAtTime(0, a.now, 0.2);
      setTimeout(() => wow.stop(), 1000);
    },
  };
}

// --- emitter graph builders ---
export const EMIT = {
  fridge(ctx, out, a) {
    const o1 = ctx.createOscillator();
    o1.frequency.value = 50;
    const o2 = ctx.createOscillator();
    o2.frequency.value = 100;
    o2.type = 'triangle';
    const g1 = ctx.createGain();
    g1.gain.value = 0.25;
    const g2 = ctx.createGain();
    g2.gain.value = 0.12;
    const nz = a.loopSource('loop_pink');
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    const g3 = ctx.createGain();
    g3.gain.value = 0.05;
    o1.connect(g1).connect(out);
    o2.connect(g2).connect(out);
    nz.connect(bp).connect(g3).connect(out);
    o1.start();
    o2.start();
    nz.start();
    return () => { o1.stop(); o2.stop(); nz.stop(); };
  },
  cooler(ctx, out, a) {
    const o = ctx.createOscillator();
    o.frequency.value = 120;
    const g = ctx.createGain();
    g.gain.value = 0.12;
    const o2 = ctx.createOscillator();
    o2.frequency.value = 240;
    const g2 = ctx.createGain();
    g2.gain.value = 0.04;
    o.connect(g).connect(out);
    o2.connect(g2).connect(out);
    o.start();
    o2.start();
    const iv = setInterval(() => {
      if (Math.random() < 0.08) {
        const s = ctx.createBufferSource();
        s.buffer = a.buffer('gurgle');
        const gg = ctx.createGain();
        gg.gain.value = 2.5;
        s.connect(gg).connect(out);
        s.start();
      }
    }, 3000);
    return () => { o.stop(); o2.stop(); clearInterval(iv); };
  },
  dialtone(ctx, out) {
    const o1 = ctx.createOscillator();
    o1.frequency.value = 350;
    const o2 = ctx.createOscillator();
    o2.frequency.value = 440;
    const g = ctx.createGain();
    g.gain.value = 0.03;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.6;
    o1.connect(g);
    o2.connect(g);
    g.connect(bp).connect(out);
    o1.start();
    o2.start();
    return () => { o1.stop(); o2.stop(); };
  },
  steam(ctx, out, a) {
    const s = a.loopSource('loop_white');
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.value = 0.2;
    s.connect(hp).connect(g).connect(out);
    s.start();
    const iv = setInterval(() => {
      g.gain.setTargetAtTime(Math.random() < 0.5 ? 0.05 : 0.3, ctx.currentTime, 0.3);
    }, 1800);
    return () => { s.stop(); clearInterval(iv); };
  },
  vent(ctx, out, a) {
    const s = a.loopSource('loop_pink');
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 600;
    bp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0.15;
    s.connect(bp).connect(g).connect(out);
    s.start();
    return () => s.stop();
  },
  monitor(ctx, out) {
    const o = ctx.createOscillator();
    o.frequency.value = 15600;
    const g = ctx.createGain();
    g.gain.value = 0.004;
    o.connect(g).connect(out);
    o.start();
    return () => o.stop();
  },
  drone(ctx, out) {
    // something electrical behind a door
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 55;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    const g = ctx.createGain();
    g.gain.value = 0.08;
    o.connect(lp).connect(g).connect(out);
    o.start();
    return () => o.stop();
  },
  hum(ctx, out, a) {
    // a faint fluorescent hum coming from inside a wall
    const g = ctx.createGain();
    g.gain.value = 0.5;
    a.humSrc.connect(g);
    g.connect(out);
    return () => { try { a.humSrc.disconnect(g); } catch (e) { /* */ } };
  },
};
