import * as THREE from 'three';
import { RNG, clamp } from '../core/math.js';
import { worldMaterial } from '../gfx/materials.js';
import { tex } from '../gfx/textures.js';
import { FLICKER } from '../gfx/lights.js';
import { box } from '../world/world.js';
import { propMaterials, doorSlab } from './props.js';
import { chaserModel } from '../entities/models.js';

// LEVEL ! — "Run For Your Life". A deliberate contrast: three seconds of nothing,
// then red light, an alarm, and something behind you. Short and intense.

const S = 3, H = 3.2, T = 0.3, O = 1500; // cells offset so the level sits in chunk 0
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export class LevelRun {
  constructor(game, seed) {
    this.game = game;
    this.seed = seed;
    this.id = 'levelRun';
    this.chunkSize = 8000;
    this.finite = true;
    this.finiteRadius = 1;
    this.floorY = 0;
    this.bakeOpts = { floorY: 0, ceilY: H, aoStrength: 1, wrap: 0.3 };
    this.materials = {
      ...propMaterials(),
      wall: worldMaterial({ map: tex('redwall'), tile: [4, 3.2] }),
      floor: worldMaterial({ map: tex('concrete'), tile: [3, 3], tint: [0.6, 0.6, 0.6] }),
      ceil: worldMaterial({ map: tex('concrete'), tile: [3, 3], tint: [0.4, 0.4, 0.4] }),
      lamp: worldMaterial({ map: tex('white'), tint: [0.2, 0.05, 0.05] }),
      exitglow: worldMaterial({ map: tex('white'), unlit: true, emissive: [6, 6, 6] }),
    };
    this.config = {
      fogColor: [0.06, 0.01, 0.01],
      fogDensity: 0.03,
      fogLit: 0.9,
      ambient: [0.015, 0.004, 0.004],
      panelGain: 3,
      post: { key: 0.24, grade: [1.15, 0.85, 0.85], sat: 1.0, contrast: 1.15, lift: 0, bloom: 1.2 },
      reverb: { small: 0.8, medium: 1.6, large: 2.8, damp: 5000, dampEnd: 1200, metallic: 0.3, wet: 0.9 },
      hum: { bed: 0, voices: 0 },
      ambience: 'levelRun',
      card: { name: 'LEVEL !', title: 'Run For Your Life', delay: 3.5, hint: 'Run toward the light.' },
      staminaMul: 6,
      sanityAlone: 0.5,
      rumble: false,
      director: { off: true },
      voidTex: ['redwall', 'concrete'],
    };
    this._genPath();
    this.alarm = false;
    this.done = false;
  }

  _genPath() {
    const rng = new RNG(this.seed ^ 0x5151);
    for (let attempt = 0; attempt < 50; attempt++) {
      const cells = [[0, 0]];
      const set = new Set(['0,0']);
      let x = 0, z = 0, dir = 0;
      let ok = true;
      const near = (cx, cz, px, pz) => {
        // a cell is usable if none of its neighbours (other than where we came from) are used
        for (const [dx, dz] of DIRS) {
          const k = cx + dx + ',' + (cz + dz);
          if (set.has(k) && !(cx + dx === px && cz + dz === pz)) return true;
        }
        return false;
      };
      while (cells.length < 60 && ok) {
        const len = rng.int(4, 11);
        for (let i = 0; i < len; i++) {
          const nx = x + DIRS[dir][0], nz = z + DIRS[dir][1];
          if (set.has(nx + ',' + nz) || near(nx, nz, x, z)) {
            ok = i > 1;
            break;
          }
          x = nx;
          z = nz;
          cells.push([x, z]);
          set.add(x + ',' + z);
        }
        dir = (dir + (rng.chance(0.5) ? 1 : 3)) % 4;
      }
      if (cells.length >= 52) {
        this.path = cells;
        this.pathSet = set;
        break;
      }
    }
    // dead-end stubs off the path, to make the wrong turn possible
    this.stubs = [];
    const all = new Set(this.pathSet);
    for (let i = 4; i < this.path.length - 4; i++) {
      if (!rng.chance(0.12)) continue;
      const [x, z] = this.path[i];
      for (const [dx, dz] of DIRS) {
        const a = [x + dx, z + dz], b = [x + dx * 2, z + dz * 2];
        if (all.has(a.join(',')) || all.has(b.join(','))) continue;
        let clear = true;
        for (const c of [a, b])
          for (const [ex, ez] of DIRS) {
            const k = c[0] + ex + ',' + (c[1] + ez);
            if (all.has(k) && k !== x + ',' + z && k !== a.join(',')) clear = false;
          }
        if (!clear) continue;
        this.stubs.push(a, b);
        all.add(a.join(','));
        all.add(b.join(','));
        break;
      }
    }
    this.cells = all;
    // arc length along the path
    this.pathPts = this.path.map(([x, z]) => new THREE.Vector2(O + x * S + S / 2, O + z * S + S / 2));
  }

  spawn() {
    const p = this.pathPts[0], q = this.pathPts[1];
    return { x: p.x, y: 0, z: p.y, yaw: Math.atan2(-(q.x - p.x), -(q.y - p.y)) };
  }

  layout(cx, cz) {
    if (cx !== 0 || cz !== 0) return null;
    const boxes = [];
    const walls = [];
    const lights = [];
    const has = (x, z) => this.cells.has(x + ',' + z);
    for (const k of this.cells) {
      const [x, z] = k.split(',').map(Number);
      const x0 = O + x * S, z0 = O + z * S;
      if (!has(x, z - 1)) walls.push(box(x0 - T / 2, 0, z0 - T / 2, x0 + S + T / 2, H, z0 + T / 2));
      if (!has(x, z + 1)) walls.push(box(x0 - T / 2, 0, z0 + S - T / 2, x0 + S + T / 2, H, z0 + S + T / 2));
      if (!has(x - 1, z)) walls.push(box(x0 - T / 2, 0, z0 - T / 2, x0 + T / 2, H, z0 + S + T / 2));
      if (!has(x + 1, z)) walls.push(box(x0 + S - T / 2, 0, z0 - T / 2, x0 + S + T / 2, H, z0 + S + T / 2));
    }
    for (const w of walls) boxes.push(w);
    this.path.forEach(([x, z], i) => {
      if (i % 2) return;
      lights.push({ x: O + x * S + S / 2, y: H - 0.3, z: O + z * S + S / 2, r: 8, color: [1, 0.85, 0.75], base: 0.35, flicker: FLICKER.NONE, dead: false, phase: i * 0.7, silent: true });
    });
    // the end: light from a door
    const last = this.pathPts[this.pathPts.length - 1];
    lights.push({ x: last.x, y: 1.5, z: last.y, r: 9, color: [1, 1, 1], base: 1.2, flicker: FLICKER.NONE, dead: false, silent: true, exitLight: true });
    this.lights = lights;
    return { boxes, walls, lights, ox: 0, oz: 0 };
  }

  build(lay, mb) {
    for (const k of this.cells) {
      const [x, z] = k.split(',').map(Number);
      const x0 = O + x * S, z0 = O + z * S;
      mb.flat('floor', x0, z0, x0 + S, z0 + S, 0, true, { step: 1.5 });
      mb.flat('ceil', x0, z0, x0 + S, z0 + S, H, false, { step: 1.5 });
    }
    for (const w of lay.walls) mb.box('wall', w.minX, 0, w.minZ, w.maxX, H, w.maxZ, { faces: 'xXzZ', step: 1.5, vstep: 1.1 });
    for (const l of lay.lights) {
      if (l.exitLight) continue;
      mb.box('lamp', l.x - 0.25, l.y - 0.06, l.z - 0.25, l.x + 0.25, l.y + 0.3, l.z + 0.25, { faces: 'xXzZy', emit: l.slot });
    }
    // the exit: a doorway filled with white
    const n = this.path.length;
    const [lx, lz] = this.path[n - 1], [px, pz] = this.path[n - 2];
    const dx = lx - px, dz = lz - pz;
    const cx = O + lx * S + S / 2 + dx * (S / 2 - T / 2 - 0.01), cz = O + lz * S + S / 2 + dz * (S / 2 - T / 2 - 0.01);
    const tx = -dz, tz = dx;
    const a = [cx - tx * 0.5, 0, cz - tz * 0.5], b = [cx + tx * 0.5, 0, cz + tz * 0.5];
    mb.quad('exitglow', b, a, [a[0], 2.1, a[2]], [b[0], 2.1, b[2]], [-dx, 0, -dz], [[0, 0], [1, 0], [1, 1], [0, 1]], { kind: 3 });
    this.exitPos = new THREE.Vector2(cx - dx * 1.2, cz - dz * 1.2);
    return { extra: [], interactables: [], zones: [] };
  }

  /** Arc-length position of a point projected onto the path. */
  _proj(x, z) {
    let best = 1e9, bi = 0;
    for (let i = 0; i < this.pathPts.length; i++) {
      const p = this.pathPts[i];
      const d = (p.x - x) ** 2 + (p.y - z) ** 2;
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    return { s: bi * S, i: bi, off: Math.sqrt(best) };
  }

  _at(s) {
    const i = clamp(Math.floor(s / S), 0, this.pathPts.length - 2);
    const t = clamp(s / S - i, 0, 1);
    const a = this.pathPts[i], b = this.pathPts[i + 1];
    return new THREE.Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  }

  onEnter(game) {
    this.t = 0;
    this.chaserS = -28;
    this.stepT = 0;
    this.roarT = 6;
    this.chaser = chaserModel();
    this.chaser.visible = false;
    game.scene.add(this.chaser);
    game.ui.showMessage('', 0.1);
  }

  dispose() {
    if (this.chaser) this.game.scene.remove(this.chaser);
  }

  update(dt, game) {
    this.t += dt;
    const p = game.player;
    const a = game.audio;
    if (!this.alarm && this.t > 3.2) {
      // it starts
      this.alarm = true;
      for (const l of this.lights) {
        if (l.exitLight) continue;
        l.color = [1, 0.08, 0.05];
        l.base = 1.5;
        l.flicker = FLICKER.PULSE;
      }
      a.play('boom', { gain: 0.8, bus: 'amb', reverb: 1 });
      a.playAt('roar', new THREE.Vector3(this.pathPts[0].x, 1.5, this.pathPts[0].y - 10), { gain: 0.9, reverb: 1.2, ref: 6 });
      game.codex.addEntity('chaser');
    }
    if (!this.alarm || this.done) return;
    const me = this._proj(p.pos.x, p.pos.z);
    // Rubber-banded so it always feels close: it closes in fast when you're far
    // ahead, but anyone sprinting (4.6 m/s) still pulls away once it's near.
    const gap = me.s - this.chaserS;
    const speed = gap > 22 ? 4.4 : gap > 10 ? 3.7 : 3.3;
    this.chaserS += speed * dt;
    const cpos = this._at(Math.max(0, this.chaserS));
    let dist = me.s - this.chaserS;
    // in a dead-end stub, it simply comes for you
    if (me.off > 2 && this.chaserS > me.s - 1) dist = Math.hypot(cpos.x - p.pos.x, cpos.y - p.pos.z);
    this.chaser.position.set(cpos.x, 0, cpos.y);
    this.chaser.rotation.y = Math.atan2(-(p.pos.x - cpos.x), -(p.pos.z - cpos.y));
    this.chaser.visible = this.chaserS > 0;
    for (const m of this.chaser.userData.mats) m.uniforms.uObjLight.value.set(0.3, 0.02, 0.02);
    this.stepT -= dt;
    if (this.stepT <= 0) {
      this.stepT = 0.42;
      a.playAt('boom', new THREE.Vector3(cpos.x, 0.3, cpos.y), { gain: 0.7, reverb: 0.7, ref: 4, rate: 1.3 });
    }
    this.roarT -= dt;
    if (this.roarT <= 0) {
      this.roarT = 7 + Math.random() * 6;
      a.playAt('roar', new THREE.Vector3(cpos.x, 2, cpos.y), { gain: 0.7, reverb: 1, ref: 5, rate: 0.9 + Math.random() * 0.2 });
    }
    const close = clamp(1 - dist / 18, 0, 1);
    game.director.fear = Math.max(game.director.fear, 0.5 + close * 0.5);
    game.entities.glitch = Math.max(game.entities.glitch, close * 0.6);
    game.fx.redTint = 0.15 + close * 0.25;
    if (dist < 1.2) {
      this.done = true;
      game.fx.redTint = 0;
      game.entities.caught('chaser');
      return;
    }
    // reached the light
    const e = this.exitPos;
    if (e && Math.hypot(p.pos.x - e.x, p.pos.z - e.y) < 1.6) {
      this.done = true;
      this.chaser.visible = false;
      game.fx.redTint = 0;
      game.transitionTo('level4', { style: 'white' });
    }
  }

  extraExits() {
    return this.exitPos ? [{ x: this.exitPos.x, z: this.exitPos.y, label: 'the light' }] : [];
  }

  surfaceAt() {
    return 'concrete';
  }
}
