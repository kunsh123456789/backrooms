import * as THREE from 'three';
import { RNG } from '../core/math.js';

// The light system: every fluorescent panel in the world is a "slot" in a float
// data texture. Chunk geometry stores, per vertex, the 8 strongest light slots and
// their baked (occlusion-aware) weights. The vertex shader looks the current
// intensities up every frame, so any number of lights can flicker, fail, or be
// switched off by the dread director at the cost of a single texture upload.

export const LIGHT_TEX_W = 128;
export const LIGHT_TEX_H = 64;
const MAX_SLOTS = LIGHT_TEX_W * LIGHT_TEX_H;
const HASH = 8; // metres per spatial-hash cell for light queries

export const FLICKER = { NONE: 0, OCCASIONAL: 1, BAD: 2, PULSE: 3, DYING: 4 };

/** Attenuation used by the baker and by CPU light sampling. */
export function lightFalloff(d, r) {
  const x = d / r;
  if (x >= 1) return 0;
  const w = 1 - x * x * x * x;
  return (w * w) / (1 + 0.32 * d * d);
}

export class LightSystem {
  constructor() {
    this.data = new Float32Array(MAX_SLOTS * 4);
    this.tex = new THREE.DataTexture(this.data, LIGHT_TEX_W, LIGHT_TEX_H, THREE.RGBAFormat, THREE.FloatType);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    this.slots = new Array(MAX_SLOTS).fill(null);
    this.free = [];
    for (let i = MAX_SLOTS - 1; i >= 1; i--) this.free.push(i); // slot 0 = always black
    this.active = new Set();
    this.hash = new Map();
    this.rng = new RNG(1234);
    this.time = 0;
    this.master = 1; // global multiplier (used by fades and the noclip)
    this.onFlicker = null; // (light, on) => void
    this.onOut = null; // (light) => void
  }

  _key(x, z) {
    return Math.floor(x / HASH) * 73856093 + Math.floor(z / HASH) * 19349663;
  }

  /** Register a light; returns its slot. */
  add(l) {
    const slot = this.free.pop();
    if (slot === undefined) {
      l.slot = 0;
      return 0;
    }
    l.slot = slot;
    l.cur = l.dead ? 0 : l.base;
    l.ft = this.rng.range(2, 40); // flicker timer
    l.fon = true;
    l.burst = 0;
    l.forced = 1; // multiplier from blackouts
    l.offAt = -1;
    l.restoreAt = -1;
    l.phase = this.rng.next() * 10;
    this.slots[slot] = l;
    this.active.add(l);
    const k = this._key(l.x, l.z);
    let arr = this.hash.get(k);
    if (!arr) this.hash.set(k, (arr = []));
    arr.push(l);
    this._write(l);
    return slot;
  }

  remove(l) {
    if (!l.slot) return;
    const i = l.slot * 4;
    this.data[i] = this.data[i + 1] = this.data[i + 2] = 0;
    this.slots[l.slot] = null;
    this.free.push(l.slot);
    this.active.delete(l);
    const arr = this.hash.get(this._key(l.x, l.z));
    if (arr) {
      const j = arr.indexOf(l);
      if (j >= 0) arr.splice(j, 1);
    }
    l.slot = 0;
  }

  clear() {
    for (const l of [...this.active]) this.remove(l);
    this.tex.needsUpdate = true;
  }

  _write(l) {
    const i = l.slot * 4;
    const v = l.cur * this.master;
    this.data[i] = l.color[0] * v;
    this.data[i + 1] = l.color[1] * v;
    this.data[i + 2] = l.color[2] * v;
  }

  /** Lights within radius of a point. */
  query(x, z, radius, out = []) {
    out.length = 0;
    const r2 = radius * radius;
    const x0 = Math.floor((x - radius) / HASH), x1 = Math.floor((x + radius) / HASH);
    const z0 = Math.floor((z - radius) / HASH), z1 = Math.floor((z + radius) / HASH);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const arr = this.hash.get(gx * 73856093 + gz * 19349663);
        if (!arr) continue;
        for (const l of arr) {
          const dx = l.x - x, dz = l.z - z;
          if (dx * dx + dz * dz <= r2) out.push(l);
        }
      }
    }
    return out;
  }

  /** CPU estimate of light arriving at a point (no occlusion unless occluder given). */
  sample(x, y, z, out = new THREE.Vector3(), occluder = null) {
    out.set(0, 0, 0);
    const near = this.query(x, z, 9, this._tmp || (this._tmp = []));
    for (const l of near) {
      if (l.cur <= 0.001) continue;
      const dx = l.x - x, dy = l.y - y, dz = l.z - z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let w = lightFalloff(d, l.r) * l.cur * this.master;
      if (w <= 0) continue;
      if (occluder && occluder(x, z, l.x, l.z)) w *= 0.08;
      out.x += l.color[0] * w;
      out.y += l.color[1] * w;
      out.z += l.color[2] * w;
    }
    return out;
  }

  /** Turn off lights in a radius, sweeping outward from a point like a breaker tripping. */
  blackout(x, z, radius, { delayPerMetre = 0.12, duration = -1, startDelay = 0 } = {}) {
    const lights = this.query(x, z, radius, []);
    for (const l of lights) {
      if (l.dead || l.noBlackout) continue;
      const d = Math.hypot(l.x - x, l.z - z);
      l.offAt = this.time + startDelay + d * delayPerMetre + this.rng.range(0, 0.15);
      l.restoreAt = duration > 0 ? l.offAt + duration + this.rng.range(0, 1.5) : -1;
    }
    return lights.length;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    const rng = this.rng;
    for (const l of this.active) {
      if (l.offAt >= 0 && t >= l.offAt) {
        l.offAt = -1;
        if (l.forced > 0 && this.onOut) this.onOut(l);
        l.forced = 0;
      }
      if (l.restoreAt >= 0 && t >= l.restoreAt && l.offAt < 0) {
        l.restoreAt = -1;
        l.forced = 1;
        l.burst = 6; // stutters back on
        l.ft = 0;
      }
      let target = l.dead ? 0 : l.base * l.forced;
      if (target > 0) {
        const f = l.flicker;
        if (f === FLICKER.PULSE) {
          target *= 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(t * 2.4 + l.phase), 2.0);
        } else if (f === FLICKER.DYING) {
          target *= 0.35 + 0.1 * Math.sin(t * 31 + l.phase) + 0.08 * Math.sin(t * 7.3);
          l.ft -= dt;
          if (l.ft <= 0) {
            l.fon = !l.fon;
            l.ft = l.fon ? rng.range(0.4, 4) : rng.range(0.05, 0.3);
            if (this.onFlicker) this.onFlicker(l, l.fon);
          }
          if (!l.fon) target *= 0.1;
        } else if (f !== FLICKER.NONE || l.burst > 0) {
          l.ft -= dt;
          if (l.ft <= 0) {
            if (l.burst > 0) {
              l.fon = !l.fon;
              l.burst--;
              l.ft = l.fon ? rng.range(0.03, 0.25) : rng.range(0.02, 0.12);
              if (l.burst === 0) l.fon = true;
            } else {
              l.burst = 2 + Math.floor(rng.next() * (f === FLICKER.BAD ? 9 : 5));
              l.fon = false;
              l.ft = rng.range(0.02, 0.1);
            }
            if (l.burst === 0) l.ft = f === FLICKER.BAD ? rng.range(0.3, 4) : f === FLICKER.NONE ? 999 : rng.range(6, 45);
            if (this.onFlicker) this.onFlicker(l, l.fon);
          }
          if (!l.fon) target *= 0.06;
        }
      }
      if (l.cur !== target) {
        // fluorescent tubes snap on/off; only slight smoothing
        l.cur += (target - l.cur) * Math.min(1, dt * 40);
        if (Math.abs(l.cur - target) < 0.002) l.cur = target;
      }
      this._write(l);
    }
    this.tex.needsUpdate = true;
  }

  setMaster(v) {
    this.master = v;
  }
}
