import * as THREE from 'three';
import { RNG, clamp, wrapAngle } from '../core/math.js';
import { facelingModel, silhouetteModel, houndModel, partygoerModel, smilerModel } from './models.js';

// Entities are rare and restrained: mostly glimpsed, rarely confronted.
// Each runs a small state machine (idle -> wander -> notice -> hunt -> lose
// interest) and is only ever spawned by the dread director or a level script.

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const frustum = new THREE.Frustum();
const projM = new THREE.Matrix4();

export class Entities {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.fearSource = 0;
    this.glitch = 0;
    this.rng = new RNG((Math.random() * 1e9) | 0);
    this.crumbs = [];
    this.crumbT = 0;
  }

  get busy() {
    return this.list.some((e) => e.blocking);
  }

  clear() {
    for (const e of this.list) e.dispose();
    this.list = [];
    this.crumbs = [];
  }

  add(e) {
    this.list.push(e);
    return e;
  }

  remove(e) {
    e.dispose();
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
  }

  // ---------- perception helpers ----------
  _updateFrustum() {
    const cam = this.game.camera;
    cam.updateMatrixWorld();
    projM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projM);
  }

  /** Is a point on screen and in line of sight? */
  seen(pos, radius = 0.4, y = 1.5) {
    tmp.set(pos.x, y, pos.z);
    const s = new THREE.Sphere(tmp, radius);
    if (!frustum.intersectsSphere(s)) return false;
    const p = this.game.player.pos;
    return this.game.world.lineOfSight(p.x, p.z, pos.x, pos.z, Math.min(1.5, y));
  }

  /** Angle between view direction and the direction to a point. */
  viewAngle(pos) {
    const cam = this.game.camera;
    const f = cam.getWorldDirection(tmp2);
    const dx = pos.x - cam.position.x, dz = pos.z - cam.position.z;
    const a = Math.atan2(dz, dx) - Math.atan2(f.z, f.x);
    return Math.abs(wrapAngle(a));
  }

  distTo(pos) {
    const p = this.game.player.pos;
    return Math.hypot(pos.x - p.x, pos.z - p.z);
  }

  /** Find a far point the player can see along a straight sight line. */
  findSightPoint(minD, maxD, { angMin = 0, angMax = Math.PI, dark = false } = {}) {
    const g = this.game;
    const p = g.player.pos;
    const f = g.camera.getWorldDirection(tmp2);
    const base = Math.atan2(f.z, f.x);
    const cands = [];
    for (let i = 0; i < 28; i++) {
      const off = (this.rng.next() * 2 - 1) * angMax;
      if (Math.abs(off) < angMin) continue;
      const a = base + off;
      const dx = Math.cos(a), dz = Math.sin(a);
      const d = g.world.raycast(p.x, p.z, dx, dz, maxD + 2, 1.5);
      if (d < minD + 1) continue;
      const dd = Math.min(maxD, d - 1.0) * (0.75 + this.rng.next() * 0.25);
      if (dd < minD) continue;
      const x = p.x + dx * dd, z = p.z + dz * dd;
      if (g.world.blockedAt(x, z, 0.45, 1)) continue;
      if (dark) {
        const l = g.lights.sample(x, 1.5, z, tmp, (x0, z0, x1, z1) => !g.world.lineOfSight(x0, z0, x1, z1, 2));
        if (l.x + l.y + l.z > 0.08) continue;
      }
      cands.push({ x, z, d: dd });
    }
    if (!cands.length) return null;
    return cands[Math.floor(this.rng.next() * cands.length)];
  }

  /** A point out of the player's line of sight, roughly at a distance. */
  findHiddenPoint(minD, maxD) {
    const g = this.game;
    const p = g.player.pos;
    for (let i = 0; i < 40; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const d = this.rng.range(minD, maxD);
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (g.world.blockedAt(x, z, 0.5, 1)) continue;
      if (g.world.floorAt(x, z, 0).y < -1) continue;
      if (g.world.lineOfSight(p.x, p.z, x, z)) continue;
      return { x, z };
    }
    return null;
  }

  // ---------- spawning ----------
  spawn(type, mode = 'glimpse') {
    const g = this.game;
    if (g.level?.config?.noEntities) return false;
    let e = null;
    switch (type) {
      case 'faceling':
        e = Faceling.create(this, mode);
        break;
      case 'smiler':
        e = Smiler.create(this, mode);
        break;
      case 'hound':
        e = Hound.create(this, mode);
        break;
      case 'skinstealer':
        e = SkinStealer.create(this, mode);
        break;
      case 'partygoer':
        e = Partygoer.create(this, mode);
        break;
      default:
        return false;
    }
    if (!e) return false;
    this.add(e);
    return true;
  }

  /** A hallucination at the edge of vision that's gone when you look. */
  peripheral() {
    const g = this.game;
    if (g.level?.config?.noEntities && g.levelId !== 'level37') return;
    const side = this.rng.sign();
    const f = g.camera.getWorldDirection(tmp2);
    const a = Math.atan2(f.z, f.x) + side * this.rng.range(0.75, 0.95);
    const p = g.player.pos;
    const d = this.rng.range(5, 10);
    const lim = g.world.raycast(p.x, p.z, Math.cos(a), Math.sin(a), d + 1);
    if (lim < 4) return;
    const dd = Math.min(d, lim - 0.8);
    this.add(new Peripheral(this, p.x + Math.cos(a) * dd, p.z + Math.sin(a) * dd));
  }

  update(dt) {
    const g = this.game;
    this._updateFrustum();
    // breadcrumbs of where the player has been (hounds follow them)
    this.crumbT -= dt;
    if (this.crumbT <= 0) {
      this.crumbT = 0.5;
      const p = g.player.pos;
      const last = this.crumbs[this.crumbs.length - 1];
      if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 1.0) {
        this.crumbs.push({ x: p.x, z: p.z });
        if (this.crumbs.length > 80) this.crumbs.shift();
      }
    }
    let fear = 0, glitch = 0;
    for (const e of [...this.list]) {
      e.update(dt);
      fear = Math.max(fear, e.fear || 0);
      glitch = Math.max(glitch, e.glitch || 0);
      if (e.dead) this.remove(e);
    }
    this.fearSource = fear;
    this.glitch = glitch;
  }

  /** Something got the player. */
  caught(type) {
    const g = this.game;
    if (g.seq || g.state !== 'play') return;
    g.ending('lost', { by: type });
  }
}

// ---------------------------------------------------------------------------

class Base {
  constructor(mgr, obj) {
    this.mgr = mgr;
    this.game = mgr.game;
    this.obj = obj;
    this.pos = new THREE.Vector3();
    this.t = 0;
    this.state = 'idle';
    this.stateT = 0;
    this.fear = 0;
    this.glitch = 0;
    this.dead = false;
    this.light = new THREE.Vector3();
    if (obj) this.game.scene.add(obj);
  }
  setState(s) {
    this.state = s;
    this.stateT = 0;
  }
  dispose() {
    if (this.obj) {
      this.game.scene.remove(this.obj);
      this.obj.traverse((o) => o.geometry && o.geometry.dispose());
    }
  }
  /** Sample light at our position for the materials, plus a little flashlight. */
  relight(mats, k = 1) {
    const g = this.game;
    g.lights.sample(this.pos.x, 1.5, this.pos.z, this.light, (x0, z0, x1, z1) => !g.world.lineOfSight(x0, z0, x1, z1, 2));
    // flashlight on us?
    const G = g.flash;
    if (g.player.flashlight) {
      tmp.set(this.pos.x, 1.4, this.pos.z).sub(G.pos);
      const d = tmp.length();
      const c = tmp.normalize().dot(G.dir);
      if (c > 0.93 && d < 16) this.light.addScalar(((c - 0.93) / 0.07) * 1.5 / (1 + d * d * 0.12));
    }
    this.light.multiplyScalar(k);
    for (const m of mats) m.uniforms.uObjLight.value.copy(this.light);
  }
  faceTowards(x, z, dt, speed = 4) {
    const a = Math.atan2(-(x - this.pos.x), -(z - this.pos.z));
    const cur = this.obj.rotation.y;
    this.obj.rotation.y = cur + wrapAngle(a - cur) * Math.min(1, dt * speed);
  }
  moveTowards(x, z, speed, dt) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return 0;
    const step = Math.min(d, speed * dt);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    this.game.world.collide(this.pos, 0.35, 0.3, 1.6);
    return d;
  }
}

// --- Facelings: featureless figures standing very still, far away. ---
class Faceling extends Base {
  static create(mgr, mode) {
    const sp = mgr.findSightPoint(mode === 'glimpse' ? 16 : 12, mode === 'glimpse' ? 34 : 26, { angMin: 0.5, angMax: 1.9 });
    if (!sp) return null;
    const e = new Faceling(mgr, facelingModel());
    e.mode = mode;
    e.pos.set(sp.x, 0, sp.z);
    e.approaches = mode === 'encounter' ? 4 : mgr.rng.chance(0.25) ? 1 : 0;
    e.seenT = 0;
    e.unseenT = 0;
    e.everSeen = false;
    return e;
  }
  update(dt) {
    const m = this.mgr;
    this.t += dt;
    this.stateT += dt;
    const p = this.game.player.pos;
    this.pos.y = this.game.world.floorAt(this.pos.x, this.pos.z, 0).y;
    this.obj.position.copy(this.pos);
    this.faceTowards(p.x, p.z, dt, 0.5);
    if ((this.t * 4) % 1 < dt * 4) this.relight(this.obj.userData.mats, 0.9);
    const vis = m.seen(this.pos, 0.5, 1.4);
    const d = m.distTo(this.pos);
    if (vis) {
      this.seenT += dt;
      this.unseenT = 0;
      if (!this.everSeen && this.seenT > 0.4) {
        this.everSeen = true;
        this.game.codex.addEntity('faceling');
        this.game.director.fear = Math.max(this.game.director.fear, 0.4);
      }
    } else {
      this.unseenT += dt;
    }
    this.fear = vis ? clamp(0.35 - d / 80, 0.05, 0.35) : 0;
    // the head turns, very slowly, to follow you
    const head = this.obj.userData.head;
    if (head) head.rotation.y = Math.sin(this.t * 0.2) * 0.1;
    // looked away: either gone, or a little closer
    if (this.everSeen && this.unseenT > 1.2) {
      if (this.approaches > 0 && d > 8) {
        this.approaches--;
        const k = this.mode === 'encounter' ? 0.65 : 0.8;
        const nx = p.x + (this.pos.x - p.x) * k, nz = p.z + (this.pos.z - p.z) * k;
        if (!this.game.world.blockedAt(nx, nz, 0.4, 1) && this.game.world.lineOfSight(p.x, p.z, nx, nz)) {
          this.pos.x = nx;
          this.pos.z = nz;
        }
        this.unseenT = -2;
        this.seenT = 0;
      } else {
        this.dead = true;
      }
    }
    if (d < 7 && vis) {
      // too close: it is simply not there anymore the next instant you blink
      this.game.fx.glitch = Math.max(this.game.fx.glitch, 0.8);
      this.game.audio.play('static', { gain: 0.08, bus: 'ui' });
      this.dead = true;
    }
    if (this.t > 90 || d > 70) this.dead = true;
  }
}

// --- Smilers: a grin in the dark. Look away and back: gone. Walk into the dark: not gone. ---
class Smiler extends Base {
  static create(mgr, mode) {
    const sp = mgr.findSightPoint(mode === 'glimpse' ? 12 : 9, 26, { angMin: 0, angMax: 1.4, dark: true });
    if (!sp) return null;
    const e = new Smiler(mgr, smilerModel());
    e.mode = mode;
    e.pos.set(sp.x, 0, sp.z);
    e.obj.position.set(sp.x, 1.6, sp.z);
    e.everSeen = false;
    e.away = false;
    e.opacity = 0;
    return e;
  }
  update(dt) {
    const m = this.mgr, g = this.game;
    this.t += dt;
    const vis = m.seen(this.pos, 0.3, 1.6);
    const d = m.distTo(this.pos);
    const mat = this.obj.material;
    // light kills it
    g.lights.sample(this.pos.x, 1.5, this.pos.z, this.light, (x0, z0, x1, z1) => !g.world.lineOfSight(x0, z0, x1, z1, 2));
    let lit = this.light.x + this.light.y + this.light.z;
    let flashed = false;
    if (g.player.flashlight) {
      tmp.set(this.pos.x, 1.6, this.pos.z).sub(g.flash.pos);
      const dd = tmp.length();
      if (tmp.normalize().dot(g.flash.dir) > 0.95 && dd < 14 && vis) flashed = true;
    }
    const target = this.leaving ? 0 : lit > 0.15 ? 0 : 0.9 + Math.sin(this.t * 1.7) * 0.08;
    this.opacity += (target - this.opacity) * Math.min(1, dt * (this.leaving ? 3 : 0.8));
    mat.opacity = this.opacity;
    this.obj.position.y = 1.6 + Math.sin(this.t * 0.6) * 0.03;
    if (vis && this.opacity > 0.3) {
      if (!this.everSeen) {
        this.everSeen = true;
        g.codex.addEntity('smiler');
        g.director.fear = Math.max(g.director.fear, 0.6);
      }
      if (this.away) this.leaving = true; // looked away and back: it's gone
    }
    if (this.everSeen && !vis) this.away = true;
    this.fear = vis ? clamp(0.8 - d / 30, 0.1, 0.8) * this.opacity : 0;
    this.glitch = vis ? clamp(0.4 - d / 40, 0, 0.4) * this.opacity : 0;
    if (flashed && this.opacity > 0.2) {
      this.leaving = true;
      g.player.sanity -= 4;
      g.audio.play('static', { gain: 0.12, bus: 'ui' });
    }
    if (this.leaving && this.opacity < 0.02) this.dead = true;
    // walk into the dark toward it and it comes for you
    if (!this.leaving && this.mode === 'encounter' && d < 4.2 && g.localLight < 0.06 && this.opacity > 0.5) {
      m.caught('smiler');
      this.dead = true;
    } else if (!this.leaving && this.mode === 'glimpse' && d < 8) {
      this.leaving = true;
    }
    if (this.t > 120 || d > 60) this.dead = true;
  }
}

// --- Hounds: heard before seen. Drawn by running. ---
class Hound extends Base {
  static create(mgr, mode) {
    const g = mgr.game;
    let sp;
    if (mode === 'glimpse') {
      sp = mgr.findSightPoint(18, 30, { angMin: 0, angMax: 0.8 });
    } else sp = mgr.findHiddenPoint(26, 40);
    if (!sp) return null;
    const e = new Hound(mgr, houndModel());
    e.mode = mode;
    e.pos.set(sp.x, 0, sp.z);
    e.blocking = mode === 'encounter';
    e.soundT = 1;
    e.lostT = 0;
    e.wanderTarget = null;
    e.target = new THREE.Vector3();
    e.setState(mode === 'glimpse' ? 'cross' : 'wander');
    if (mode === 'glimpse') {
      // trot across the sight line
      const p = g.player.pos;
      const dx = sp.x - p.x, dz = sp.z - p.z;
      const l = Math.hypot(dx, dz);
      const side = mgr.rng.sign();
      e.target.set(sp.x + (-dz / l) * 10 * side, 0, sp.z + (dx / l) * 10 * side);
      e.pos.x -= (-dz / l) * 3 * side;
      e.pos.z -= (dx / l) * 3 * side;
    }
    e.pos.y = 0;
    return e;
  }
  _sound(name, gain, opts = {}) {
    this.game.audio.playAt(name, tmp.set(this.pos.x, 0.8, this.pos.z), { gain, reverb: 0.8, ref: 2.5, ...opts });
  }
  update(dt) {
    const m = this.mgr, g = this.game;
    this.t += dt;
    this.stateT += dt;
    const p = g.player;
    const d = m.distTo(this.pos);
    const los = g.world.lineOfSight(p.pos.x, p.pos.z, this.pos.x, this.pos.z, 0.9);
    const vis = los && m.seen(this.pos, 0.6, 0.8);
    if (vis && !this.everSeen) {
      this.everSeen = true;
      g.codex.addEntity('hound');
    }
    let speed = 0;
    this.soundT -= dt;
    switch (this.state) {
      case 'cross': {
        speed = 3.2;
        const left = this.moveTowards(this.target.x, this.target.z, speed, dt);
        this.faceTowards(this.target.x, this.target.z, dt, 8);
        if (this.soundT <= 0) {
          this.soundT = 0.3;
          this._sound('pad', 0.25);
        }
        if (left < 0.3 || this.stateT > 8) this.dead = true;
        this.fear = vis ? 0.5 : 0.1;
        break;
      }
      case 'wander': {
        // pacing out of sight, breathing, letting itself be heard
        speed = 1.1;
        if (!this.wanderTarget || this.moveTowards(this.wanderTarget.x, this.wanderTarget.z, speed, dt) < 0.5) {
          const a = m.rng.next() * Math.PI * 2;
          this.wanderTarget = { x: this.pos.x + Math.cos(a) * 6, z: this.pos.z + Math.sin(a) * 6 };
        }
        this.faceTowards(this.wanderTarget.x, this.wanderTarget.z, dt, 3);
        if (this.soundT <= 0) {
          this.soundT = m.rng.range(3, 7);
          this._sound(m.rng.chance(0.7) ? 'pant' : 'growl', m.rng.range(0.35, 0.6));
        }
        // it hears running from far, walking only up close
        const hear = p.noise * (p.sprinting ? 42 : 11);
        if (d < hear || (vis && d < 14)) {
          this.setState('notice');
          this._sound('growl', 0.9, { rate: 0.9 });
          g.director.fear = 0.8;
        }
        if (this.stateT > 75) this.setState('leave');
        this.fear = clamp(0.4 - d / 100, 0.1, 0.4);
        break;
      }
      case 'notice': {
        this.faceTowards(p.pos.x, p.pos.z, dt, 6);
        if (this.stateT > 1.4) this.setState('hunt');
        this.fear = 0.8;
        break;
      }
      case 'hunt': {
        speed = 4.15;
        let tx = p.pos.x, tz = p.pos.z;
        if (!los) {
          // follow the breadcrumbs: the newest crumb it can see
          const cr = m.crumbs;
          for (let i = cr.length - 1; i >= 0; i--) {
            if (g.world.lineOfSight(this.pos.x, this.pos.z, cr[i].x, cr[i].z, 0.9)) {
              tx = cr[i].x;
              tz = cr[i].z;
              break;
            }
          }
          this.lostT += dt * (p.noise > 0.5 ? 0.2 : 1) * (p.crouch > 0.5 ? 1.6 : 1);
        } else this.lostT = Math.max(0, this.lostT - dt * 2);
        this.moveTowards(tx, tz, speed, dt);
        this.faceTowards(tx, tz, dt, 8);
        if (this.soundT <= 0) {
          this.soundT = 0.22;
          this._sound('pad', 0.5, { rate: 1.2 });
          if (m.rng.chance(0.15)) this._sound('growl', 0.8, { rate: 1.1 });
        }
        if (d < 1.1) {
          m.caught('hound');
          this.dead = true;
        }
        if (this.lostT > 7) {
          this.setState('leave');
          this._sound('pant', 0.4);
        }
        this.fear = 1;
        this.glitch = clamp(0.5 - d / 30, 0, 0.5);
        break;
      }
      case 'leave': {
        speed = 1.8;
        const a = Math.atan2(this.pos.z - p.pos.z, this.pos.x - p.pos.x);
        this.moveTowards(this.pos.x + Math.cos(a) * 3, this.pos.z + Math.sin(a) * 3, speed, dt);
        this.fear = Math.max(0, this.fear - dt * 0.2);
        this.glitch = 0;
        this.blocking = false;
        if (this.stateT > 18 || (d > 40 && !vis)) this.dead = true;
        break;
      }
      default:
        break;
    }
    // legs
    const legs = this.obj.userData.legs;
    const ph = this.t * (speed * 3.2);
    legs.forEach((l, i) => (l.rotation.x = Math.sin(ph + (i % 2 ? Math.PI : 0) + (i > 1 ? 1.5 : 0)) * Math.min(0.7, speed * 0.2)));
    this.pos.y = Math.max(0, g.world.floorAt(this.pos.x, this.pos.z, 0).y);
    this.obj.position.copy(this.pos);
    if ((this.t * 5) % 1 < dt * 5) this.relight(this.obj.userData.mats, 0.6);
    if (this.t > 160) this.dead = true;
  }
}

// --- Skin-stealer: a voice asking for help from somewhere you can't reach. ---
class SkinStealer extends Base {
  static create(mgr) {
    const sp = mgr.findHiddenPoint(18, 30);
    if (!sp) return null;
    const e = new SkinStealer(mgr, null);
    e.pos.set(sp.x, 1.5, sp.z);
    e.calls = 4 + Math.floor(mgr.rng.next() * 3);
    e.callT = 2;
    e.blocking = true;
    return e;
  }
  update(dt) {
    const m = this.mgr, g = this.game;
    this.t += dt;
    this.callT -= dt;
    const d = m.distTo(this.pos);
    if (d < 9 || g.world.lineOfSight(g.player.pos.x, g.player.pos.z, this.pos.x, this.pos.z)) {
      // never where you look for it
      const sp = m.findHiddenPoint(18, 30);
      if (sp) this.pos.set(sp.x, 1.5, sp.z);
    }
    if (this.callT <= 0) {
      this.callT = m.rng.range(7, 14);
      this.calls--;
      const line = m.rng.pick(['voice_help', 'voice_hello', 'voice_helpme', 'voice_overhere']);
      g.audio.playAt(line, this.pos, { gain: 0.5, reverb: 1.3, ref: 4, rate: m.rng.range(0.92, 1.02) });
      if (this.calls === 2) g.codex.addEntity('skinstealer');
      this.fear = 0.35;
    }
    this.fear = Math.max(0, this.fear - dt * 0.05);
    if (this.calls <= 0 && this.callT < 4) {
      this.dead = true;
      this.blocking = false;
    }
  }
}

// --- Partygoers: very happy to see you. ---
class Partygoer extends Base {
  static create(mgr, mode, at) {
    const sp = at || mgr.findHiddenPoint(14, 26);
    if (!sp) return null;
    const e = new Partygoer(mgr, partygoerModel());
    e.pos.set(sp.x, 0, sp.z);
    e.obj.rotation.y = mgr.rng.next() * 6;
    e.giggleT = mgr.rng.range(4, 12);
    return e;
  }
  update(dt) {
    const m = this.mgr, g = this.game;
    this.t += dt;
    const p = g.player.pos;
    const d = m.distTo(this.pos);
    const los = d < 22 && g.world.lineOfSight(p.x, p.z, this.pos.x, this.pos.z, 1.4);
    const watched = los && m.seen(this.pos, 0.5, 1.5) && m.viewAngle(this.pos) < 0.5;
    if (watched && !this.everSeen) {
      this.everSeen = true;
      g.codex.addEntity('partygoer');
    }
    // they only move while you aren't looking straight at them
    if (los && !watched) {
      this.moveTowards(p.x, p.z, d < 6 ? 2.3 : 1.6, dt);
      this.faceTowards(p.x, p.z, dt, 5);
      this.obj.position.y = Math.abs(Math.sin(this.t * 7)) * 0.05;
    } else if (los) {
      this.faceTowards(p.x, p.z, dt, 1);
    }
    this.giggleT -= dt;
    if (this.giggleT <= 0 && d < 20) {
      this.giggleT = m.rng.range(6, 16);
      g.audio.playAt('voice_giggle', tmp.set(this.pos.x, 1.7, this.pos.z), { gain: 0.4, reverb: 0.6, rate: m.rng.range(1.0, 1.25) });
    }
    this.fear = los ? clamp(0.7 - d / 25, 0, 0.7) : 0;
    this.glitch = los ? clamp(0.35 - d / 30, 0, 0.35) : 0;
    if (d < 1.0) {
      m.caught('partygoer');
      this.dead = true;
    }
    this.obj.position.x = this.pos.x;
    this.obj.position.z = this.pos.z;
    if ((this.t * 3) % 1 < dt * 3) this.relight(this.obj.userData.mats, 1);
  }
}
Entities.Partygoer = Partygoer;

// --- Hallucination: a shape at the edge of vision. ---
class Peripheral extends Base {
  constructor(mgr, x, z) {
    super(mgr, silhouetteModel());
    this.pos.set(x, 0, z);
    this.obj.position.copy(this.pos);
    const p = this.game.player.pos;
    this.obj.rotation.y = Math.atan2(-(p.x - x), -(p.z - z));
  }
  update(dt) {
    this.t += dt;
    if (this.mgr.viewAngle(this.pos) < 0.45 || this.t > 1.6) this.dead = true;
  }
}
