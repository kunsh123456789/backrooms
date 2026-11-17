import * as THREE from 'three';
import { RNG, hash32 } from '../core/math.js';
import { worldMaterial } from '../gfx/materials.js';
import { tex } from '../gfx/textures.js';
import { FLICKER } from '../gfx/lights.js';
import { box } from '../world/world.js';
import { Grid, applyBorders, bspRooms, ensureConnected, wallBoxes, wallDirs } from './grid.js';
import { propMaterials, doorSlab, balloons } from './props.js';
import { spawnItems } from './common.js';
import { Entities } from '../entities/entities.js';

// LEVEL FUN =) — A party for someone. Overly bright, uncomfortably happy,
// distorted music. The guests would love for you to stay.

const N = 12, S = 3, H = 3.0, T = 0.2, CH = N * S;
const DARK = 1;

export class LevelFun {
  constructor(game, seed) {
    this.game = game;
    this.seed = seed;
    this.id = 'levelFun';
    this.chunkSize = CH;
    this.floorY = 0;
    this.bakeOpts = { floorY: 0, ceilY: H, aoStrength: 0.7, wrap: 0.45 };
    this.materials = {
      ...propMaterials(),
      wall: worldMaterial({ map: tex('partywall'), tile: [4, 3] }),
      floor: worldMaterial({ map: tex('partyfloor'), tile: [2, 2] }),
      ceil: worldMaterial({ map: tex('ceiling0'), tile: [2.4, 2.4], tint: [1, 0.95, 0.9] }),
      panel: worldMaterial({ map: tex('panel'), tile: [1, 1], tint: [0.4, 0.4, 0.4] }),
      cloth: worldMaterial({ map: tex('white'), tile: [1, 1], tint: [0.95, 0.9, 0.92] }),
      cake: worldMaterial({ map: tex('white'), tile: [1, 1], tint: [1.0, 0.7, 0.8] }),
      s0: worldMaterial({ map: tex('white'), tint: [0.9, 0.2, 0.3], side: THREE.DoubleSide }),
      s1: worldMaterial({ map: tex('white'), tint: [0.2, 0.4, 0.95], side: THREE.DoubleSide }),
      s2: worldMaterial({ map: tex('white'), tint: [0.95, 0.8, 0.2], side: THREE.DoubleSide }),
      s3: worldMaterial({ map: tex('white'), tint: [0.3, 0.85, 0.4], side: THREE.DoubleSide }),
    };
    this.config = {
      fogColor: [0.75, 0.55, 0.45],
      fogDensity: 0.018,
      fogLit: 0.6,
      ambient: [0.08, 0.06, 0.05],
      panelGain: 3,
      post: { key: 0.42, grade: [1.08, 1.0, 0.95], sat: 1.3, contrast: 1.05, lift: 0.04, bloom: 1.3 },
      reverb: { small: 0.5, medium: 1.2, large: 2.0, damp: 6000, dampEnd: 2000, wet: 0.7 },
      hum: { bed: 0, voices: 0 },
      ambience: 'levelFun',
      card: { name: 'LEVEL FUN =)', title: 'Welcome to the party!', delay: 20, hint: 'Find the room where the lights are off.' },
      noclip: { to: 'level37', after: 40, bump: 0.08, bumpMax: 0.4, ramp: 300, fall: 0.005, fallAfter: 90 },
      sanityAlone: 1.6,
      rumble: false,
      director: { off: true },
      voidTex: ['partywall', 'partyfloor'],
    };
    this.spawnT = 18;
  }

  spawn() {
    return { x: 5 * S + 1.5, y: 0, z: 5 * S + 1.5, yaw: 0 };
  }

  layout(cx, cz) {
    const seed = this.seed;
    const ox = cx * CH, oz = cz * CH;
    const rng = new RNG(hash32(seed, cx, cz, 66));
    const g = new Grid(N, S);
    applyBorders(g, seed, cx, cz, 0.35);
    bspRooms(g, rng, 0, 0, N, N, { minArea: 6, maxArea: 24, skip: 0.1 });
    ensureConnected(g, rng);
    const walls = wallBoxes(g, ox, oz, H, T);
    const boxes = walls.map((w) => w.box);
    const spawnChunk = cx === 0 && cz === 0;
    // the exit: a room where the lights are off
    let exit = null;
    const lt = this.game.levelTime || 0;
    if (!spawnChunk && rng.chance(0.45) && lt >= 0) {
      const x = rng.int(2, N - 2), z = rng.int(2, N - 2);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) g.cell[(z + dz) * N + x + dx] |= DARK;
      const d = wallDirs(g, x, z);
      exit = { x, z, dir: d.length ? rng.pick(d) : -1 };
    }
    const lights = [];
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        if ((x + z) % 2) continue;
        const dark = g.cell[z * N + x] & DARK;
        lights.push({ x: ox + x * S + S / 2, y: H - 0.2, z: oz + z * S + S / 2, r: 8, color: [1, 0.88, 0.72], base: 1.25, flicker: FLICKER.NONE, dead: !!dark, silent: true });
      }
    const tables = [];
    for (let i = 0; i < rng.int(1, 4); i++) {
      const x = rng.int(0, N), z = rng.int(0, N);
      if (g.cell[z * N + x] & DARK || (spawnChunk && x === 5 && z === 5)) continue;
      const t = { x: ox + x * S + S / 2, z: oz + z * S + S / 2, cake: rng.chance(0.4) };
      tables.push(t);
      boxes.push(box(t.x - 0.9, 0, t.z - 0.5, t.x + 0.9, 0.8, t.z + 0.5, { occ: false }));
    }
    const balloonSpots = [];
    for (let i = 0; i < rng.int(3, 8); i++) balloonSpots.push({ x: ox + rng.range(1, CH - 1), z: oz + rng.range(1, CH - 1), n: rng.int(2, 6), ceil: rng.chance(0.5) });
    const items = [];
    for (const [type, p] of [['almond', 0.25], ['note', spawnChunk ? 0 : 0.15]]) {
      if (rng.chance(p)) items.push({ type, x: ox + rng.int(0, N) * S + rng.range(0.5, 2.5), z: oz + rng.int(0, N) * S + rng.range(0.5, 2.5), rot: rng.next() * 6, id: `fun:${cx}:${cz}:${type}` });
    }
    return { grid: g, walls, boxes, lights, tables, balloonSpots, exit, items, ox, oz };
  }

  build(lay, mb, world) {
    const { ox, oz, grid: g } = lay;
    const extra = [], inter = [];
    const rng = new RNG(hash32(this.seed, lay.cx, lay.cz, 67));
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        const x0 = ox + x * S, z0 = oz + z * S;
        mb.flat('floor', x0, z0, x0 + S, z0 + S, 0, true, { step: 1 });
        mb.flat('ceil', x0, z0, x0 + S, z0 + S, H, false, { step: 1 });
      }
    for (const w of lay.walls) mb.box('wall', w.box.minX, 0, w.box.minZ, w.box.maxX, H, w.box.maxZ, { faces: 'xXzZ', step: 1, vstep: 1 });
    for (const l of lay.lights) {
      const y = H - 0.008;
      mb.quad('panel', [l.x - 0.6, y, l.z - 0.3], [l.x + 0.6, y, l.z - 0.3], [l.x + 0.6, y, l.z + 0.3], [l.x - 0.6, y, l.z + 0.3], [0, -1, 0], [[0, 0], [0, 1], [1, 1], [1, 0]], { emit: l.slot, kind: 1, inset: 0 });
    }
    // streamers draped across the ceiling
    for (let i = 0; i < 6; i++) {
      const x0 = ox + rng.range(0, CH), z0 = oz + rng.range(0, CH);
      const ang = rng.next() * Math.PI;
      const len = rng.range(3, 8);
      const key = 's' + rng.int(0, 4);
      for (let k = 0; k < 8; k++) {
        const t0 = k / 8, t1 = (k + 1) / 8;
        const sag = (t) => H - 0.05 - Math.sin(t * Math.PI) * 0.6;
        const ax = x0 + Math.cos(ang) * len * t0, az = z0 + Math.sin(ang) * len * t0;
        const bx = x0 + Math.cos(ang) * len * t1, bz = z0 + Math.sin(ang) * len * t1;
        mb.quad(key, [ax, sag(t0) - 0.05, az], [bx, sag(t1) - 0.05, bz], [bx, sag(t1), bz], [ax, sag(t0), az], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], { kind: 3 });
      }
    }
    for (const t of lay.tables) {
      mb.box('cloth', t.x - 0.9, 0.72, t.z - 0.5, t.x + 0.9, 0.78, t.z + 0.5, { faces: 'xXzZYy' });
      mb.box('cloth', t.x - 0.9, 0.3, t.z - 0.5, t.x + 0.9, 0.72, t.z + 0.5, { faces: 'xXzZ' });
      if (t.cake) {
        mb.cylinder('cake', t.x, 0.9, t.z, 'y', 0.2, 0.24, 14);
        mb.box('cake', t.x - 0.2, 1.02, t.z - 0.2, t.x + 0.2, 1.021, t.z + 0.2, { faces: 'Y' });
      }
      for (let k = 0; k < 4; k++) mb.cylinder('s' + (k % 4), t.x - 0.6 + k * 0.4, 0.83, t.z + 0.2, 'y', 0.04, 0.1, 8);
    }
    const light = new THREE.Vector3(0.9, 0.8, 0.7);
    for (const b of lay.balloonSpots) balloons(extra, b.x, b.ceil ? H - 0.35 : 0.9, b.z, b.n, rng, light);
    if (lay.exit) {
      const e = lay.exit;
      const cx = ox + e.x * S + S / 2, cz = oz + e.z * S + S / 2;
      const d = e.dir >= 0 ? [[0, -1], [1, 0], [0, 1], [-1, 0]][e.dir] : [0, -1];
      const fx = cx + d[0] * (S / 2 - T / 2), fz = cz + d[1] * (S / 2 - T / 2);
      doorSlab(mb, 'p_dark', fx, fz, -d[0], -d[1], 0.9, 2.05, 'p_black');
      inter.push({ x: fx - d[0] * 0.3, y: 1.1, z: fz - d[1] * 0.3, r: 2.2, prompt: 'Leave the party', use: (game) => game.transitionTo('level37', { style: 'fade' }) });
    }
    spawnItems(lay.items, world, this.game, extra, inter);
    const bobbers = extra.filter((m) => m.userData.bob !== undefined);
    return {
      extra,
      interactables: inter,
      update: (dt) => {
        for (const m of bobbers) {
          m.userData.bob += dt;
          m.position.y += Math.sin(m.userData.bob * 1.3) * 0.0015;
        }
      },
    };
  }

  update(dt, game) {
    // keep a few guests around, just out of sight
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 22;
      const n = game.entities.list.filter((e) => e instanceof Entities.Partygoer).length;
      if (n < 3) game.entities.spawn('partygoer', 'encounter');
    }
  }

  surfaceAt() {
    return 'housecarpet';
  }
}
