import { hashf } from '../core/math.js';
import { box } from '../world/world.js';

// A chunk-local grid of square cells with walls on cell edges.
// h[z][x]: wall on the edge along +x at the top of cell (x,z)  (z = 0..N)
// v[z][x]: wall on the edge along +z at the left of cell (x,z) (x = 0..N)
// Border edges come from a pure hash shared by both neighbouring chunks, so
// chunks always agree on where the openings between them are.

export const OPEN = 0, WALL = 1, WINDOW = 2, KEEP = 3;

export class Grid {
  constructor(N, S) {
    this.N = N;
    this.S = S;
    this.h = new Uint8Array((N + 1) * N);
    this.v = new Uint8Array(N * (N + 1));
    this.cell = new Uint8Array(N * N); // flags per cell (level defined)
    this.solid = new Uint8Array(N * N); // cells you cannot enter at all
  }
  hGet(x, z) {
    return this.h[z * this.N + x];
  }
  hSet(x, z, w) {
    this.h[z * this.N + x] = w;
  }
  vGet(x, z) {
    return this.v[z * (this.N + 1) + x];
  }
  vSet(x, z, w) {
    this.v[z * (this.N + 1) + x] = w;
  }
  /** Is movement blocked from cell (x,z) in direction d (0:-z,1:+x,2:+z,3:-x)? */
  blocked(x, z, d) {
    if (d === 0) return this.hGet(x, z) !== OPEN;
    if (d === 2) return this.hGet(x, z + 1) !== OPEN;
    if (d === 3) return this.vGet(x, z) !== OPEN;
    return this.vGet(x + 1, z) !== OPEN;
  }
  setEdge(x, z, d, w) {
    if (d === 0) this.hSet(x, z, w);
    else if (d === 2) this.hSet(x, z + 1, w);
    else if (d === 3) this.vSet(x, z, w);
    else this.vSet(x + 1, z, w);
  }
  getEdge(x, z, d) {
    if (d === 0) return this.hGet(x, z);
    if (d === 2) return this.hGet(x, z + 1);
    if (d === 3) return this.vGet(x, z);
    return this.vGet(x + 1, z);
  }
  inside(x, z) {
    return x >= 0 && z >= 0 && x < this.N && z < this.N;
  }
}

export const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * Border edges: groups of 4 edges either fully open, or a wall with 1-2 gaps.
 * axis 0 = h edges (line z = gz), 1 = v edges (line x = gx); idx is the position along the line.
 */
export function borderWall(seed, axis, line, idx, pOpen = 0.4) {
  const block = Math.floor(idx / 4);
  const r = hashf(seed, block, line, axis * 7 + 1);
  if (r < pOpen) return OPEN;
  const gap = Math.floor(hashf(seed, block, line, axis * 7 + 2) * 4);
  const gap2 = hashf(seed, block, line, axis * 7 + 3) < 0.3 ? Math.floor(hashf(seed, block, line, axis * 7 + 4) * 4) : -1;
  const i = ((idx % 4) + 4) % 4;
  return i === gap || i === gap2 ? OPEN : WALL;
}

export function applyBorders(g, seed, cx, cz, pOpen = 0.4) {
  const N = g.N;
  for (let x = 0; x < N; x++) {
    g.hSet(x, 0, borderWall(seed, 0, cz * N, cx * N + x, pOpen));
    g.hSet(x, N, borderWall(seed, 0, (cz + 1) * N, cx * N + x, pOpen));
  }
  for (let z = 0; z < N; z++) {
    g.vSet(0, z, borderWall(seed, 1, cx * N, cz * N + z, pOpen));
    g.vSet(N, z, borderWall(seed, 1, (cx + 1) * N, cz * N + z, pOpen));
  }
}

/** Recursive subdivision into rooms with doorway gaps. */
export function bspRooms(g, rng, x0, z0, x1, z1, opts = {}, depth = 0) {
  const w = x1 - x0, h = z1 - z0;
  const minLeaf = opts.minLeaf ?? 2;
  if (w < minLeaf * 2 && h < minLeaf * 2) return;
  const area = w * h;
  if (depth > 1 && area <= rng.int(opts.minArea ?? 4, opts.maxArea ?? 22) && rng.chance(0.75)) return;
  let vertical = w > h ? true : h > w ? false : rng.chance(0.5);
  if (w < minLeaf * 2) vertical = false;
  if (h < minLeaf * 2) vertical = true;
  if (vertical) {
    const sx = rng.int(x0 + minLeaf, x1 - minLeaf + 1);
    if (!rng.chance(opts.skip ?? 0.14)) {
      const partial = rng.chance(0.12);
      const zs = partial ? rng.int(z0, z1 - 1) : z0;
      const ze = partial ? rng.int(zs + 1, z1 + 1) : z1;
      for (let z = zs; z < ze; z++) if (g.vGet(sx, z) === OPEN) g.vSet(sx, z, WALL);
      const doors = 1 + (rng.chance(0.4) ? 1 : 0) + (h > 6 && rng.chance(0.5) ? 1 : 0);
      for (let d = 0; d < doors; d++) {
        const dz = rng.int(zs, ze);
        g.vSet(sx, dz, OPEN);
        if (rng.chance(0.2) && dz + 1 < ze) g.vSet(sx, dz + 1, OPEN);
      }
    }
    bspRooms(g, rng, x0, z0, sx, z1, opts, depth + 1);
    bspRooms(g, rng, sx, z0, x1, z1, opts, depth + 1);
  } else {
    const sz = rng.int(z0 + minLeaf, z1 - minLeaf + 1);
    if (!rng.chance(opts.skip ?? 0.14)) {
      const partial = rng.chance(0.12);
      const xs = partial ? rng.int(x0, x1 - 1) : x0;
      const xe = partial ? rng.int(xs + 1, x1 + 1) : x1;
      for (let x = xs; x < xe; x++) if (g.hGet(x, sz) === OPEN) g.hSet(x, sz, WALL);
      const doors = 1 + (rng.chance(0.4) ? 1 : 0) + (w > 6 && rng.chance(0.5) ? 1 : 0);
      for (let d = 0; d < doors; d++) {
        const dx = rng.int(xs, xe);
        g.hSet(dx, sz, OPEN);
        if (rng.chance(0.2) && dx + 1 < xe) g.hSet(dx + 1, sz, OPEN);
      }
    }
    bspRooms(g, rng, x0, z0, x1, sz, opts, depth + 1);
    bspRooms(g, rng, x0, sz, x1, z1, opts, depth + 1);
  }
}

/** Perfect maze over a rect of cells, then knock out extra walls for loops. */
export function maze(g, rng, x0, z0, x1, z1, loops = 0.25) {
  for (let z = z0; z < z1; z++)
    for (let x = x0; x < x1; x++) {
      if (z > z0) g.hSet(x, z, WALL);
      if (x > x0) g.vSet(x, z, WALL);
    }
  const W = x1 - x0, H = z1 - z0;
  const seen = new Uint8Array(W * H);
  const stack = [[rng.int(0, W), rng.int(0, H)]];
  seen[stack[0][1] * W + stack[0][0]] = 1;
  while (stack.length) {
    const [cx, cz] = stack[stack.length - 1];
    const opts = [];
    for (let d = 0; d < 4; d++) {
      const nx = cx + DIRS[d][0], nz = cz + DIRS[d][1];
      if (nx >= 0 && nz >= 0 && nx < W && nz < H && !seen[nz * W + nx]) opts.push(d);
    }
    if (!opts.length) {
      stack.pop();
      continue;
    }
    // prefer going straight for longer corridors
    const d = rng.pick(opts);
    g.setEdge(x0 + cx, z0 + cz, d, OPEN);
    const nx = cx + DIRS[d][0], nz = cz + DIRS[d][1];
    seen[nz * W + nx] = 1;
    stack.push([nx, nz]);
  }
  for (let z = z0; z < z1; z++)
    for (let x = x0; x < x1; x++) {
      if (z > z0 && rng.chance(loops)) g.hSet(x, z, OPEN);
      if (x > x0 && rng.chance(loops)) g.vSet(x, z, OPEN);
    }
}

/** Union-find connectivity: open walls until every non-solid cell is reachable. */
export function ensureConnected(g, rng) {
  const N = g.N;
  const parent = new Int32Array(N * N);
  for (let i = 0; i < N * N; i++) parent[i] = i;
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[a] = b;
  };
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      if (g.solid[z * N + x]) continue;
      if (x + 1 < N && !g.solid[z * N + x + 1] && g.vGet(x + 1, z) === OPEN) union(z * N + x, z * N + x + 1);
      if (z + 1 < N && !g.solid[(z + 1) * N + x] && g.hGet(x, z + 1) === OPEN) union(z * N + x, (z + 1) * N + x);
    }
  for (let pass = 0; pass < 200; pass++) {
    const roots = new Set();
    for (let i = 0; i < N * N; i++) if (!g.solid[i]) roots.add(find(i));
    if (roots.size <= 1) return;
    const cands = [];
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        if (g.solid[z * N + x]) continue;
        if (x + 1 < N && !g.solid[z * N + x + 1] && g.vGet(x + 1, z) === WALL && find(z * N + x) !== find(z * N + x + 1)) cands.push([x + 1, z, 'v', z * N + x, z * N + x + 1]);
        if (z + 1 < N && !g.solid[(z + 1) * N + x] && g.hGet(x, z + 1) === WALL && find(z * N + x) !== find((z + 1) * N + x)) cands.push([x, z + 1, 'h', z * N + x, (z + 1) * N + x]);
      }
    if (!cands.length) return;
    const c = rng.pick(cands);
    if (c[2] === 'v') g.vSet(c[0], c[1], OPEN);
    else g.hSet(c[0], c[1], OPEN);
    union(c[3], c[4]);
  }
}

/**
 * Merge wall edges into long boxes. Only edges owned by this chunk (top/left borders,
 * not bottom/right) are emitted. Returns [{box, axis, kind}]
 */
export function wallBoxes(g, ox, oz, H, T = 0.2, { includeFar = false, y0 = 0 } = {}) {
  const N = g.N, S = g.S;
  const out = [];
  const zMax = includeFar ? N : N - 1;
  for (let z = 0; z <= zMax; z++) {
    let x = 0;
    while (x < N) {
      const w = g.hGet(x, z);
      if (w === OPEN) {
        x++;
        continue;
      }
      let e = x;
      while (e + 1 < N && g.hGet(e + 1, z) === w) e++;
      const wz = oz + z * S;
      out.push({ box: box(ox + x * S - T / 2, y0, wz - T / 2, ox + (e + 1) * S + T / 2, y0 + H, wz + T / 2), axis: 'h', kind: w, a: x, b: e, line: z });
      x = e + 1;
    }
  }
  const xMax = includeFar ? N : N - 1;
  for (let x = 0; x <= xMax; x++) {
    let z = 0;
    while (z < N) {
      const w = g.vGet(x, z);
      if (w === OPEN) {
        z++;
        continue;
      }
      let e = z;
      while (e + 1 < N && g.vGet(x, e + 1) === w) e++;
      const wx = ox + x * S;
      out.push({ box: box(wx - T / 2, y0, oz + z * S - T / 2, wx + T / 2, y0 + H, oz + (e + 1) * S + T / 2), axis: 'v', kind: w, a: z, b: e, line: x });
      z = e + 1;
    }
  }
  return out;
}

/** Count open neighbours of a cell. */
export function openCount(g, x, z) {
  let n = 0;
  for (let d = 0; d < 4; d++) if (!g.blocked(x, z, d)) n++;
  return n;
}

/** Walls adjacent to a cell: returns directions with a wall. */
export function wallDirs(g, x, z) {
  const out = [];
  for (let d = 0; d < 4; d++) if (g.getEdge(x, z, d) === WALL) out.push(d);
  return out;
}
