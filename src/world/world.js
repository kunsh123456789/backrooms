import * as THREE from 'three';
import { Baker, MeshBuilder, Occluder } from '../gfx/builder.js';

// The World streams chunks of the current level around the player.
// Layouts (cheap, deterministic data: walls, lights, props) are generated for a
// wider ring than meshes so light baking can see neighbouring lights and walls.

const HC = 4; // collider hash cell size

class BoxHash {
  constructor() {
    this.map = new Map();
    this.stamp = 0;
  }
  _k(x, z) {
    return x * 92837111 + z * 689287499;
  }
  add(b) {
    b._hs = 0;
    const x0 = Math.floor(b.minX / HC), x1 = Math.floor(b.maxX / HC);
    const z0 = Math.floor(b.minZ / HC), z1 = Math.floor(b.maxZ / HC);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const k = this._k(x, z);
        let a = this.map.get(k);
        if (!a) this.map.set(k, (a = []));
        a.push(b);
      }
  }
  remove(b) {
    const x0 = Math.floor(b.minX / HC), x1 = Math.floor(b.maxX / HC);
    const z0 = Math.floor(b.minZ / HC), z1 = Math.floor(b.maxZ / HC);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const a = this.map.get(this._k(x, z));
        if (!a) continue;
        const i = a.indexOf(b);
        if (i >= 0) a.splice(i, 1);
      }
  }
  clear() {
    this.map.clear();
  }
  /** Iterate boxes overlapping a 2D rect (each once). */
  each(minX, minZ, maxX, maxZ, fn) {
    const s = ++this.stamp;
    const x0 = Math.floor(minX / HC), x1 = Math.floor(maxX / HC);
    const z0 = Math.floor(minZ / HC), z1 = Math.floor(maxZ / HC);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const a = this.map.get(this._k(x, z));
        if (!a) continue;
        for (const b of a) {
          if (b._hs === s) continue;
          b._hs = s;
          if (fn(b) === false) return;
        }
      }
  }
}

export class World {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.lights = game.lights;
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.level = null;
    this.layouts = new Map();
    this.chunks = new Map();
    this.colliders = new BoxHash();
    this.zones = new BoxHash();
    this.interactables = [];
    this.taken = new Set(); // picked-up item ids
    this.viewChunks = 1;
    this.buildQueue = [];
    this.pcx = 0;
    this.pcz = 0;
    this.dynamicBoxes = new Set();
  }

  setLevel(level) {
    this.clear();
    this.level = level;
  }

  clear() {
    for (const [, c] of this.chunks) this._unloadChunk(c);
    this.chunks.clear();
    for (const [, l] of this.layouts) this._evictLayout(l);
    this.layouts.clear();
    this.colliders.clear();
    this.zones.clear();
    this.interactables.length = 0;
    for (const b of this.dynamicBoxes) this.colliders.remove(b);
    this.dynamicBoxes.clear();
    this.lights.clear();
  }

  key(cx, cz) {
    return cx + ',' + cz;
  }

  getLayout(cx, cz) {
    const k = this.key(cx, cz);
    let l = this.layouts.get(k);
    if (l === undefined) {
      l = this.level.layout(cx, cz) || null;
      if (l) {
        l.cx = cx;
        l.cz = cz;
        l.key = k;
        for (const li of l.lights) this.lights.add(li);
      }
      this.layouts.set(k, l);
    }
    return l;
  }

  _evictLayout(l) {
    if (!l) return;
    for (const li of l.lights) this.lights.remove(li);
  }

  /** Convert world position to chunk coords. */
  chunkOf(x, z) {
    const s = this.level.chunkSize;
    return [Math.floor(x / s), Math.floor(z / s)];
  }

  update(px, pz, force = false) {
    if (!this.level) return;
    const [cx, cz] = this.chunkOf(px, pz);
    const r = this.level.finite ? this.level.finiteRadius ?? 0 : this.viewChunks;
    if (cx !== this.pcx || cz !== this.pcz || force || !this._init) {
      this._init = true;
      this.pcx = cx;
      this.pcz = cz;
      const want = [];
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          const k = this.key(cx + dx, cz + dz);
          if (!this.chunks.has(k)) want.push([cx + dx, cz + dz, dx * dx + dz * dz]);
        }
      want.sort((a, b) => a[2] - b[2]);
      this.buildQueue = want;
      // unload far chunks
      for (const [k, c] of this.chunks) {
        if (Math.abs(c.cx - cx) > r + 1 || Math.abs(c.cz - cz) > r + 1) {
          this._unloadChunk(c);
          this.chunks.delete(k);
          if (this.level.onChunkUnloaded) this.level.onChunkUnloaded(c.cx, c.cz, this);
        }
      }
      for (const [k, l] of this.layouts) {
        if (!l) {
          this.layouts.delete(k);
          continue;
        }
        if (Math.abs(l.cx - cx) > r + 2 || Math.abs(l.cz - cz) > r + 2) {
          this._evictLayout(l);
          this.layouts.delete(k);
        }
      }
    }
    // build at most one chunk per frame (all of them when forced)
    let budget = force ? 999 : 1;
    while (budget > 0 && this.buildQueue.length) {
      const [bx, bz] = this.buildQueue.shift();
      if (this.chunks.has(this.key(bx, bz))) continue;
      this._buildChunk(bx, bz);
      budget--;
    }
  }

  _buildChunk(cx, cz) {
    const lay = this.getLayout(cx, cz);
    const k = this.key(cx, cz);
    if (!lay) {
      this.chunks.set(k, { cx, cz, empty: true, colliders: [], zones: [], inter: [] });
      return;
    }
    const lights = [];
    const boxes = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const l = this.getLayout(cx + dx, cz + dz);
        if (!l) continue;
        for (const li of l.lights) lights.push(li);
        for (const b of l.boxes) boxes.push(b);
      }
    const occ = new Occluder(boxes);
    const baker = new Baker(lights, occ, this.level.bakeOpts || {});
    const mb = new MeshBuilder();
    const res = this.level.build(lay, mb, this) || {};
    const group = mb.finalize(this.level.materials, baker);
    if (res.extra) for (const o of res.extra) group.add(o);
    this.root.add(group);
    const chunk = { cx, cz, group, layout: lay, colliders: [], zones: res.zones || [], inter: res.interactables || [], update: res.update, dispose: res.dispose };
    for (const b of lay.boxes) {
      if (b.col === false) continue;
      this.colliders.add(b);
      chunk.colliders.push(b);
    }
    if (res.colliders) for (const b of res.colliders) {
      this.colliders.add(b);
      chunk.colliders.push(b);
    }
    for (const z of chunk.zones) this.zones.add(z);
    for (const it of chunk.inter) this.interactables.push(it);
    this.chunks.set(k, chunk);
  }

  _unloadChunk(c) {
    if (c.group) {
      this.root.remove(c.group);
      c.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    }
    for (const b of c.colliders) this.colliders.remove(b);
    for (const z of c.zones) this.zones.remove(z);
    if (c.inter.length) this.interactables = this.interactables.filter((i) => !c.inter.includes(i));
    if (c.dispose) c.dispose();
  }

  addDynamicBox(b) {
    this.colliders.add(b);
    this.dynamicBoxes.add(b);
  }
  removeDynamicBox(b) {
    this.colliders.remove(b);
    this.dynamicBoxes.delete(b);
  }

  /** Per-frame chunk-local updates (animated props). */
  tick(dt) {
    for (const [, c] of this.chunks) if (c.update) c.update(dt);
  }

  // ---------- queries ----------

  /** Resolve a circle at (pos.x,pos.z) radius r against boxes overlapping y range. */
  collide(pos, r, y0, y1) {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.colliders.each(pos.x - r, pos.z - r, pos.x + r, pos.z + r, (b) => {
        if (b.disabled) return;
        if (y1 <= b.minY || y0 >= b.maxY) return;
        const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
        let dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) return;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = r - d;
          pos.x += (dx / d) * push;
          pos.z += (dz / d) * push;
        } else {
          // centre inside the box: push out along the smallest axis
          const l = pos.x - b.minX, rr = b.maxX - pos.x, t = pos.z - b.minZ, bt = b.maxZ - pos.z;
          const m = Math.min(l, rr, t, bt);
          if (m === l) pos.x = b.minX - r;
          else if (m === rr) pos.x = b.maxX + r;
          else if (m === t) pos.z = b.minZ - r;
          else pos.z = b.maxZ + r;
        }
        moved = hit = true;
      });
      if (!moved) break;
    }
    return hit;
  }

  /** Floor height under a point given current feet y. Returns {y, zone}. */
  floorAt(x, z, footY) {
    let y = this.level ? this.level.floorY ?? 0 : 0;
    let zone = null;
    let best = -Infinity;
    this.zones.each(x, z, x, z, (zn) => {
      if (x < zn.minX || x > zn.maxX || z < zn.minZ || z > zn.maxZ) return;
      let h;
      if (zn.type === 'ramp') {
        const t = zn.axis === 'x' ? (x - zn.minX) / (zn.maxX - zn.minX) : (z - zn.minZ) / (zn.maxZ - zn.minZ);
        const tt = zn.dir < 0 ? 1 - t : t;
        h = zn.y0 + (zn.y1 - zn.y0) * (zn.steps ? Math.floor(tt * zn.steps + 0.5) / zn.steps : tt);
        if (h > footY + 0.45) return; // too high to step onto
      } else if (zn.type === 'hole') {
        h = -1000;
        if (best === -Infinity || zn.priority) {
          best = h;
          zone = zn;
        }
        return;
      } else if (zn.type === 'floor') {
        h = zn.y;
        if (h > footY + 0.45) return;
      } else {
        if (!zone) zone = zn;
        return;
      }
      if (h > best) {
        best = h;
        zone = zn;
      }
    });
    if (zone && zone.type === 'hole') return { y: -1000, zone };
    if (best > -Infinity) y = best;
    return { y, zone };
  }

  /** All zones (of any type) containing a point. */
  zonesAt(x, z, out = []) {
    out.length = 0;
    this.zones.each(x, z, x, z, (zn) => {
      if (x >= zn.minX && x <= zn.maxX && z >= zn.minZ && z <= zn.maxZ) out.push(zn);
    });
    return out;
  }

  /** 2D ray against colliders at height y. Returns distance (<= max). */
  raycast(x, z, dx, dz, max = 40, y = 1.4) {
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    let best = max;
    const steps = Math.ceil(max / (HC * 0.5));
    const s = ++this.colliders.stamp;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * max;
      if (t > best + HC) break;
      const px = x + dx * t, pz = z + dz * t;
      const a = this.colliders.map.get(this.colliders._k(Math.floor(px / HC), Math.floor(pz / HC)));
      if (!a) continue;
      for (const b of a) {
        if (b._hs === s) continue;
        b._hs = s;
        if (b.disabled || y < b.minY || y > b.maxY || b.ray === false) continue;
        const h = rayBox(x, z, dx, dz, b);
        if (h >= 0 && h < best) best = h;
      }
    }
    return best;
  }

  lineOfSight(ax, az, bx, bz, y = 1.4) {
    const d = Math.hypot(bx - ax, bz - az);
    return this.raycast(ax, az, bx - ax, bz - az, d, y) >= d - 0.05;
  }

  /** Is a point inside any collider? */
  blockedAt(x, z, r = 0.3, y = 1) {
    let hit = false;
    this.colliders.each(x - r, z - r, x + r, z + r, (b) => {
      if (b.disabled || y < b.minY || y > b.maxY) return;
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) {
        hit = true;
        return false;
      }
    });
    return hit;
  }
}

function rayBox(x, z, dx, dz, b) {
  let tmin = 0, tmax = 1e9;
  if (Math.abs(dx) < 1e-9) {
    if (x < b.minX || x > b.maxX) return -1;
  } else {
    let t1 = (b.minX - x) / dx, t2 = (b.maxX - x) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (Math.abs(dz) < 1e-9) {
    if (z < b.minZ || z > b.maxZ) return -1;
  } else {
    let t1 = (b.minZ - z) / dz, t2 = (b.maxZ - z) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  return tmin <= tmax ? tmin : -1;
}

/** Helper to create a box record. */
export function box(minX, minY, minZ, maxX, maxY, maxZ, opts = {}) {
  return { minX, minY, minZ, maxX, maxY, maxZ, occ: opts.occ ?? true, col: opts.col ?? true, ray: opts.ray ?? true, ...opts };
}
