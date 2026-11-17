import * as THREE from 'three';
import { worldMaterial } from '../gfx/materials.js';
import { tex } from '../gfx/textures.js';
import { box } from '../world/world.js';

// Small, rare "almost normal" props. Mostly static geometry baked into the chunk.

let shared = null;
export function propMaterials() {
  if (shared) return shared;
  shared = {
    p_fabric: worldMaterial({ map: tex('fabric'), tile: [1, 1] }),
    p_metal: worldMaterial({ map: tex('metal'), tile: [1, 1] }),
    p_rust: worldMaterial({ map: tex('rust'), tile: [1.5, 1.5] }),
    p_wood: worldMaterial({ map: tex('wood'), tile: [1, 1] }),
    p_plaster: worldMaterial({ map: tex('plaster'), tile: [1, 1] }),
    p_white: worldMaterial({ map: tex('appliance'), tile: [1, 1] }),
    p_dark: worldMaterial({ map: tex('fabric'), tile: [1, 1], tint: [0.18, 0.17, 0.16] }),
    p_black: worldMaterial({ map: tex('black'), tile: [1, 1] }),
    p_void: worldMaterial({ map: tex('black'), unlit: true, emissive: [0, 0, 0] }),
    p_wetsign: worldMaterial({ map: tex('wetsign'), tile: [1, 1], side: THREE.DoubleSide }),
    p_paper: worldMaterial({ map: tex('paper'), tile: [1, 1] }),
    p_crate: worldMaterial({ map: tex('crate'), tile: [1, 1] }),
    p_exit: worldMaterial({ map: tex('exitsign'), unlit: true, emissive: [1.6, 1.6, 1.6] }),
    p_glass: worldMaterial({ map: tex('black'), tile: [1, 1], emissive: [0, 0, 0] }),
    p_whitevoid: worldMaterial({ map: tex('white'), unlit: true, emissive: [4.5, 4.5, 4.4] }),
    p_cubicle: worldMaterial({ map: tex('cubicle'), tile: [1.2, 1.2] }),
    p_monitor: worldMaterial({ map: tex('monitor'), tile: [1, 1] }),
    p_couch: worldMaterial({ map: tex('couch'), tile: [1, 1] }),
    p_clock: worldMaterial({ map: tex('clockface'), tile: [1, 1] }),
    p_grate: worldMaterial({ map: tex('grate'), tile: [1, 1] }),
  };
  return shared;
}

/** Rotate local rect (around cx,cz) by quarter turns and emit a box. */
export function rbox(mb, key, cx, cz, rot, lx0, y0, lz0, lx1, y1, lz1, opts = {}) {
  const r = ((rot % 4) + 4) % 4;
  let a, b, c, d;
  if (r === 0) [a, b, c, d] = [lx0, lz0, lx1, lz1];
  else if (r === 1) [a, b, c, d] = [-lz1, lx0, -lz0, lx1];
  else if (r === 2) [a, b, c, d] = [-lx1, -lz1, -lx0, -lz0];
  else [a, b, c, d] = [lz0, -lx1, lz1, -lx0];
  const x0 = cx + Math.min(a, c), x1 = cx + Math.max(a, c);
  const z0 = cz + Math.min(b, d), z1 = cz + Math.max(b, d);
  mb.box(key, x0, y0, z0, x1, y1, z1, { step: 2, vstep: 3, faces: opts.faces || 'xXzZY', ...opts });
  return box(x0, y0, z0, x1, y1, z1, { occ: false });
}

export function rpt(cx, cz, rot, lx, lz) {
  const r = ((rot % 4) + 4) % 4;
  if (r === 0) return [cx + lx, cz + lz];
  if (r === 1) return [cx - lz, cz + lx];
  if (r === 2) return [cx - lx, cz - lz];
  return [cx + lz, cz - lx];
}

export function officeChair(mb, x, z, rot, out) {
  out.push(rbox(mb, 'p_fabric', x, z, rot, -0.25, 0.42, -0.25, 0.25, 0.5, 0.25));
  rbox(mb, 'p_fabric', x, z, rot, -0.23, 0.55, 0.2, 0.23, 1.0, 0.27);
  rbox(mb, 'p_metal', x, z, rot, -0.03, 0.08, -0.03, 0.03, 0.42, 0.03);
  rbox(mb, 'p_metal', x, z, rot, -0.3, 0.04, -0.03, 0.3, 0.08, 0.03);
  rbox(mb, 'p_metal', x, z, rot, -0.03, 0.04, -0.3, 0.03, 0.08, 0.3);
  rbox(mb, 'p_metal', x, z, rot, -0.02, 0.5, 0.21, 0.02, 0.6, 0.25);
}

export function wetSign(mb, x, z, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const P = (lx, y, lz) => [x + lx * c - lz * s, y, z + lx * s + lz * c];
  const w = 0.15, h = 0.62, sp = 0.16;
  // two slanted boards forming an A-frame
  for (const side of [-1, 1]) {
    const b0 = P(-w, 0, side * sp), b1 = P(w, 0, side * sp), t1 = P(w, h, side * 0.01), t0 = P(-w, h, side * 0.01);
    const nx = side * s * 0.9, nz = side * c * 0.9;
    if (side > 0) mb.quad('p_wetsign', b0, b1, t1, t0, [-nx, 0.3, nz], [[0, 0], [1, 0], [1, 1], [0, 1]], { kind: 3 });
    else mb.quad('p_wetsign', b1, b0, t0, t1, [nx, 0.3, -nz], [[0, 0], [1, 0], [1, 1], [0, 1]], { kind: 3 });
  }
}

/** Wall-mounted thing helpers: position on a wall face given cell edge. */
export function outlet(mb, x, y, z, nx, nz) {
  const w = 0.07, h = 0.11, d = 0.02;
  if (Math.abs(nx) > 0.5) mb.box('p_white', x - (nx < 0 ? d : 0), y - h / 2, z - w / 2, x + (nx > 0 ? d : 0), y + h / 2, z + w / 2, { faces: nx > 0 ? 'XzZ' : 'xzZ' });
  else mb.box('p_white', x - w / 2, y - h / 2, z - (nz < 0 ? d : 0), x + w / 2, y + h / 2, z + (nz > 0 ? d : 0), { faces: nz > 0 ? 'ZxX' : 'zxX' });
  // the two slots
  const sx = Math.abs(nx) > 0.5 ? x + nx * (d + 0.001) : x;
  const sz = Math.abs(nz) > 0.5 ? z + nz * (d + 0.001) : z;
  for (const dy of [-0.025, 0.025]) {
    const yy = y + dy;
    if (Math.abs(nx) > 0.5) mb.quad('p_black', [sx, yy - 0.008, sz - 0.012 * nx], [sx, yy - 0.008, sz + 0.012 * nx], [sx, yy + 0.008, sz + 0.012 * nx], [sx, yy + 0.008, sz - 0.012 * nx], [nx, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], { kind: 3 });
    else mb.quad('p_black', [sx + 0.012 * nz, yy - 0.008, sz], [sx - 0.012 * nz, yy - 0.008, sz], [sx - 0.012 * nz, yy + 0.008, sz], [sx + 0.012 * nz, yy + 0.008, sz], [0, 0, nz], [[0, 0], [1, 0], [1, 1], [0, 1]], { kind: 3 });
  }
}

/** A flat quad mounted on a wall face. key: material, (x,z) on wall surface, normal nx/nz. */
export function wallQuad(mb, key, x, y0, z, w, h, nx, nz, off = 0.005, uv = null) {
  const px = x + nx * off, pz = z + nz * off;
  const tx = -nz, tz = nx; // tangent
  const a = [px - tx * w / 2, y0, pz - tz * w / 2], b = [px + tx * w / 2, y0, pz + tz * w / 2];
  const c = [b[0], y0 + h, b[2]], d = [a[0], y0 + h, a[2]];
  mb.quad(key, a, b, c, d, [nx, 0, nz], uv || [[0, 0], [1, 0], [1, 1], [0, 1]], { kind: 3 });
}

export function windowToNowhere(mb, x, z, nx, nz, keyGlass = 'p_glass') {
  // frame + dark glass, set into the wall surface
  wallQuad(mb, keyGlass, x, 1.0, z, 0.9, 1.0, nx, nz, 0.01);
  const tx = -nz, tz = nx;
  const fr = (ox, y0, w, h) => {
    const cx = x + tx * ox + nx * 0.03, cz = z + tz * ox + nz * 0.03;
    const hw = Math.abs(tx) > 0.5 ? w / 2 : 0.03, hd = Math.abs(tz) > 0.5 ? w / 2 : 0.03;
    mb.box('p_white', cx - hw, y0, cz - hd, cx + hw, y0 + h, cz + hd, { faces: 'xXzZYy' });
  };
  fr(0, 0.95, 1.04, 0.06);
  fr(0, 2.0, 1.04, 0.06);
  fr(-0.49, 1.0, 0.06, 1.0);
  fr(0.49, 1.0, 0.06, 1.0);
  fr(0, 1.0, 0.03, 1.0);
}

export function phone(mb, x, z, nx, nz) {
  const tx = -nz, tz = nx;
  const bx = x + nx * 0.05, bz = z + nz * 0.05;
  mb.box('p_white', bx - 0.08 - Math.abs(nx) * 0.0, 1.25, bz - 0.08, bx + 0.08, 1.48, bz + 0.08, { faces: 'xXzZYy' });
  // handset hanging off the hook
  const hx = x + nx * 0.12 + tx * 0.05, hz = z + nz * 0.12 + tz * 0.05;
  mb.box('p_white', hx - 0.03, 0.35, hz - 0.03, hx + 0.03, 0.55, hz + 0.03, { faces: 'xXzZYy' });
  mb.box('p_black', hx - 0.004, 0.55, hz - 0.004, hx + 0.004, 1.25, hz + 0.004, { faces: 'xXzZ' });
}

export function shoe(mb, x, z, rot) {
  rbox(mb, 'p_dark', x, z, rot, -0.05, 0, -0.13, 0.05, 0.07, 0.13);
  rbox(mb, 'p_dark', x, z, rot, -0.045, 0.07, 0.03, 0.045, 0.12, 0.13);
}

export function vent(mb, x, y, z, nx, nz) {
  wallQuad(mb, 'p_grate', x, y, z, 0.5, 0.3, nx, nz, 0.01);
}

/** Simple desk */
export function desk(mb, x, z, rot, out) {
  out.push(rbox(mb, 'p_wood', x, z, rot, -0.7, 0.72, -0.35, 0.7, 0.76, 0.35));
  rbox(mb, 'p_metal', x, z, rot, -0.68, 0, -0.33, -0.64, 0.72, 0.33);
  rbox(mb, 'p_metal', x, z, rot, 0.64, 0, -0.33, 0.68, 0.72, 0.33);
  rbox(mb, 'p_wood', x, z, rot, -0.66, 0.3, 0.3, 0.66, 0.72, 0.33);
}

export function crate(mb, x, z, rot, s, out) {
  out.push(rbox(mb, 'p_crate', x, z, rot, -s / 2, 0, -s / 2, s / 2, s, s / 2, { faces: 'xXzZY' }));
}

/** Stairs rising along local +z, ending in the ceiling. Returns zones + boxes. */
export function stairsToCeiling(mb, x, z, rot, ceil, key = 'p_wood') {
  const zones = [], boxes = [];
  const steps = 9, rise = (ceil - 0.2) / steps, run = 0.32, w = 0.55;
  for (let i = 0; i < steps; i++) {
    const y = (i + 1) * rise;
    const b = rbox(mb, key, x, z, rot, -w, 0, i * run, w, y, (i + 1) * run, { faces: 'xXzY' });
    // steps you can climb (low ones) become floor; upper ones collide (no headroom)
    if (y < ceil - 1.6) {
      zones.push({ ...b, type: 'floor', y });
    } else {
      boxes.push({ ...b, occ: false, col: true, minY: y - 0.3, maxY: ceil });
    }
  }
  return { zones, boxes };
}

// ---------- dynamic objects (pickups, doors): separate meshes with sampled light ----------
const geoCache = {};
function itemGeo(type) {
  if (geoCache[type]) return geoCache[type];
  let g;
  if (type === 'almond') g = new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10);
  else if (type === 'battery') g = new THREE.BoxGeometry(0.06, 0.1, 0.04);
  else if (type === 'note') g = new THREE.PlaneGeometry(0.21, 0.28).rotateX(-Math.PI / 2);
  else g = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  geoCache[type] = g;
  return g;
}

export function itemMesh(type, lightSample) {
  const map = type === 'almond' ? tex('label') : type === 'battery' ? tex('battery') : tex('paper');
  const mat = worldMaterial({ map, baked: false, tile: [1, 1], emissive: type === 'note' ? [0.02, 0.02, 0.02] : [0.06, 0.06, 0.05] });
  mat.uniforms.uObjLight.value.copy(lightSample).multiplyScalar(0.9);
  const m = new THREE.Mesh(itemGeo(type), mat);
  return m;
}

export function dynMat(map, lightSample, opts = {}) {
  const mat = worldMaterial({ map, baked: false, tile: [1, 1], ...opts });
  if (lightSample) mat.uniforms.uObjLight.value.copy(lightSample);
  return mat;
}

/** A static door slab set flush into a wall face. */
export function doorSlab(mb, key, x, z, nx, nz, w = 0.9, h = 2.05, frameKey = 'p_wood') {
  const tx = -nz, tz = nx;
  const px = x + nx * 0.02, pz = z + nz * 0.02;
  const hw = Math.abs(tx) > 0.5 ? w / 2 : 0.03, hd = Math.abs(tz) > 0.5 ? w / 2 : 0.03;
  mb.box(key, px - hw, 0, pz - hd, px + hw, h, pz + hd, { faces: 'xXzZY', step: 0.5, vstep: 0.7 });
  const fr = (o, y0, ww, hh) => {
    const cx = x + tx * o + nx * 0.04, cz = z + tz * o + nz * 0.04;
    const a = Math.abs(tx) > 0.5 ? ww / 2 : 0.04, b = Math.abs(tz) > 0.5 ? ww / 2 : 0.04;
    mb.box(frameKey, cx - a, y0, cz - b, cx + a, y0 + hh, cz + b, { faces: 'xXzZYy' });
  };
  fr(-w / 2 - 0.05, 0, 0.1, h + 0.08);
  fr(w / 2 + 0.05, 0, 0.1, h + 0.08);
  fr(0, h, w + 0.2, 0.08);
  // handle
  const hx = x + tx * (w / 2 - 0.12) + nx * 0.07, hz = z + tz * (w / 2 - 0.12) + nz * 0.07;
  mb.box('p_metal', hx - 0.03, 0.98, hz - 0.03, hx + 0.03, 1.04, hz + 0.03, { faces: 'xXzZYy' });
}

/** Balloons tied to something: separate meshes (a few spheres). */
export function balloons(extra, x, y, z, n, rng, light) {
  const cols = [[0.9, 0.2, 0.3], [0.2, 0.4, 0.9], [0.95, 0.75, 0.15], [0.3, 0.8, 0.45], [0.7, 0.3, 0.85]];
  const geo = balloons._g || (balloons._g = new THREE.SphereGeometry(0.17, 12, 10).scale(1, 1.18, 1));
  for (let i = 0; i < n; i++) {
    const c = cols[Math.floor(rng.next() * cols.length)];
    const mat = worldMaterial({ map: tex('white'), baked: false, tint: c, emissive: [c[0] * 0.08, c[1] * 0.08, c[2] * 0.08] });
    mat.uniforms.uObjLight.value.copy(light);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x + (rng.next() - 0.5) * 0.4, y + rng.next() * 0.4, z + (rng.next() - 0.5) * 0.4);
    m.userData.bob = rng.next() * 6;
    extra.push(m);
  }
}
