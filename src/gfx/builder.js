import * as THREE from 'three';
import { lightFalloff } from './lights.js';

// MeshBuilder accumulates world-space geometry per material key. On finalize the
// Baker computes per-vertex lighting: the 8 strongest lights (with 2D occlusion
// against wall boxes) plus an ambient-occlusion term.

class Group {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.emit = [];
    this.smp = []; // light sample points
    this.kind = []; // 0 floor, 1 ceiling, 2 wall, 3 prop
    this.idx = [];
    this.lit = true;
  }
  get count() {
    return this.pos.length / 3;
  }
}

export class MeshBuilder {
  constructor() {
    this.groups = new Map();
  }

  g(key) {
    let g = this.groups.get(key);
    if (!g) this.groups.set(key, (g = new Group()));
    return g;
  }

  _vert(g, x, y, z, nx, ny, nz, u, v, col, emit, sx, sy, sz, kind) {
    g.pos.push(x, y, z);
    g.nrm.push(nx, ny, nz);
    g.uv.push(u, v);
    g.col.push(col[0], col[1], col[2]);
    g.emit.push(emit);
    g.smp.push(sx, sy, sz);
    g.kind.push(kind);
  }

  /**
   * Bilinear subdivided quad. p0..p3 counter-clockwise seen from the normal side.
   * uvs: [[u,v] x4]. opts: su, sv (subdivisions), col, emit, kind, inset
   */
  quad(key, p0, p1, p2, p3, n, uvs, opts = {}) {
    const g = this.g(key);
    const su = opts.su || 1, sv = opts.sv || 1;
    const col = opts.col || [1, 1, 1];
    const emit = opts.emit || 0;
    const kind = opts.kind ?? 3;
    const inset = opts.inset ?? 0.12;
    const base = g.count;
    const cx = (p0[0] + p1[0] + p2[0] + p3[0]) / 4;
    const cy = (p0[1] + p1[1] + p2[1] + p3[1]) / 4;
    const cz = (p0[2] + p1[2] + p2[2] + p3[2]) / 4;
    for (let j = 0; j <= sv; j++) {
      const t = j / sv;
      for (let i = 0; i <= su; i++) {
        const s = i / su;
        const w0 = (1 - s) * (1 - t), w1 = s * (1 - t), w2 = s * t, w3 = (1 - s) * t;
        const x = p0[0] * w0 + p1[0] * w1 + p2[0] * w2 + p3[0] * w3;
        const y = p0[1] * w0 + p1[1] * w1 + p2[1] * w2 + p3[1] * w3;
        const z = p0[2] * w0 + p1[2] * w1 + p2[2] * w2 + p3[2] * w3;
        const u = uvs[0][0] * w0 + uvs[1][0] * w1 + uvs[2][0] * w2 + uvs[3][0] * w3;
        const v = uvs[0][1] * w0 + uvs[1][1] * w1 + uvs[2][1] * w2 + uvs[3][1] * w3;
        // sample point pulled toward the quad centre and off the surface
        let dx = cx - x, dy = cy - y, dz = cz - z;
        const dl = Math.hypot(dx, dy, dz) || 1;
        const k = Math.min(inset, dl) / dl;
        this._vert(g, x, y, z, n[0], n[1], n[2], u, v, col, emit, x + dx * k + n[0] * 0.06, y + dy * k + n[1] * 0.06, z + dz * k + n[2] * 0.06, kind);
      }
    }
    for (let j = 0; j < sv; j++) {
      for (let i = 0; i < su; i++) {
        const a = base + j * (su + 1) + i;
        const b = a + 1, c = a + su + 2, d = a + su + 1;
        g.idx.push(a, b, c, a, c, d);
      }
    }
  }

  /** Horizontal rectangle (floor if up, ceiling otherwise), UV in world metres. */
  flat(key, x0, z0, x1, z1, y, up = true, opts = {}) {
    const step = opts.step || 1;
    const su = Math.max(1, Math.round((x1 - x0) / step)), sv = Math.max(1, Math.round((z1 - z0) / step));
    const o = { ...opts, su, sv, kind: opts.kind ?? (up ? 0 : 1) };
    if (up) {
      this.quad(key, [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [[x0, z1], [x1, z1], [x1, z0], [x0, z0]], o);
    } else {
      this.quad(key, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], o);
    }
  }

  /** Vertical face spanning a horizontal segment, facing normal (nx,nz). */
  vface(key, ax, az, bx, bz, y0, y1, nx, nz, opts = {}) {
    const len = Math.hypot(bx - ax, bz - az);
    const su = Math.max(1, Math.round(len / (opts.step || 1)));
    const sv = opts.sv || Math.max(1, Math.round((y1 - y0) / (opts.vstep || 0.9)));
    // u along the face in world metres (stable across adjacent faces)
    const ua = Math.abs(nx) > 0.5 ? az * -Math.sign(nx) : ax * Math.sign(nz || 1);
    const ub = Math.abs(nx) > 0.5 ? bz * -Math.sign(nx) : bx * Math.sign(nz || 1);
    this.quad(key, [ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [nx, 0, nz], [[ua, y0], [ub, y0], [ub, y1], [ua, y1]], {
      ...opts,
      su,
      sv,
      kind: opts.kind ?? 2,
    });
  }

  /** Axis-aligned box. faces: string of which faces to emit: 'xXzZyY' (x = -X face, X = +X ...). */
  box(key, x0, y0, z0, x1, y1, z1, opts = {}) {
    const f = opts.faces || 'xXzZY';
    const o = { step: opts.step || 1, vstep: opts.vstep || 0.9, ...opts };
    if (f.includes('X')) this.vface(key, x1, z1, x1, z0, y0, y1, 1, 0, o);
    if (f.includes('x')) this.vface(key, x0, z0, x0, z1, y0, y1, -1, 0, o);
    if (f.includes('Z')) this.vface(key, x0, z1, x1, z1, y0, y1, 0, 1, o);
    if (f.includes('z')) this.vface(key, x1, z0, x0, z0, y0, y1, 0, -1, o);
    if (f.includes('Y')) this.flat(key, x0, z0, x1, z1, y1, true, { ...o, kind: opts.kind ?? 3, step: o.topStep || 2 });
    if (f.includes('y')) this.flat(key, x0, z0, x1, z1, y0, false, { ...o, kind: opts.kind ?? 3, step: o.topStep || 2 });
  }

  /** Cylinder along an axis. */
  cylinder(key, cx, cy, cz, axis, radius, length, segs = 8, opts = {}) {
    const g = this.g(key);
    const col = opts.col || [1, 1, 1];
    const lsegs = Math.max(1, Math.round(length / (opts.step || 1.5)));
    const base = g.count;
    for (let j = 0; j <= lsegs; j++) {
      const t = j / lsegs - 0.5;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        let x, y, z, nx, ny, nz;
        if (axis === 'x') {
          x = cx + t * length; y = cy + ca * radius; z = cz + sa * radius; nx = 0; ny = ca; nz = sa;
        } else if (axis === 'z') {
          x = cx + ca * radius; y = cy + sa * radius; z = cz + t * length; nx = ca; ny = sa; nz = 0;
        } else {
          x = cx + ca * radius; y = cy + t * length; z = cz + sa * radius; nx = ca; ny = 0; nz = sa;
        }
        this._vert(g, x, y, z, nx, ny, nz, (i / segs) * radius * 6.28, t * length, col, 0, x + nx * 0.1, y + ny * 0.1, z + nz * 0.1, 3);
      }
    }
    for (let j = 0; j < lsegs; j++) {
      for (let i = 0; i < segs; i++) {
        const a = base + j * (segs + 1) + i;
        const b = a + 1, c = a + segs + 2, d = a + segs + 1;
        if (axis === 'z') g.idx.push(a, d, c, a, c, b);
        else g.idx.push(a, b, c, a, c, d);
      }
    }
  }

  /** Build THREE meshes. materials: key -> material. baker may be null (unlit). */
  finalize(materials, baker) {
    const group = new THREE.Group();
    for (const [key, g] of this.groups) {
      if (!g.count) continue;
      const mat = materials[key];
      if (!mat) {
        console.warn('missing material', key);
        continue;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      geo.setAttribute('aCol', new THREE.Float32BufferAttribute(g.col, 3));
      const n = g.count;
      const lid0 = new Float32Array(n * 4), lid1 = new Float32Array(n * 4);
      const lw0 = new Float32Array(n * 4), lw1 = new Float32Array(n * 4);
      const amb = new Float32Array(n * 3);
      if (baker) baker.bake(g, lid0, lid1, lw0, lw1, amb);
      else amb.fill(1);
      geo.setAttribute('aLid0', new THREE.BufferAttribute(lid0, 4));
      geo.setAttribute('aLid1', new THREE.BufferAttribute(lid1, 4));
      geo.setAttribute('aLw0', new THREE.BufferAttribute(lw0, 4));
      geo.setAttribute('aLw1', new THREE.BufferAttribute(lw1, 4));
      geo.setAttribute('aAmb', new THREE.BufferAttribute(amb, 3));
      geo.setAttribute('aEmit', new THREE.Float32BufferAttribute(g.emit, 1));
      geo.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(g.idx, 1) : new THREE.Uint16BufferAttribute(g.idx, 1));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.userData.key = key;
      group.add(mesh);
    }
    return group;
  }
}

/** Spatial hash of occluding boxes for 2D segment tests. */
export class Occluder {
  constructor(boxes, cell = 4) {
    this.cell = cell;
    this.map = new Map();
    this.boxes = [];
    this.stamp = 0;
    for (const b of boxes) {
      if (!b.occ) continue;
      b._s = 0;
      this.boxes.push(b);
      const x0 = Math.floor(b.minX / cell), x1 = Math.floor(b.maxX / cell);
      const z0 = Math.floor(b.minZ / cell), z1 = Math.floor(b.maxZ / cell);
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          const k = x * 92837111 + z * 689287499;
          let a = this.map.get(k);
          if (!a) this.map.set(k, (a = []));
          a.push(b);
        }
    }
  }

  /** True if segment (x0,z0)->(x1,z1) at height y passes through an occluder. */
  blocked(x0, z0, x1, z1, y = 1.5) {
    const c = this.cell;
    const dx = x1 - x0, dz = z1 - z0;
    const stamp = ++this.stamp;
    // walk hash cells along the segment (conservative: step by half a cell)
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / (c * 0.5)));
    let lastK = null;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = x0 + dx * t, pz = z0 + dz * t;
      const k = Math.floor(px / c) * 92837111 + Math.floor(pz / c) * 689287499;
      if (k === lastK) continue;
      lastK = k;
      const arr = this.map.get(k);
      if (!arr) continue;
      for (const b of arr) {
        if (b._s === stamp) continue;
        b._s = stamp;
        if (y < b.minY || y > b.maxY) continue;
        if (segBox(x0, z0, dx, dz, b)) return true;
      }
    }
    return false;
  }

  /** Distance from a point to the nearest occluder box edge (2D), capped. */
  nearest(x, z, y, cap = 1.2) {
    const c = this.cell;
    let best = cap;
    const gx0 = Math.floor((x - cap) / c), gx1 = Math.floor((x + cap) / c);
    const gz0 = Math.floor((z - cap) / c), gz1 = Math.floor((z + cap) / c);
    for (let gx = gx0; gx <= gx1; gx++)
      for (let gz = gz0; gz <= gz1; gz++) {
        const arr = this.map.get(gx * 92837111 + gz * 689287499);
        if (!arr) continue;
        for (const b of arr) {
          if (y < b.minY - 0.3 || y > b.maxY + 0.3) continue;
          const ddx = Math.max(b.minX - x, 0, x - b.maxX);
          const ddz = Math.max(b.minZ - z, 0, z - b.maxZ);
          const d = Math.hypot(ddx, ddz);
          if (d < best) best = d;
        }
      }
    return best;
  }
}

function segBox(x0, z0, dx, dz, b) {
  let tmin = 0.0001, tmax = 0.9999;
  if (Math.abs(dx) < 1e-9) {
    if (x0 < b.minX || x0 > b.maxX) return false;
  } else {
    let t1 = (b.minX - x0) / dx, t2 = (b.maxX - x0) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (z0 < b.minZ || z0 > b.maxZ) return false;
  } else {
    let t1 = (b.minZ - z0) / dz, t2 = (b.maxZ - z0) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

/** Bakes light weights per vertex. lights: [{x,y,z,r,slot}] */
export class Baker {
  constructor(lights, occluder, { floorY = 0, ceilY = 2.7, aoStrength = 1, wrap = 0.35, ceilAt = null } = {}) {
    this.occ = occluder;
    this.ceilAt = ceilAt;
    this.floorY = floorY;
    this.ceilY = ceilY;
    this.aoStrength = aoStrength;
    this.wrap = wrap;
    // light hash
    this.cell = 6;
    this.map = new Map();
    for (const l of lights) {
      if (!l.slot) continue;
      const k = Math.floor(l.x / 6) * 7919 + Math.floor(l.z / 6) * 104729;
      let a = this.map.get(k);
      if (!a) this.map.set(k, (a = []));
      a.push(l);
    }
  }

  bake(g, lid0, lid1, lw0, lw1, amb) {
    const n = g.count;
    const ids = new Int32Array(8), ws = new Float32Array(8);
    const wrap = this.wrap;
    for (let v = 0; v < n; v++) {
      const px = g.pos[v * 3], py = g.pos[v * 3 + 1], pz = g.pos[v * 3 + 2];
      const nx = g.nrm[v * 3], ny = g.nrm[v * 3 + 1], nz = g.nrm[v * 3 + 2];
      const sx = g.smp[v * 3], sy = g.smp[v * 3 + 1], sz = g.smp[v * 3 + 2];
      let cnt = 0;
      ids.fill(0);
      ws.fill(0);
      const gx0 = Math.floor((sx - 9) / 6), gx1 = Math.floor((sx + 9) / 6);
      const gz0 = Math.floor((sz - 9) / 6), gz1 = Math.floor((sz + 9) / 6);
      for (let gx = gx0; gx <= gx1; gx++)
        for (let gz = gz0; gz <= gz1; gz++) {
          const arr = this.map.get(gx * 7919 + gz * 104729);
          if (!arr) continue;
          for (const l of arr) {
            const dx = l.x - px, dy = l.y - py, dz = l.z - pz;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d >= l.r) continue;
            if (l.band && (py < l.band[0] || py > l.band[1])) continue;
            let ndl = (dx * nx + dy * ny + dz * nz) / (d || 1);
            ndl = Math.max(0, ndl * (1 - wrap) + wrap);
            let w = lightFalloff(d, l.r) * ndl * (l.gain ?? 1);
            if (w < 0.004) continue;
            if (this.occ && this.occ.blocked(sx, sz, l.x, l.z, Math.min(sy, l.y - 0.2))) continue;
            // insert into top-8
            if (cnt < 8) {
              ids[cnt] = l.slot;
              ws[cnt] = w;
              cnt++;
            } else {
              let mi = 0;
              for (let i = 1; i < 8; i++) if (ws[i] < ws[mi]) mi = i;
              if (w > ws[mi]) {
                ids[mi] = l.slot;
                ws[mi] = w;
              }
            }
          }
        }
      for (let i = 0; i < 4; i++) {
        lid0[v * 4 + i] = ids[i];
        lw0[v * 4 + i] = ws[i];
        lid1[v * 4 + i] = ids[i + 4];
        lw1[v * 4 + i] = ws[i + 4];
      }
      // ambient occlusion
      let ao = 1;
      const kind = g.kind[v];
      if (this.occ && this.aoStrength > 0) {
        if (kind === 0 || kind === 1) {
          const dist = this.occ.nearest(sx, sz, kind === 0 ? this.floorY + 0.3 : py - 0.3, 1.0);
          const s = Math.min(1, dist / 0.9);
          ao = kind === 0 ? 0.5 + 0.5 * s * s * (3 - 2 * s) : 0.75 + 0.25 * s;
        } else if (kind === 2) {
          const h = py - this.floorY;
          const top = Math.max(0, (this.ceilAt ? this.ceilAt(sx, sz) : this.ceilY) - py);
          ao = (0.55 + 0.45 * Math.min(1, h / 0.6)) * (0.8 + 0.2 * Math.min(1, top / 0.5));
        }
        ao = 1 - (1 - ao) * this.aoStrength;
      }
      if (ao < 1) {
        for (let i = 0; i < 4; i++) {
          lw0[v * 4 + i] *= ao;
          lw1[v * 4 + i] *= ao;
        }
      }
      amb[v * 3] = amb[v * 3 + 1] = amb[v * 3 + 2] = ao;
    }
  }
}
