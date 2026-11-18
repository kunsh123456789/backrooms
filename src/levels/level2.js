import * as THREE from 'three';
import { RNG, hash32, fbm2 } from '../core/math.js';
import { worldMaterial } from '../gfx/materials.js';
import { tex } from '../gfx/textures.js';
import { FLICKER } from '../gfx/lights.js';
import { Grid, applyBorders, maze, ensureConnected, wallBoxes, openCount, wallDirs } from './grid.js';
import { propMaterials, doorSlab } from './props.js';
import { spawnItems, spawnEmitters } from './common.js';
import { EMIT } from '../audio/ambience.js';

// LEVEL 2 — "Pipe Dreams". Narrow, hot maintenance tunnels. Pipes everywhere,
// dim orange bulbs, steam. Clanking somewhere far off. Claustrophobic.

const N = 16, S = 2, H = 2.6, T = 0.24, CH = N * S;
const ORANGE = [1.0, 0.52, 0.22];
const GRATE = 1;

export class Level2 {
  constructor(game, seed) {
    this.game = game;
    this.seed = seed;
    this.id = 'level2';
    this.chunkSize = CH;
    this.floorY = 0;
    this.bakeOpts = { floorY: 0, ceilY: H, aoStrength: 1, wrap: 0.3 };
    this.materials = {
      ...propMaterials(),
      wall: worldMaterial({ map: tex('tunnelwall'), tile: [3, 3], breathe: true }),
      floor: worldMaterial({ map: tex('concrete'), tile: [3, 3], tint: [0.55, 0.45, 0.38], wet: true }),
      grate: worldMaterial({ map: tex('grate'), tile: [1, 1], wet: true }),
      ceil: worldMaterial({ map: tex('tunnelwall'), tile: [3, 3], tint: [0.6, 0.55, 0.5] }),
      pipe: worldMaterial({ map: tex('rust'), tile: [1, 1.5] }),
      pipe2: worldMaterial({ map: tex('metal'), tile: [1, 1.5] }),
      bulb: worldMaterial({ map: tex('white'), tile: [1, 1], tint: [0.2, 0.2, 0.2] }),
      reddoor: worldMaterial({ map: tex('metal'), tile: [1, 1], tint: [0.9, 0.25, 0.2] }),
      redlamp: worldMaterial({ map: tex('white'), unlit: true, emissive: [4, 0.3, 0.2] }),
    };
    this.config = {
      fogColor: [0.09, 0.05, 0.025],
      fogDensity: 0.05,
      fogLit: 0.7,
      ambient: [0.018, 0.01, 0.005],
      panelGain: 3,
      wetness: 0.7,
      far: 90,
      post: { key: 0.16, grade: [1.1, 0.95, 0.8], sat: 0.85, contrast: 1.12, lift: 0.0, bloom: 0.7 },
      reverb: { small: 0.6, medium: 1.4, large: 2.6, damp: 6000, dampEnd: 1800, metallic: 0.8, wet: 1.0 },
      hum: { bed: 0.012, voices: 0.05, pitch: -500, bright: 900 },
      ambience: 'level2',
      card: { name: 'LEVEL 2', title: 'Pipe Dreams', delay: 30, hint: 'Listen for the drone. A red door waits at the end of a tunnel. Hold H to find it.' },
      noclip: { to: 'levelRun', after: 60, bump: 0.05, bumpMax: 0.35, ramp: 400, fall: 0.004, fallAfter: 150 },
      sanityAlone: 1.2,
      voidTex: ['tunnelwall', 'rust', 'grate'],
      director: {
        sounds: ['clank', 'clank', 'thump', 'drag', 'knock', 'footsteps'],
        lightEvents: true,
        humDrop: false,
        glimpse: ['faceling', 'hound'],
        encounter: ['hound'],
        glimpseAfter: 220,
        encounterAfter: 400,
        minGap: 40,
        tensionTime: 300,
      },
    };
  }

  spawn() {
    return { x: 7 * S + 1, y: 0, z: 7 * S + 1, yaw: 0 };
  }

  layout(cx, cz) {
    const seed = this.seed;
    const ox = cx * CH, oz = cz * CH;
    const rng = new RNG(hash32(seed, cx, cz, 22));
    const g = new Grid(N, S);
    applyBorders(g, seed, cx, cz, 0.15);
    maze(g, rng, 0, 0, N, N, 0.12);
    ensureConnected(g, rng);
    const walls = wallBoxes(g, ox, oz, H, T);
    const boxes = walls.map((w) => w.box);
    const lights = [];
    const spawnChunk = cx === 0 && cz === 0;
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        if (rng.chance(0.25)) g.cell[z * N + x] |= GRATE;
        if (!rng.chance(0.26) && !(spawnChunk && x === 7 && z === 7)) continue;
        const dirs = wallDirs(g, x, z);
        const d = dirs.length ? rng.pick(dirs) : -1;
        // bulbs hang off a wall near the ceiling
        let lx = ox + x * S + S / 2, lz = oz + z * S + S / 2;
        if (d === 0) lz -= S / 2 - 0.25;
        if (d === 2) lz += S / 2 - 0.25;
        if (d === 3) lx -= S / 2 - 0.25;
        if (d === 1) lx += S / 2 - 0.25;
        const n = fbm2(lx / 25, lz / 25, seed + 9);
        const l = { x: lx, y: H - 0.35, z: lz, r: 6, color: ORANGE, base: rng.range(0.55, 0.85), flicker: FLICKER.NONE, dead: false, buzz: 0.6 };
        if (!spawnChunk) {
          if (n > 0.6) l.dead = rng.chance(0.85);
          const r = rng.next();
          if (r < 0.1) l.dead = true;
          else if (r < 0.28) l.flicker = FLICKER.OCCASIONAL;
          else if (r < 0.36) l.flicker = FLICKER.BAD;
        }
        lights.push(l);
      }
    // pipes along walls
    const pipes = [];
    for (const w of walls) {
      const b = w.box;
      for (const side of [-1, 1]) {
        if (!rng.chance(0.75)) continue;
        const ys = rng.chance(0.5) ? [2.2] : [2.05, 2.35];
        for (const y of ys) {
          const r = rng.range(0.05, 0.12);
          if (w.axis === 'h') pipes.push({ axis: 'x', x: (b.minX + b.maxX) / 2, y, z: (side < 0 ? b.minZ : b.maxZ) + side * (r + 0.02), len: b.maxX - b.minX, r, rust: rng.chance(0.6) });
          else pipes.push({ axis: 'z', x: (side < 0 ? b.minX : b.maxX) + side * (r + 0.02), y, z: (b.minZ + b.maxZ) / 2, len: b.maxZ - b.minZ, r, rust: rng.chance(0.6) });
        }
        if (rng.chance(0.25)) {
          const r = 0.06;
          const t = rng.range(0.2, 0.8);
          if (w.axis === 'h') pipes.push({ axis: 'y', x: b.minX + (b.maxX - b.minX) * t, y: H / 2, z: (side < 0 ? b.minZ : b.maxZ) + side * (r + 0.02), len: H, r, rust: true });
          else pipes.push({ axis: 'y', x: (side < 0 ? b.minX : b.maxX) + side * (r + 0.02), y: H / 2, z: b.minZ + (b.maxZ - b.minZ) * t, len: H, r, rust: true });
        }
      }
    }
    // steam vents
    const vents = [];
    for (let i = 0; i < rng.int(0, 3); i++) vents.push({ x: ox + rng.int(0, N) * S + S / 2, z: oz + rng.int(0, N) * S + S / 2 });
    // red door at a dead end, once you've been down here a while
    let red = null;
    const lt = this.game.levelTime || 0;
    const forced = Math.abs(cx) + Math.abs(cz) === 1; // an exit is always one chunk away from where you arrive
    if (!spawnChunk && (forced || rng.chance(0.42))) {
      void lt;
      const dead = [];
      for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) if (openCount(g, x, z) === 1) dead.push([x, z]);
      if (dead.length) {
        const [x, z] = rng.pick(dead);
        const d = wallDirs(g, x, z).find((dd) => !g.blocked(x, z, (dd + 2) % 4)) ?? wallDirs(g, x, z)[0];
        const c = [ox + x * S + S / 2, oz + z * S + S / 2];
        const off = [[0, -1], [1, 0], [0, 1], [-1, 0]][d];
        red = { x: c[0] + off[0] * (S / 2 - T / 2), z: c[1] + off[1] * (S / 2 - T / 2), nx: -off[0], nz: -off[1] };
        lights.push({ x: red.x + red.nx * 0.3, y: 2.35, z: red.z + red.nz * 0.3, r: 5, color: [1, 0.08, 0.05], base: 1.2, flicker: FLICKER.PULSE, dead: false, silent: true });
      }
    }
    const items = [];
    for (const [type, p] of [['almond', 0.14], ['battery', 0.18], ['note', spawnChunk ? 0 : 0.1]]) {
      if (!rng.chance(p)) continue;
      items.push({ type, x: ox + rng.int(0, N) * S + rng.range(0.5, 1.5), z: oz + rng.int(0, N) * S + rng.range(0.5, 1.5), rot: rng.next() * 6, id: `l2:${cx}:${cz}:${type}` });
    }
    return { grid: g, walls, boxes, lights, pipes, vents, red, items, ox, oz };
  }

  build(lay, mb, world) {
    const { ox, oz, grid: g } = lay;
    const extra = [], inter = [], emitters = [];
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        const x0 = ox + x * S, z0 = oz + z * S;
        mb.flat(g.cell[z * N + x] & GRATE ? 'grate' : 'floor', x0, z0, x0 + S, z0 + S, 0, true, { step: 1 });
        mb.flat('ceil', x0, z0, x0 + S, z0 + S, H, false, { step: 1 });
      }
    for (const w of lay.walls) mb.box('wall', w.box.minX, 0, w.box.minZ, w.box.maxX, H, w.box.maxZ, { faces: 'xXzZ', step: 1, vstep: 0.9 });
    for (const p of lay.pipes) mb.cylinder(p.rust ? 'pipe' : 'pipe2', p.x, p.y, p.z, p.axis, p.r, p.len, 7, { step: 2 });
    for (const l of lay.lights) {
      if (l.silent) continue;
      mb.box('bulb', l.x - 0.06, l.y - 0.08, l.z - 0.06, l.x + 0.06, l.y + 0.06, l.z + 0.06, { faces: 'xXzZy', emit: l.slot });
      mb.box('p_metal', l.x - 0.09, l.y + 0.06, l.z - 0.09, l.x + 0.09, l.y + 0.1, l.z + 0.09, { faces: 'xXzZy' });
      for (const [dx, dz] of [[-0.09, 0], [0.09, 0], [0, -0.09], [0, 0.09]]) mb.box('p_metal', l.x + dx - 0.006, l.y - 0.12, l.z + dz - 0.006, l.x + dx + 0.006, l.y + 0.06, l.z + dz + 0.006, { faces: 'xXzZ' });
    }
    // steam
    const steams = [];
    for (const v of lay.vents) {
      mb.flat('grate', v.x - 0.3, v.z - 0.3, v.x + 0.3, v.z + 0.3, 0.01, true, { step: 1 });
      emitters.push({ x: v.x, y: 0.3, z: v.z, build: EMIT.steam, opts: { range: 12, gain: 0.5 } });
      const pts = makeSteam(v.x, v.z);
      extra.push(pts.obj);
      steams.push(pts);
    }
    if (lay.red) {
      const r = lay.red;
      doorSlab(mb, 'reddoor', r.x, r.z, r.nx, r.nz, 0.9, 2.05, 'p_metal');
      const tx = -r.nz, tz = r.nx;
      const lx = r.x + r.nx * 0.08, lz = r.z + r.nz * 0.08;
      mb.box('redlamp', lx - 0.08 - Math.abs(tx) * 0.04, 2.28, lz - 0.08 - Math.abs(tz) * 0.04, lx + 0.08, 2.4, lz + 0.08, { faces: 'xXzZy' });
      emitters.push({ x: r.x - r.nx * 1, y: 1.2, z: r.z - r.nz * 1, build: EMIT.drone, opts: { range: 26, gain: 0.7 } });
      inter.push({ x: r.x + r.nx * 0.3, y: 1.1, z: r.z + r.nz * 0.3, r: 2.2, prompt: 'Open the red door', use: (game) => game.transitionTo('levelRun', { style: 'fade' }) });
    }
    spawnItems(lay.items, world, this.game, extra, inter);
    const dispose = spawnEmitters(emitters, this.game);
    return {
      extra,
      interactables: inter,
      dispose,
      update: steams.length ? (dt) => steams.forEach((s) => s.update(dt)) : null,
    };
  }

  exitsOf(lay) {
    return lay.red ? [{ x: lay.red.x + lay.red.nx * 0.5, z: lay.red.z + lay.red.nz * 0.5, label: 'the red door' }] : [];
  }

  surfaceAt(x, z, world) {
    const [cx, cz] = world.chunkOf(x, z);
    const lay = world.layouts.get(cx + ',' + cz);
    if (!lay) return 'concrete';
    const gx = Math.floor((x - lay.ox) / S), gz = Math.floor((z - lay.oz) / S);
    if (gx < 0 || gz < 0 || gx >= N || gz >= N) return 'concrete';
    return lay.grid.cell[gz * N + gx] & GRATE ? 'metal' : 'concrete';
  }
}

let steamMat = null;
function makeSteam(x, z) {
  if (!steamMat) {
    steamMat = new THREE.PointsMaterial({ map: tex('steam'), size: 1.2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.08, color: 0xffd0a0 });
  }
  const n = 24;
  const pos = new Float32Array(n * 3);
  const life = new Float32Array(n);
  for (let i = 0; i < n; i++) life[i] = Math.random();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const obj = new THREE.Points(geo, steamMat);
  obj.frustumCulled = false;
  const update = (dt) => {
    for (let i = 0; i < n; i++) {
      life[i] += dt * 0.35;
      if (life[i] > 1) life[i] -= 1;
      const t = life[i];
      pos[i * 3] = x + Math.sin(i * 7.1 + t * 3) * t * 0.6;
      pos[i * 3 + 1] = t * 2.4;
      pos[i * 3 + 2] = z + Math.cos(i * 3.3 + t * 2) * t * 0.6;
    }
    geo.attributes.position.needsUpdate = true;
  };
  update(0);
  return { obj, update };
}
