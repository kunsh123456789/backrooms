import * as THREE from 'three';
import { RNG, hash32 } from '../core/math.js';
import { worldMaterial, waterMaterial } from '../gfx/materials.js';
import { tex } from '../gfx/textures.js';
import { FLICKER } from '../gfx/lights.js';
import { box } from '../world/world.js';
import { Grid, applyBorders, bspRooms, ensureConnected, wallBoxes } from './grid.js';
import { propMaterials, doorSlab } from './props.js';
import { spawnItems, spawnEmitters } from './common.js';
import { EMIT } from '../audio/ambience.js';

// LEVEL 37 — "The Poolrooms". White tile, still turquoise water, soft daylight
// from nowhere. Nothing here wants anything. Peaceful, and deeply wrong.

const N = 12, S = 3, H = 4.5, T = 0.3, CH = N * S;
const POOL = 1, SKY = 2, DEPTH = 0.42, WL = -0.06;

export class Level37 {
  constructor(game, seed) {
    this.game = game;
    this.seed = seed;
    this.id = 'level37';
    this.chunkSize = CH;
    this.floorY = 0;
    this.waterLevel = WL;
    this.bakeOpts = { floorY: 0, ceilY: H, aoStrength: 0.7, wrap: 0.5 };
    this.materials = {
      ...propMaterials(),
      tile: worldMaterial({ map: tex('pooltile'), tile: [1.2, 1.2], caustics: true }),
      ceil: worldMaterial({ map: tex('pooltile'), tile: [1.2, 1.2], tint: [0.95, 0.97, 0.97] }),
      sky: worldMaterial({ map: tex('white'), unlit: true, emissive: [5, 5, 4.8] }),
      water: waterMaterial([0.05, 0.55, 0.62]),
    };
    this.config = {
      fogColor: [0.7, 0.8, 0.82],
      fogDensity: 0.011,
      fogLit: 0.25,
      ambient: [0.3, 0.33, 0.34],
      panelGain: 2,
      far: 170,
      waterLevel: WL,
      caustics: 0.55,
      ambientLum: 0.3,
      post: { key: 0.28, grade: [0.97, 1.02, 1.04], sat: 1.0, contrast: 1.1, lift: 0.0, bloom: 1.0 },
      reverb: { small: 2.2, medium: 4.5, large: 7.5, damp: 8000, dampEnd: 2500, wet: 1.5 },
      hum: { bed: 0, voices: 0 },
      ambience: 'level37',
      card: { name: 'LEVEL 37', title: 'The Poolrooms', delay: 35, hint: 'A plain wooden door. Listen for a clock ticking.' },
      sanityAlone: 0.7,
      noEntities: true,
      rumble: true,
      voidTex: ['pooltile', 'white'],
      director: { sounds: ['splash', 'whisper', 'drip'], minGap: 150, tensionTime: 900 },
    };
  }

  spawn() {
    return { x: 5 * S + 1.5, y: 0, z: 5 * S + 1.5, yaw: 0.4 };
  }

  layout(cx, cz) {
    const seed = this.seed;
    const ox = cx * CH, oz = cz * CH;
    const rng = new RNG(hash32(seed, cx, cz, 37));
    const g = new Grid(N, S);
    applyBorders(g, seed, cx, cz, 0.55);
    bspRooms(g, rng, 0, 0, N, N, { minArea: 6, maxArea: 40, skip: 0.3 });
    ensureConnected(g, rng);
    const walls = wallBoxes(g, ox, oz, H, T);
    const boxes = walls.map((w) => w.box);
    const spawnChunk = cx === 0 && cz === 0;
    // pools: rectangles of sunken cells
    const pools = [];
    for (let i = 0; i < rng.int(1, 4); i++) {
      const w = rng.int(2, 6), d = rng.int(2, 5);
      const x0 = rng.int(1, N - w - 1), z0 = rng.int(1, N - d - 1);
      if (spawnChunk && x0 <= 5 && x0 + w > 5 && z0 <= 5 && z0 + d > 5) continue;
      pools.push({ x0, z0, w, d });
      for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) g.cell[z * N + x] |= POOL;
    }
    // lights: skylights of white nothing, and soft daylight sources under them
    const lights = [];
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        if ((x + z * 3 + cx + cz) % 5 !== 0) continue;
        g.cell[z * N + x] |= SKY;
        lights.push({ x: ox + x * S + S / 2, y: H - 0.8, z: oz + z * S + S / 2, r: 12, color: [1.0, 0.98, 0.92], base: 0.8, flicker: FLICKER.NONE, dead: false, silent: true });
      }
    const columns = [];
    for (let i = 0; i < rng.int(0, 5); i++) {
      const x = rng.int(1, N), z = rng.int(1, N);
      const px = ox + x * S, pz = oz + z * S;
      const b = box(px - 0.3, 0, pz - 0.3, px + 0.3, H, pz + 0.3);
      boxes.push(b);
      columns.push(b);
    }
    const items = [];
    const cellXZ = () => {
      for (let i = 0; i < 20; i++) {
        const x = rng.int(0, N), z = rng.int(0, N);
        if (!(g.cell[z * N + x] & POOL)) return [ox + x * S + rng.range(0.6, 2.4), oz + z * S + rng.range(0.6, 2.4)];
      }
      return null;
    };
    for (const [type, p] of [['almond', 0.12], ['note', spawnChunk ? 0 : 0.12]]) {
      if (!rng.chance(p)) continue;
      const c = cellXZ();
      if (c) items.push({ type, x: c[0], z: c[1], rot: rng.next() * 6, id: `l37:${cx}:${cz}:${type}` });
    }
    // the door home
    let door = null;
    const lt = this.game.levelTime || 0;
    if (!spawnChunk && lt > 30 && rng.chance(0.32)) {
      const cand = walls.filter((w) => w.b - w.a >= 1);
      if (cand.length) {
        const w = rng.pick(cand);
        const along = rng.int(w.a, w.b + 1);
        const side = rng.chance(0.5) ? 1 : -1;
        if (w.axis === 'h') door = { x: ox + along * S + S / 2, z: w.box.minZ + T / 2 + side * T / 2, nx: 0, nz: side };
        else door = { x: w.box.minX + T / 2 + side * T / 2, z: oz + along * S + S / 2, nx: side, nz: 0 };
        // a warm glow leaking from under it: the only warm light here
        lights.push({ x: door.x + door.nx * 0.4, y: 0.15, z: door.z + door.nz * 0.4, r: 3.5, color: [1.0, 0.6, 0.3], base: 0.6, flicker: FLICKER.NONE, dead: false, silent: true });
      }
    }
    return { grid: g, walls, boxes, lights, pools, columns, items, door, ox, oz };
  }

  build(lay, mb, world) {
    const { ox, oz, grid: g } = lay;
    const extra = [], inter = [], zones = [], emitters = [];
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        const c = g.cell[z * N + x];
        const x0 = ox + x * S, z0 = oz + z * S;
        if (c & POOL) {
          mb.flat('tile', x0, z0, x0 + S, z0 + S, -DEPTH, true, { step: 1 });
          zones.push({ minX: x0, maxX: x0 + S, minZ: z0, maxZ: z0 + S, type: 'floor', y: -DEPTH });
          // pool sides where the neighbour is not pool
          const nb = (dx, dz) => {
            const nx = x + dx, nz = z + dz;
            return nx >= 0 && nz >= 0 && nx < N && nz < N && g.cell[nz * N + nx] & POOL;
          };
          if (!nb(0, -1)) mb.vface('tile', x0 + S, z0, x0, z0, -DEPTH, 0, 0, 1, { sv: 1, step: 1 });
          if (!nb(0, 1)) mb.vface('tile', x0, z0 + S, x0 + S, z0 + S, -DEPTH, 0, 0, -1, { sv: 1, step: 1 });
          if (!nb(-1, 0)) mb.vface('tile', x0, z0, x0, z0 + S, -DEPTH, 0, 1, 0, { sv: 1, step: 1 });
          if (!nb(1, 0)) mb.vface('tile', x0 + S, z0 + S, x0 + S, z0, -DEPTH, 0, -1, 0, { sv: 1, step: 1 });
        } else {
          mb.flat('tile', x0, z0, x0 + S, z0 + S, 0, true, { step: 1.5 });
        }
        if (c & SKY) {
          // an opening in the ceiling onto white
          const i = 0.5;
          mb.flat('ceil', x0, z0, x0 + S, z0 + i, H, false, { step: 1.5 });
          mb.flat('ceil', x0, z0 + S - i, x0 + S, z0 + S, H, false, { step: 1.5 });
          mb.flat('ceil', x0, z0 + i, x0 + i, z0 + S - i, H, false, { step: 1.5 });
          mb.flat('ceil', x0 + S - i, z0 + i, x0 + S, z0 + S - i, H, false, { step: 1.5 });
          mb.flat('sky', x0 + i, z0 + i, x0 + S - i, z0 + S - i, H + 0.6, false, { step: 2 });
          mb.vface('ceil', x0 + i, z0 + i, x0 + S - i, z0 + i, H, H + 0.6, 0, 1, { sv: 1 });
          mb.vface('ceil', x0 + S - i, z0 + S - i, x0 + i, z0 + S - i, H, H + 0.6, 0, -1, { sv: 1 });
          mb.vface('ceil', x0 + i, z0 + S - i, x0 + i, z0 + i, H, H + 0.6, 1, 0, { sv: 1 });
          mb.vface('ceil', x0 + S - i, z0 + i, x0 + S - i, z0 + S - i, H, H + 0.6, -1, 0, { sv: 1 });
        } else {
          mb.flat('ceil', x0, z0, x0 + S, z0 + S, H, false, { step: 1.5 });
        }
      }
    for (const w of lay.walls) mb.box('tile', w.box.minX, 0, w.box.minZ, w.box.maxX, H, w.box.maxZ, { faces: 'xXzZ', step: 1.5, vstep: 1.5 });
    for (const c of lay.columns) mb.box('tile', c.minX, 0, c.minZ, c.maxX, H, c.maxZ, { faces: 'xXzZ', step: 0.6, vstep: 1.5 });
    for (const p of lay.pools) {
      const geo = new THREE.PlaneGeometry(p.w * S, p.d * S, 1, 1).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, this.materials.water);
      m.position.set(ox + (p.x0 + p.w / 2) * S, WL, oz + (p.z0 + p.d / 2) * S);
      m.renderOrder = 2;
      extra.push(m);
    }
    if (lay.door) {
      const d = lay.door;
      doorSlab(mb, 'p_wood', d.x, d.z, d.nx, d.nz, 0.85, 2.0, 'p_white');
      inter.push({ x: d.x + d.nx * 0.3, y: 1.1, z: d.z + d.nz * 0.3, r: 2.2, prompt: 'Open the door', use: (game) => game.ending('escape') });
      emitters.push({ x: d.x - d.nx * 0.5, y: 1.6, z: d.z - d.nz * 0.5, build: EMIT.clock, opts: { range: 24, gain: 0.5, reverb: 1 } });
    }
    spawnItems(lay.items, world, this.game, extra, inter);
    return { extra, interactables: inter, zones, dispose: spawnEmitters(emitters, this.game) };
  }

  surfaceAt() {
    return 'tile';
  }
}
