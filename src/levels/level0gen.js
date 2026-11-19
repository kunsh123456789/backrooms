// Level 0 room generation.
//
// Ideas taken from looking at how others approach this:
//  - The Backrooms wiki describes Level 0 as "segmented rooms" where no two
//    areas are alike, like the back rooms of a furniture store, with rare
//    landmark rooms (the small manila room, dim red-wallpaper rooms).
//  - Floor-plan generators split a footprint with a squarified-treemap-like
//    recursive split, then join neighbouring rooms with doors.
//  - Other Backrooms generators mix maze algorithms ("growing tree") with
//    pools of room types and biome percentages.
//  - Level design writing: empty space works through contrast, so huge halls
//    should sit next to cramped rooms and narrow corridors.
//
// So each chunk belongs to a "district" chosen from smooth noise (districts
// span several chunks), and each district partitions the chunk into rooms
// with its own size distribution, door style, ceiling heights and lighting.

import { RNG, fbm2, hashf } from '../core/math.js';
import { OPEN, WALL, KEEP } from './grid.js';

export const HMAX = 4.4; // walls are built this tall; lower rooms hide the rest above their ceiling

export const ROOM = { HALL: 'hall', ROOM: 'room', SMALL: 'small', CORRIDOR: 'corridor', MAZE: 'maze' };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Pick the district for a chunk. Smooth noise so districts cover several chunks. */
export function districtOf(seed, cx, cz) {
  if (hashf(seed, cx, cz, 404) < 0.08) return 'longhall';
  const n = fbm2(cx * 0.31 + 7.3, cz * 0.31 - 2.1, seed + 303, 2);
  const m = hashf(seed, cx, cz, 405);
  // thresholds set from the noise's measured percentiles:
  // ~27% big halls / pillar forests, ~22% offices, ~13% mazes, ~38% mixed rooms
  if (n < 0.383) return m < 0.55 ? 'halls' : 'pillared';
  if (n < 0.48) return 'offices';
  if (n < 0.54) return 'maze';
  return 'mixed';
}

/** Recursive split into rooms; target areas drawn per split so sizes vary. */
function partition(rng, x0, z0, x1, z1, targetFn, minSide, out) {
  const w = x1 - x0, h = z1 - z0;
  const target = targetFn();
  const canV = w >= minSide * 2, canH = h >= minSide * 2;
  if (w * h <= target * 1.25 || (!canV && !canH)) {
    out.push({ x: x0, z: z0, w, h });
    return;
  }
  let vertical = w > h * 1.15 ? true : h > w * 1.15 ? false : rng.chance(0.5);
  if (vertical && !canV) vertical = false;
  if (!vertical && !canH) vertical = true;
  const len = vertical ? w : h;
  const cut = clamp(Math.round(len * rng.range(0.3, 0.7)), minSide, len - minSide);
  if (vertical) {
    partition(rng, x0, z0, x0 + cut, z1, targetFn, minSide, out);
    partition(rng, x0 + cut, z0, x1, z1, targetFn, minSide, out);
  } else {
    partition(rng, x0, z0, x1, z0 + cut, targetFn, minSide, out);
    partition(rng, x0, z0 + cut, x1, z1, targetFn, minSide, out);
  }
}

function pickWeighted(rng, list) {
  let s = 0;
  for (const [, w] of list) s += w;
  let r = rng.next() * s;
  for (const [v, w] of list) if ((r -= w) <= 0) return v;
  return list[list.length - 1][0];
}

/** Growing-tree maze: mostly newest cell (long corridors), sometimes random (branches). */
function growingTree(g, rng, cells) {
  const N = g.N;
  const inSet = new Set(cells.map(([x, z]) => z * N + x));
  for (const [x, z] of cells) {
    if (inSet.has((z - 1) * N + x)) g.hSet(x, z, WALL);
    if (inSet.has(z * N + x - 1)) g.vSet(x, z, WALL);
  }
  const seen = new Set();
  const start = rng.pick(cells);
  const active = [start];
  seen.add(start[1] * N + start[0]);
  const D = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  while (active.length) {
    const idx = rng.chance(0.75) ? active.length - 1 : Math.floor(rng.next() * active.length);
    const [x, z] = active[idx];
    const opts = [];
    for (let d = 0; d < 4; d++) {
      const nx = x + D[d][0], nz = z + D[d][1];
      const k = nz * N + nx;
      if (inSet.has(k) && !seen.has(k)) opts.push(d);
    }
    if (!opts.length) {
      active.splice(idx, 1);
      continue;
    }
    const d = rng.pick(opts);
    g.setEdge(x, z, d, OPEN);
    const nx = x + D[d][0], nz = z + D[d][1];
    seen.add(nz * N + nx);
    active.push([nx, nz]);
  }
  // a few loops so it isn't a perfect maze
  for (const [x, z] of cells) {
    if (rng.chance(0.12) && inSet.has((z - 1) * N + x)) g.hSet(x, z, OPEN);
    if (rng.chance(0.12) && inSet.has(z * N + x - 1)) g.vSet(x, z, OPEN);
  }
}

/**
 * Generate rooms into grid g. Returns {rooms, roomOf, cellH, pillars, district, corr}
 * pillars are cell-corner coordinates [gx, gz] (in cells, may be fractional .5 for cell centres).
 */
export function generateRooms(g, rng, district, { spawn = false } = {}) {
  const N = g.N;
  const rooms = [];
  const roomOf = new Int16Array(N * N).fill(-1);
  const cellH = new Float32Array(N * N).fill(2.7);
  const pillars = [];
  const rects = [];

  const SIZE = {
    halls: () => pickWeighted(rng, [[90, 3], [150, 2], [40, 2], [8, 1]]),
    pillared: () => 999,
    mixed: () => pickWeighted(rng, [[4, 2], [8, 3], [16, 3], [30, 2], [60, 1]]),
    offices: () => pickWeighted(rng, [[4, 2], [6, 3], [9, 3], [14, 1]]),
  };

  if (district === 'offices') {
    // a corridor spine with rows of small rooms either side, like the back of a store
    const vertical = rng.chance(0.5);
    const at = rng.int(4, N - 5);
    const spine = vertical ? { x: at, z: 0, w: 1, h: N } : { x: 0, z: at, w: N, h: 1 };
    rects.push({ ...spine, type: ROOM.CORRIDOR });
    const sides = vertical ? [[0, 0, at, N], [at + 1, 0, N, N]] : [[0, 0, N, at], [0, at + 1, N, N]];
    for (const [a, b, c, d] of sides) {
      const part = [];
      partition(rng, a, b, c, d, SIZE.offices, 2, part);
      for (const r of part) rects.push(r);
    }
  } else if (district === 'maze') {
    rects.push({ x: 0, z: 0, w: N, h: N, type: ROOM.MAZE });
  } else if (district === 'pillared') {
    rects.push({ x: 0, z: 0, w: N, h: N, type: ROOM.HALL });
  } else {
    const part = [];
    partition(rng, 0, 0, N, N, SIZE[district] || SIZE.mixed, 2, part);
    for (const r of part) rects.push(r);
  }

  // classify and register rooms
  for (const r of rects) {
    const area = r.w * r.h;
    let type = r.type;
    if (!type) {
      if (r.w === 1 || r.h === 1) type = ROOM.CORRIDOR;
      else if (area >= 36) type = ROOM.HALL;
      else if (area <= 8) type = ROOM.SMALL;
      else type = ROOM.ROOM;
    }
    let h;
    if (type === ROOM.HALL) h = district === 'pillared' ? 3.4 + rng.next() * 0.6 : 3.5 + rng.next() * 0.9;
    else if (type === ROOM.ROOM) h = rng.chance(0.8) ? 2.7 : 3.1;
    else if (type === ROOM.SMALL) h = rng.chance(0.5) ? 2.5 : 2.7;
    else if (type === ROOM.CORRIDOR) h = 2.5;
    else h = 2.6;
    h = Math.round(h * 10) / 10;
    const room = { ...r, type, ch: h, id: rooms.length, special: null, dark: false };
    if (type === ROOM.SMALL && rng.chance(0.1)) room.dark = true; // a closet with no light at all
    rooms.push(room);
    for (let z = r.z; z < r.z + r.h; z++)
      for (let x = r.x; x < r.x + r.w; x++) {
        roomOf[z * N + x] = room.id;
        cellH[z * N + x] = h;
      }
  }

  // rare landmark rooms: at most one per chunk
  if (!spawn) {
    const cands = rooms.filter((r) => r.type === ROOM.SMALL || r.type === ROOM.ROOM);
    const s = rng.next();
    if (cands.length && s < 0.1) rng.pick(cands).special = 'manila';
    else if (cands.length && s < 0.16) rng.pick(cands).special = 'red';
    for (const r of rooms) if (r.special) r.dark = false;
  }

  // walls between different rooms
  const pairs = new Map();
  const addPair = (a, b, edge) => {
    const k = a < b ? a * 4096 + b : b * 4096 + a;
    let p = pairs.get(k);
    if (!p) pairs.set(k, (p = { a: Math.min(a, b), b: Math.max(a, b), edges: [] }));
    p.edges.push(edge);
  };
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const r = roomOf[z * N + x];
      if (x > 0 && roomOf[z * N + x - 1] !== r) {
        g.vSet(x, z, WALL);
        addPair(r, roomOf[z * N + x - 1], ['v', x, z]);
      }
      if (z > 0 && roomOf[(z - 1) * N + x] !== r) {
        g.hSet(x, z, WALL);
        addPair(r, roomOf[(z - 1) * N + x], ['h', x, z]);
      }
    }
  const setEdge = ([k, x, z], v) => (k === 'v' ? g.vSet(x, z, v) : g.hSet(x, z, v));
  // doorways: a plain doorway, a wide opening, the whole wall gone (L-shaped rooms), or nothing
  for (const p of pairs.values()) {
    const ra = rooms[p.a], rb = rooms[p.b];
    const corridor = ra.type === ROOM.CORRIDOR || rb.type === ROOM.CORRIDOR;
    const special = ra.special || rb.special;
    const style = special ? 'door' : corridor ? (rng.chance(0.85) ? 'door' : 'wide') : pickWeighted(rng, [['door', 50], ['wide', 22], ['merge', 12], ['none', 16]]);
    const e = p.edges;
    // keep edges in order along the boundary so wide openings are contiguous
    e.sort((a, b) => (a[0] === 'v' ? a[2] - b[2] : a[1] - b[1]));
    if (style === 'door') setEdge(e[Math.floor(rng.next() * e.length)], OPEN);
    else if (style === 'wide') {
      const k = Math.min(e.length, rng.int(2, 5));
      const s = rng.int(0, e.length - k + 1);
      for (let i = s; i < s + k; i++) setEdge(e[i], OPEN);
    } else if (style === 'merge' && e.length <= 8) {
      for (const ed of e) setEdge(ed, OPEN);
      // merged rooms read as one irregular room: share the lower ceiling
      const ch = Math.min(ra.ch, rb.ch);
      ra.ch = rb.ch = ch;
      for (let i = 0; i < N * N; i++) if (roomOf[i] === ra.id || roomOf[i] === rb.id) cellH[i] = ch;
    }
  }

  // maze district: carve with growing tree, then open up one or two rooms inside
  for (const r of rooms) {
    if (r.type !== ROOM.MAZE) continue;
    const cells = [];
    for (let z = r.z; z < r.z + r.h; z++) for (let x = r.x; x < r.x + r.w; x++) cells.push([x, z]);
    growingTree(g, rng, cells);
    for (let i = 0; i < rng.int(1, 3); i++) {
      const rw = rng.int(3, 6), rh = rng.int(3, 6), rx = rng.int(1, N - rw - 1), rz = rng.int(1, N - rh - 1);
      const hh = rng.chance(0.5) ? 3.2 : 2.7;
      for (let z = rz; z < rz + rh; z++)
        for (let x = rx; x < rx + rw; x++) {
          if (z > rz) g.hSet(x, z, OPEN);
          if (x > rx) g.vSet(x, z, OPEN);
          cellH[z * N + x] = hh;
        }
    }
  }

  // halls: pillars marching across, and the odd free-standing wall
  for (const r of rooms) {
    if (r.type !== ROOM.HALL) continue;
    const step = district === 'pillared' ? 2 : 3;
    if (district === 'pillared' || rng.chance(0.6)) {
      const offX = rng.int(1, step), offZ = rng.int(1, step);
      for (let z = r.z + offZ; z < r.z + r.h; z += step)
        for (let x = r.x + offX; x < r.x + r.w; x += step) {
          if (x <= r.x || z <= r.z || rng.chance(0.12)) continue;
          pillars.push([x, z]);
        }
    }
    if (rng.chance(0.35)) {
      for (let i = 0; i < rng.int(1, 3); i++) {
        const len = rng.int(2, 4);
        if (rng.chance(0.5) && r.w > len + 2) {
          const x = rng.int(r.x + 1, r.x + r.w - len), z = rng.int(r.z + 1, r.z + r.h);
          for (let j = 0; j < len; j++) g.hSet(x + j, z, WALL);
        } else if (r.h > len + 2) {
          const x = rng.int(r.x + 1, r.x + r.w), z = rng.int(r.z + 1, r.z + r.h - len);
          for (let j = 0; j < len; j++) g.vSet(x, z + j, WALL);
        }
      }
    }
  }
  return { rooms, roomOf, cellH, pillars };
}

/** The long, unbroken corridor chunk (kept from before: it gets longer walking back). */
export function longhall(g, rng, bspRooms) {
  const N = g.N;
  const r = rng.int(4, N - 4);
  for (let x = 0; x < N; x++) {
    const mid = x >= 3 && x < N - 3;
    g.hSet(x, r, mid ? KEEP : WALL);
    g.hSet(x, r + 1, mid ? KEEP : WALL);
  }
  g.hSet(rng.int(0, 3), r, OPEN);
  g.hSet(rng.int(N - 3, N), r + 1, OPEN);
  g.hSet(rng.int(0, 3), r + 1, OPEN);
  g.hSet(rng.int(N - 3, N), r, OPEN);
  bspRooms(g, rng, 0, 0, N, r, { minArea: 4, maxArea: 20 });
  bspRooms(g, rng, 0, r + 1, N, N, { minArea: 4, maxArea: 20 });
  for (let x = 1; x < N; x++) g.vSet(x, r, OPEN);
  return r;
}

export { RNG };
