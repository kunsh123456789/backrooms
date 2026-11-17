import * as THREE from 'three';
import { RNG, clamp } from './core/math.js';

// The dread director. Tracks time since the last event and slowly builds tension.
// Most of the time it does nothing at all. When it acts it escalates gradually:
// a distant sound, a light going out, a glimpse of something far away, and only
// very rarely, an actual encounter.

const TIER_RELEASE = { sound: 0.12, light: 0.25, hum: 0.2, glimpse: 0.45, encounter: 1 };

export class Director {
  constructor(game) {
    this.game = game;
    this.rng = new RNG((Math.random() * 1e9) | 0);
    this.reset(null);
    game.lights.onOut = (l) => this._onLightOut(l);
    game.lights.onFlicker = (l, on) => this._onFlicker(l, on);
    this._clunkT = 0;
    this._flickT = 0;
  }

  reset(level) {
    this.level = level;
    this.cfg = level?.config?.director || { off: true };
    this.t = 0;
    this.sinceEvent = 0;
    this.tension = 0;
    this.nextEval = this.rng.range(25, 45);
    this.flashFlicker = 0;
    this.fear = 0;
    this.history = [];
    this.lastGlimpse = -1e9;
    this.lastEncounter = -1e9;
  }

  /** The player discovered something wrong. Dread rises a little. */
  note(kind) {
    this.tension = clamp(this.tension + 0.08, 0, 1);
    this.history.push({ kind, t: this.t });
  }

  update(dt) {
    const g = this.game;
    this._clunkT -= dt;
    this._flickT -= dt;
    this.flashFlicker = Math.max(0, this.flashFlicker - dt);
    this.fear = Math.max(0, this.fear - dt * 0.15);
    if (this.cfg.off) return;
    this.t += dt;
    this.sinceEvent += dt;
    // tension creeps up; faster in darkness and when sanity is going
    const p = g.player;
    const dark = clamp(1 - g.localLight / 0.1, 0, 1);
    const ins = 1 - p.sanity / 100;
    this.tension = clamp(this.tension + (dt / (this.cfg.tensionTime ?? 420)) * (1 + dark * 0.8 + ins * 0.8), 0, 1);
    this.nextEval -= dt;
    if (this.nextEval > 0) return;
    this.nextEval = this.rng.range(7, 15);
    this._evaluate();
  }

  _evaluate() {
    const c = this.cfg;
    const quiet = c.minGap ?? 50;
    if (this.sinceEvent < quiet) return;
    if (this.game.entities.busy) return;
    const p = 0.06 + this.tension * 0.22 + Math.max(0, this.sinceEvent - quiet) / 900;
    if (this.rng.next() > p) return;
    const w = {
      sound: c.sounds?.length ? 1 : 0,
      light: c.lightEvents && this.tension > 0.2 ? 0.55 : 0,
      hum: c.humDrop && this.tension > 0.3 ? 0.3 : 0,
      glimpse: c.glimpse?.length && this.tension > 0.45 && this.t > (c.glimpseAfter ?? 600) && this.t - this.lastGlimpse > (c.glimpseGap ?? 240) ? 0.35 : 0,
      encounter: c.encounter?.length && this.tension > 0.75 && this.t > (c.encounterAfter ?? 900) && this.t - this.lastEncounter > (c.encounterGap ?? 600) ? 0.18 : 0,
    };
    let sum = 0;
    for (const k in w) sum += w[k];
    if (sum <= 0) return;
    let r = this.rng.next() * sum;
    let tier = 'sound';
    for (const k in w) {
      r -= w[k];
      if (r <= 0) {
        tier = k;
        break;
      }
    }
    if (this.fire(tier)) {
      this.sinceEvent = 0;
      this.tension = clamp(this.tension - TIER_RELEASE[tier], 0, 1);
    }
  }

  fire(tier) {
    const g = this.game, c = this.cfg, rng = this.rng;
    const a = g.audio;
    const p = g.player;
    this.history.push({ kind: tier, t: this.t });
    switch (tier) {
      case 'sound': {
        if (!c.sounds?.length) return false;
        const s = rng.pick(c.sounds);
        const opts = { minD: 22, maxD: 55, gain: rng.range(0.3, 0.6), rate: rng.range(0.85, 1.05) };
        if (s.startsWith('voice')) {
          opts.gain *= 0.35;
          opts.minD = 30;
        }
        a.distant(s, opts);
        if (s === 'footsteps') this._distantSteps();
        return true;
      }
      case 'light': {
        // a section of lights goes out somewhere you can see
        const fwd = g.camera.getWorldDirection(new THREE.Vector3());
        const ang = Math.atan2(fwd.z, fwd.x) + rng.range(-0.6, 0.6);
        const d = rng.range(14, 26);
        const x = p.pos.x + Math.cos(ang) * d, z = p.pos.z + Math.sin(ang) * d;
        const temp = rng.chance(0.55);
        const n = g.lights.blackout(x, z, rng.range(6, 11), { delayPerMetre: 0.09, duration: temp ? rng.range(25, 80) : -1 });
        return n > 0;
      }
      case 'hum':
        a.dropHum(rng.range(6, 15));
        this.fear = 0.3;
        return true;
      case 'glimpse': {
        if (!c.glimpse?.length) return false;
        const type = rng.pick(c.glimpse);
        const ok = g.entities.spawn(type, 'glimpse');
        if (ok) this.lastGlimpse = this.t;
        return ok;
      }
      case 'encounter': {
        if (!c.encounter?.length) return false;
        const type = rng.pick(c.encounter);
        const ok = g.entities.spawn(type, 'encounter');
        if (ok) this.lastEncounter = this.t;
        return ok;
      }
      default:
        return false;
    }
  }

  _distantSteps() {
    const g = this.game;
    const a = g.audio;
    const ang = this.rng.next() * Math.PI * 2;
    const d = this.rng.range(20, 35);
    const surf = g.player.surface === 'water' ? 'tile' : g.player.surface;
    for (let i = 0; i < 6; i++) {
      const pos = new THREE.Vector3(a.listenerPos.x + Math.cos(ang) * (d + i * 0.7), 0.1, a.listenerPos.z + Math.sin(ang) * (d + i * 0.7));
      a.playAt('step_' + surf, pos, { gain: 0.5, when: i * 0.6, reverb: 1.2, lowpass: 1500 });
    }
  }

  _onLightOut(l) {
    const g = this.game;
    if (this._clunkT > 0 || !g.audio.ready) return;
    const d = Math.hypot(l.x - g.player.pos.x, l.z - g.player.pos.z);
    if (d > 40) return;
    this._clunkT = 0.18;
    g.audio.playAt('lightclunk', new THREE.Vector3(l.x, l.y, l.z), { gain: 0.6, reverb: 0.9, ref: 3 });
  }

  _onFlicker(l, on) {
    const g = this.game;
    if (!g.audio.ready || g.state === 'menu') return;
    if (this._flickT > 0) return;
    const d = Math.hypot(l.x - g.player.pos.x, l.z - g.player.pos.z);
    if (d > 14) return;
    this._flickT = 0.05;
    if (!on || Math.random() < 0.5) g.audio.playAt('flick', new THREE.Vector3(l.x, l.y, l.z), { gain: 0.25 * (l.buzz ?? 1), reverb: 0.3, ref: 1.5, rate: 0.9 + Math.random() * 0.2 });
  }
}
