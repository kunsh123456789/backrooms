import * as THREE from 'three';
import { RNG, clamp } from '../core/math.js';
import * as S from './synth.js';

// The audio engine. Half of the game lives here.
//  - three convolution reverbs (small / medium / vast) cross-faded by measured room size
//  - a fluorescent hum source shared by a pool of spatial "light voices", synced to flicker
//  - a global hum bed whose pitch and level drift as you move, and which can drop out
//  - breathing, footsteps, low rumble rising with time alone
//  - spatial one-shots for distant, unidentifiable events

const tmpV = new THREE.Vector3();
const HUM_VOICES = 6;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.buffers = new Map();
    this.rng = new RNG(99);
    this.emitters = [];
    this.humLevel = 0;
    this.humTarget = 0;
    this.humDrop = 0; // seconds remaining of dropout
    this.roomSize = 6;
    this.listenerPos = new THREE.Vector3();
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);

    // muffle filter on everything (used by pause, noclip, deep water)
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.connect(this.master);
    this.duck = ctx.createGain(); // whole-world fader
    this.duck.connect(this.muffle);

    this.world = ctx.createGain(); // spatial sounds
    this.world.connect(this.duck);
    this.self = ctx.createGain(); // player's body
    this.self.connect(this.duck);
    this.amb = ctx.createGain(); // ambient beds
    this.amb.connect(this.duck);
    this.music = ctx.createGain();
    this.music.connect(this.duck);
    this.ui = ctx.createGain();
    this.ui.connect(this.master);

    // reverbs
    this.revIn = ctx.createGain();
    this.revs = [];
    for (let i = 0; i < 3; i++) {
      const g = ctx.createGain();
      const c = ctx.createConvolver();
      const out = ctx.createGain();
      this.revIn.connect(g);
      g.connect(c).connect(out).connect(this.duck);
      this.revs.push({ send: g, conv: c, out });
    }
    this.setReverbProfile({});

    this._buildBuffers();
    this._buildHum();
    this._buildRumble();
    this._buildSanity();
    this.ready = true;
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  setVolume(v) {
    if (this.master) this.master.gain.setTargetAtTime(v, this.now, 0.05);
  }

  // ---------- buffers ----------
  _buf(data) {
    const b = this.ctx.createBuffer(1, data.length, S.SR);
    b.copyToChannel(data, 0);
    return b;
  }
  _add(name, arr) {
    this.buffers.set(name, arr.map((d) => this._buf(d)));
  }
  _buildBuffers() {
    const surfaces = ['carpet', 'wetcarpet', 'housecarpet', 'wood', 'concrete', 'tile', 'water', 'metal'];
    for (const s of surfaces) {
      const arr = [];
      for (let i = 0; i < 6; i++) arr.push(S.footstep(s, 100 + i * 17 + s.length));
      this._add('step_' + s, arr);
    }
    for (const heavy of [false, true]) {
      for (const k of ['in', 'out']) {
        const arr = [];
        for (let i = 0; i < 4; i++) arr.push(S.breath(k, heavy, 300 + i * 13 + (heavy ? 7 : 0) + k.length));
        this._add(`breath_${k}${heavy ? '_h' : ''}`, arr);
      }
    }
    const sounds = {
      doorslam: 3, thump: 3, knock: 3, drag: 3, clank: 5, creak: 4, drip: 6, lightclunk: 3, flick: 6, clocktick: 3,
      paper: 2, bottle: 2, click: 2, static: 1, heartbeat: 1, growl: 3, pant: 2, pad: 4, boom: 3, roar: 2, whoosh: 1,
      splash: 2, pop: 2, gurgle: 2, whisper: 4,
    };
    for (const [n, c] of Object.entries(sounds)) {
      const arr = [];
      for (let i = 0; i < c; i++) arr.push(S.makeSound(n, 500 + i * 31 + n.length * 7));
      this._add(n, arr);
    }
    for (const [n, segs] of Object.entries(S.VOICE_LINES)) {
      const arr = [];
      for (let i = 0; i < 2; i++) arr.push(S.voice(segs, { seed: 700 + i, breathy: 0.2 + i * 0.1 }));
      this._add('voice_' + n, arr);
    }
    // ambience loops
    this._add('loop_brown', [S.noiseLoop(6, 'brown', 1)]);
    this._add('loop_pink', [S.noiseLoop(6, 'pink', 2)]);
    this._add('loop_white', [S.noiseLoop(4, 'white', 3)]);
  }

  buffer(name) {
    const arr = this.buffers.get(name);
    if (!arr) return null;
    return arr[Math.floor(this.rng.next() * arr.length)];
  }

  // ---------- reverb ----------
  setReverbProfile({ small = 0.5, medium = 1.6, large = 4.5, damp = 6000, dampEnd = 1200, metallic = 0, wet = 1 } = {}) {
    if (!this.ctx) return;
    const sizes = [small, medium, large];
    this.revWet = wet;
    for (let i = 0; i < 3; i++) {
      const [l, r] = S.impulse(sizes[i] * 1.3 + 0.2, { decay: sizes[i], pre: 0.004 + i * 0.012, damp, dampEnd, metallic, seed: 40 + i });
      const b = this.ctx.createBuffer(2, l.length, S.SR);
      b.copyToChannel(l, 0);
      b.copyToChannel(r, 1);
      this.revs[i].conv.buffer = b;
    }
  }

  /** Cross-fade reverb by the mean free distance around the listener. */
  setRoomSize(m) {
    this.roomSize = m;
    if (!this.ctx) return;
    const s = clamp(1 - (m - 3) / 4, 0, 1);
    const l = clamp((m - 9) / 10, 0, 1);
    const md = clamp(1 - s - l, 0, 1);
    const w = this.revWet ?? 1;
    const t = this.now;
    this.revs[0].send.gain.setTargetAtTime(s * 0.5 * w, t, 0.4);
    this.revs[1].send.gain.setTargetAtTime(md * 0.55 * w, t, 0.4);
    this.revs[2].send.gain.setTargetAtTime(l * 0.7 * w, t, 0.4);
  }

  // ---------- one-shots ----------
  /** Non-spatial playback. */
  play(name, { gain = 1, rate = 1, bus = 'self', reverb = 0.2, detune = 0, when = 0, lowpass = 0 } = {}) {
    if (!this.ready) return null;
    const buf = typeof name === 'string' ? this.buffer(name) : name;
    if (!buf) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = gain;
    let node = src;
    if (lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(this[bus] || this.self);
    if (reverb > 0) {
      const rs = ctx.createGain();
      rs.gain.value = reverb * gain;
      node.connect(rs).connect(this.revIn);
    }
    src.start(this.now + when);
    return src;
  }

  /** Spatial playback at a world position. */
  playAt(name, pos, { gain = 1, rate = 1, reverb = 0.5, ref = 2, lowpass = 0, detune = 0, when = 0, rolloff = 1 } = {}) {
    if (!this.ready) return null;
    const buf = typeof name === 'string' ? this.buffer(name) : name;
    if (!buf) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.detune.value = detune;
    const p = this._panner(pos, ref, rolloff);
    const g = ctx.createGain();
    g.gain.value = gain;
    let node = src;
    // distance-based air absorption
    const dist = pos.distanceTo(this.listenerPos);
    const lpf = lowpass || clamp(16000 / (1 + dist * 0.12), 350, 18000);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lpf;
    node.connect(f);
    node = f;
    node.connect(g).connect(p).connect(this.world);
    if (reverb > 0) {
      const rs = ctx.createGain();
      // farther sounds are mostly reverb
      rs.gain.value = reverb * gain * clamp(0.3 + dist / 25, 0.3, 1.4);
      node.connect(rs).connect(this.revIn);
    }
    src.start(this.now + when);
    return { src, panner: p, gain: g };
  }

  _panner(pos, ref = 2, rolloff = 1) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = 200;
    this._setPannerPos(p, pos);
    return p;
  }
  _setPannerPos(p, pos) {
    if (p.positionX) {
      const t = this.now;
      p.positionX.setValueAtTime(pos.x, t);
      p.positionY.setValueAtTime(pos.y, t);
      p.positionZ.setValueAtTime(pos.z, t);
    } else p.setPosition(pos.x, pos.y, pos.z);
  }

  /** A sound from somewhere far away, in a random direction. */
  distant(name, { minD = 25, maxD = 60, gain = 0.6, rate = 1, y = 1.2, dir = null } = {}) {
    const a = dir ?? this.rng.next() * Math.PI * 2;
    const d = this.rng.range(minD, maxD);
    const pos = new THREE.Vector3(this.listenerPos.x + Math.cos(a) * d, y, this.listenerPos.z + Math.sin(a) * d);
    return this.playAt(name, pos, { gain, rate, reverb: 1.2, ref: 6, lowpass: clamp(4000 - d * 40, 500, 3000) });
  }

  // ---------- listener ----------
  updateListener(camera) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    camera.getWorldPosition(this.listenerPos);
    const fwd = camera.getWorldDirection(tmpV);
    const t = this.now;
    if (l.positionX) {
      l.positionX.setTargetAtTime(this.listenerPos.x, t, 0.02);
      l.positionY.setTargetAtTime(this.listenerPos.y, t, 0.02);
      l.positionZ.setTargetAtTime(this.listenerPos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(this.listenerPos.x, this.listenerPos.y, this.listenerPos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  // ---------- fluorescent hum ----------
  _buildHum() {
    const ctx = this.ctx;
    this.humSrc = ctx.createGain();
    this.humOsc = [];
    const parts = [
      [60, 0.18, 'sine'], [120, 0.5, 'sine'], [180, 0.12, 'sine'], [240, 0.16, 'sine'], [360, 0.05, 'sine'],
    ];
    for (const [f, g, type] of parts) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const gg = ctx.createGain();
      gg.gain.value = g;
      o.connect(gg).connect(this.humSrc);
      o.start();
      this.humOsc.push(o);
    }
    // the ballast buzz: a 120 Hz sawtooth band-passed high
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = 120;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.9;
    const sg = ctx.createGain();
    sg.gain.value = 0.06;
    saw.connect(bp).connect(sg).connect(this.humSrc);
    saw.start();
    this.humOsc.push(saw);
    // sizzle: noise amplitude-modulated at 120 Hz
    const nz = ctx.createBufferSource();
    nz.buffer = this.buffer('loop_white');
    nz.loop = true;
    const nbp = ctx.createBiquadFilter();
    nbp.type = 'bandpass';
    nbp.frequency.value = 5200;
    nbp.Q.value = 0.7;
    const am = ctx.createGain();
    am.gain.value = 0;
    const mod = ctx.createOscillator();
    mod.frequency.value = 120;
    const modG = ctx.createGain();
    modG.gain.value = 0.025;
    mod.connect(modG).connect(am.gain);
    nz.connect(nbp).connect(am).connect(this.humSrc);
    nz.start();
    mod.start();
    this.humOsc.push(mod);

    // global bed
    this.humBed = ctx.createGain();
    this.humBed.gain.value = 0;
    const bedLp = ctx.createBiquadFilter();
    bedLp.type = 'lowpass';
    bedLp.frequency.value = 1800;
    this.humBedLp = bedLp;
    this.humSrc.connect(bedLp).connect(this.humBed).connect(this.amb);
    const bedRev = ctx.createGain();
    bedRev.gain.value = 0.25;
    this.humBed.connect(bedRev).connect(this.revIn);

    // spatial voices (nearest lights)
    this.humVoices = [];
    for (let i = 0; i < HUM_VOICES; i++) {
      const g = ctx.createGain();
      g.gain.value = 0;
      const f = ctx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = 2400 + i * 300;
      f.gain.value = 3;
      const p = this._panner(new THREE.Vector3(0, -100, 0), 1.2, 1.4);
      this.humSrc.connect(f).connect(g).connect(p).connect(this.world);
      this.humVoices.push({ g, p, light: null });
    }
    this.humEnabled = 0;
    this.humPitch = 0;
  }

  /** Level-wide hum amount (0 = no fluorescents), voice gain. */
  setHumProfile({ bed = 0.0, voices = 0.0, pitch = 0, bright = 1800 } = {}) {
    this.humBedAmt = bed;
    this.humVoiceAmt = voices;
    this.humBasePitch = pitch;
    if (this.humBedLp) this.humBedLp.frequency.setTargetAtTime(bright, this.now, 0.2);
  }

  /** Cut the hum entirely for a while. The silence is the point. */
  dropHum(seconds) {
    this.humDrop = seconds;
  }

  /**
   * Called each frame with the nearest lights and a local brightness estimate.
   * lights: [{x,y,z,cur}] sorted by distance.
   */
  updateHum(dt, nearLights, localAmt, wobble) {
    if (!this.ready) return;
    const t = this.now;
    const dropping = this.humDrop > 0;
    if (dropping) this.humDrop -= dt;
    const wasDropping = this._wasDropping;
    this._wasDropping = dropping;
    if (wasDropping && !dropping) this.play('flick', { gain: 0.3, bus: 'amb' });
    const bed = dropping ? 0 : (this.humBedAmt ?? 0) * localAmt;
    this.humBed.gain.setTargetAtTime(bed, t, dropping ? 0.015 : 0.25);
    // pitch wanders a few cents with position and time
    const cents = (this.humBasePitch || 0) + wobble * 9;
    for (const o of this.humOsc) o.detune.setTargetAtTime(cents, t, 0.5);
    for (let i = 0; i < HUM_VOICES; i++) {
      const v = this.humVoices[i];
      const l = nearLights[i];
      if (!l || dropping) {
        v.g.gain.setTargetAtTime(0, t, 0.02);
        v.light = null;
        continue;
      }
      if (v.light !== l) {
        v.light = l;
        v.g.gain.cancelScheduledValues(t);
        v.g.gain.setValueAtTime(0, t);
        tmpV.set(l.x, l.y, l.z);
        this._setPannerPos(v.p, tmpV);
      }
      const amt = (this.humVoiceAmt ?? 0) * clamp(l.cur, 0, 1.5) * (l.buzz ?? 1);
      v.g.gain.setTargetAtTime(amt, t, 0.012);
    }
  }

  // ---------- rumble ----------
  _buildRumble() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer('loop_brown');
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 70;
    lp.Q.value = 0.8;
    this.rumble = ctx.createGain();
    this.rumble.gain.value = 0;
    src.connect(lp).connect(this.rumble).connect(this.amb);
    src.start();
    const sub = ctx.createOscillator();
    sub.frequency.value = 31;
    const sg = ctx.createGain();
    sg.gain.value = 0.25;
    sub.connect(sg).connect(this.rumble);
    sub.start();
  }
  setRumble(v) {
    if (this.rumble) this.rumble.gain.setTargetAtTime(v, this.now, 1.5);
  }

  // ---------- sanity: the hum forming almost-words, tinnitus ----------
  _buildSanity() {
    const ctx = this.ctx;
    this.formant = ctx.createGain();
    this.formant.gain.value = 0;
    this.formantF = [];
    const vowelGain = [1, 0.6, 0.3];
    for (let i = 0; i < 3; i++) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 9;
      f.frequency.value = [600, 1200, 2500][i];
      const g = ctx.createGain();
      g.gain.value = vowelGain[i] * 14;
      this.humSrc.connect(f).connect(g).connect(this.formant);
      this.formantF.push(f);
    }
    this.formantAM = ctx.createGain();
    this.formantAM.gain.value = 0;
    this.formant.connect(this.formantAM).connect(this.amb);
    const fr = ctx.createGain();
    fr.gain.value = 0.6;
    this.formantAM.connect(fr).connect(this.revIn);
    this.formantPhase = 0;
    // tinnitus
    const o = ctx.createOscillator();
    o.frequency.value = 7900;
    this.tinnitus = ctx.createGain();
    this.tinnitus.gain.value = 0;
    o.connect(this.tinnitus).connect(this.self);
    o.start();
  }

  /** insanity 0..1 */
  updateSanity(dt, insanity, humPresent) {
    if (!this.ready) return;
    const t = this.now;
    const k = Math.max(0, insanity - 0.45) / 0.55;
    this.formantPhase += dt * (2.6 + Math.sin(t * 0.37) * 1.4);
    const syll = Math.pow(Math.max(0, Math.sin(this.formantPhase * Math.PI)), 2) * (0.5 + 0.5 * Math.sin(t * 0.21));
    const vowels = [[700, 1200, 2600], [350, 2100, 2900], [500, 850, 2400], [600, 1700, 2500], [300, 900, 2300]];
    const vi = Math.floor(this.formantPhase) % vowels.length;
    for (let i = 0; i < 3; i++) this.formantF[i].frequency.setTargetAtTime(vowels[vi][i], t, 0.06);
    this.formant.gain.setTargetAtTime(humPresent && this.humDrop <= 0 ? k * 0.06 : 0, t, 0.5);
    this.formantAM.gain.setTargetAtTime(syll, t, 0.03);
    this.tinnitus.gain.setTargetAtTime(k > 0.6 ? (k - 0.6) * 0.004 : 0, t, 1.0);
  }

  // ---------- looping emitters (water coolers, phones, steam, fridge...) ----------
  /**
   * Register a looping spatial emitter. build(ctx, out) must create the source graph
   * connected to `out` and return a stop() function. Nodes are only alive while near.
   */
  addEmitter(pos, build, { range = 18, gain = 1, reverb = 0.3 } = {}) {
    const e = { pos: pos.clone(), build, range, gain, reverb, live: null };
    this.emitters.push(e);
    return e;
  }
  removeEmitter(e) {
    if (e.live) this._killEmitter(e);
    const i = this.emitters.indexOf(e);
    if (i >= 0) this.emitters.splice(i, 1);
  }
  clearEmitters() {
    for (const e of this.emitters) if (e.live) this._killEmitter(e);
    this.emitters.length = 0;
  }
  _killEmitter(e) {
    const live = e.live;
    e.live = null;
    live.g.gain.setTargetAtTime(0, this.now, 0.1);
    setTimeout(() => {
      try {
        live.stop();
        live.g.disconnect();
      } catch (err) {
        /* ignore */
      }
    }, 600);
  }
  updateEmitters() {
    if (!this.ready) return;
    for (const e of this.emitters) {
      const d = e.pos.distanceTo(this.listenerPos);
      if (!e.live && d < e.range) {
        const g = this.ctx.createGain();
        g.gain.value = 0;
        const p = this._panner(e.pos, 1.5, 1.2);
        g.connect(p).connect(this.world);
        const rs = this.ctx.createGain();
        rs.gain.value = e.reverb;
        g.connect(rs).connect(this.revIn);
        const stop = e.build(this.ctx, g, this);
        e.live = { g, p, stop };
        g.gain.setTargetAtTime(e.gain, this.now, 0.5);
      } else if (e.live && d > e.range + 4) {
        this._killEmitter(e);
      }
    }
  }

  // ---------- helpers for emitter graphs ----------
  loopSource(name) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.buffer(name);
    s.loop = true;
    return s;
  }

  /** Fade everything in the world (not UI) to a level. */
  fadeWorld(v, time = 0.5) {
    if (!this.ready) return;
    this.duck.gain.cancelScheduledValues(this.now);
    this.duck.gain.setTargetAtTime(v, this.now, time / 3);
  }
  setMuffle(freq, time = 0.3) {
    if (!this.ready) return;
    this.muffle.frequency.setTargetAtTime(freq, this.now, time / 3);
  }
}
