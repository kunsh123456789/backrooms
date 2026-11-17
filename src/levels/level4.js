import * as THREE from 'three';
import { RNG, hash32 } from '../core/math.js';
import { worldMaterial } from '../gfx/materials.js';
import { tex } from '../gfx/textures.js';
import { FLICKER } from '../gfx/lights.js';
import { box } from '../world/world.js';
import { Grid, applyBorders, bspRooms, ensureConnected, wallBoxes, OPEN, WALL, WINDOW } from './grid.js';
import { propMaterials, officeChair, desk, doorSlab, balloons } from './props.js';
import { spawnItems, spawnEmitters } from './common.js';
import { EMIT } from '../audio/ambience.js';

// LEVEL 4 — "Abandoned Office". The morning after the world ended. Cubicles,
// humming water coolers, steady lights. The windows look out onto white.

const N = 12, S = 3, H = 2.8, T = 0.2, CH = N * S;
const VOID = 1, CUBE = 2, OPENWIN = 4;

export class Level4 {
  constructor(game, seed) {
    this.game = game;
    this.seed = seed;
    this.id = 'level4';
    this.chunkSize = CH;
    this.floorY = 0;
    this.bakeOpts = { floorY: 0, ceilY: H, aoStrength: 0.8, wrap: 0.35 };
    this.materials = {
      ...propMaterials(),
      wall: worldMaterial({ map: tex('officewall'), tile: [2, 2.8] }),
      floor: worldMaterial({ map: tex('officecarpet'), tile: [2, 2] }),
      ceil: worldMaterial({ map: tex('ceiling0'), tile: [2.4, 2.4], tint: [0.95, 0.97, 1.0] }),
      panel: worldMaterial({ map: tex('panel'), tile: [1, 1], tint: [0.3, 0.3, 0.3] }),
      cooler: worldMaterial({ map: tex('white'), tile: [1, 1], tint: [0.35, 0.6, 0.85], emissive: [0.02, 0.04, 0.07] }),
    };
    this.config = {
      fogColor: [0.42, 0.43, 0.43],
      fogDensity: 0.012,
      fogLit: 0.5,
      ambient: [0.05, 0.05, 0.055],
      panelGain: 2.3,
      far: 140,
      post: { key: 0.24, grade: [0.98, 1.0, 1.03], sat: 0.7, contrast: 1.02, lift: 0.02, bloom: 0.9 },
      reverb: { small: 0.35, medium: 0.9, large: 1.8, damp: 4500, dampEnd: 1200, wet: 0.6 },
      hum: { bed: 0.02, voices: 0.045, pitch: 30, bright: 2000 },
      ambience: 'level4',
      card: { name: 'LEVEL 4', title: 'Abandoned Office', delay: 30, hint: 'One of the windows is open. You can feel the draft.' },
      noclip: { to: 'level37', after: 60, bump: 0.05, bumpMax: 0.35, ramp: 400, fall: 0.004, fallAfter: 150 },
      sanityAlone: 0.8,
      voidTex: ['officewall', 'officecarpet', 'cubicle'],
      director: {
        sounds: ['doorslam', 'knock', 'footsteps', 'voice_hello', 'creak'],
        lightEvents: true,
        humDrop: true,
        glimpse: ['faceling', 'faceling'],
        encounter: ['skinstealer', 'faceling'],
        glimpseAfter: 150,
        encounterAfter: 400,
        minGap: 60,
        tensionTime: 450,
      },
    };
  }

  spawn() {
    return { x: 5 * S + 1.5, y: 0, z: 5 * S + 1.5, yaw: 0.3 };
  }

  layout(cx, cz) {
    const seed = this.seed;
    const ox = cx * CH, oz = cz * CH;
    const rng = new RNG(hash32(seed, cx, cz, 44));
    const g = new Grid(N, S);
    applyBorders(g, seed, cx, cz, 0.7);
    const spawnChunk = cx === 0 && cz === 0;
    // the void: blocks of nothing, seen through windows
    const voids = [];
    for (let i = 0; i < rng.int(0, 3); i++) {
      const w = rng.int(2, 4), d = rng.int(2, 4);
      const x0 = rng.int(1, N - w - 1), z0 = rng.int(1, N - d - 1);
      if (spawnChunk && x0 <= 6 && x0 + w >= 4 && z0 <= 6 && z0 + d >= 4) continue;
      voids.push({ x0, z0, w, d });
      for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) g.solid[z * N + x] = 1;
    }
    // a few enclosed rooms: offices, a conference room
    if (rng.chance(0.6)) {
      const rx = rng.chance(0.5) ? 0 : N - 4, rz = rng.int(0, N - 4);
      bspRooms(g, rng, rx, rz, rx + 4, rz + 4, { minArea: 4, maxArea: 9, skip: 0 });
      for (let z = rz; z < rz + 4; z++) {
        if (!g.solid[z * N + rx]) g.vSet(rx, z, rx === 0 ? g.vGet(rx, z) : WALL);
        if (rx + 4 < N) g.vSet(rx + 4, z, WALL);
      }
      for (let x = rx; x < rx + 4; x++) {
        g.hSet(x, rz, rz === 0 ? g.hGet(x, rz) : WALL);
        g.hSet(x, rz + 4, WALL);
      }
      g.hSet(rx + 1 + rng.int(0, 2), rz + 4, OPEN);
    }
    // windows around void blocks
    for (const v of voids) {
      for (let x = v.x0; x < v.x0 + v.w; x++) {
        g.hSet(x, v.z0, WINDOW);
        g.hSet(x, v.z0 + v.d, WINDOW);
      }
      for (let z = v.z0; z < v.z0 + v.d; z++) {
        g.vSet(v.x0, z, WINDOW);
        g.vSet(v.x0 + v.w, z, WINDOW);
      }
      // no walls inside the void
      for (let z = v.z0; z < v.z0 + v.d; z++)
        for (let x = v.x0; x < v.x0 + v.w; x++) {
          if (z > v.z0) g.hSet(x, z, OPEN);
          if (x > v.x0) g.vSet(x, z, OPEN);
        }
    }
    ensureConnected(g, rng);
    const walls = wallBoxes(g, ox, oz, H, T);
    const boxes = walls.map((w) => w.box);
    // lights: a steady office grid; mostly fine
    const lights = [];
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        if (g.solid[z * N + x]) continue;
        const l = { x: ox + x * S + S / 2, y: H - 0.2, z: oz + z * S + S / 2, r: 8, color: [0.95, 0.97, 1.0], base: 0.95, flicker: FLICKER.NONE, dead: false, buzz: 0.6 };
        const r = rng.next();
        if (r < 0.04) l.dead = true;
        else if (r < 0.07) l.flicker = FLICKER.OCCASIONAL;
        lights.push(l);
      }
    // cubicle pods and desks in open cells
    const pods = [];
    const coolers = [];
    const items = [];
    const isOpenArea = (x, z) => !g.solid[z * N + x] && x > 0 && z > 0 && x < N - 1 && z < N - 1;
    for (let z = 1; z < N - 1; z += 2)
      for (let x = 1; x < N - 1; x += 2) {
        if (!isOpenArea(x, z) || !rng.chance(0.45)) continue;
        if (spawnChunk && Math.abs(x - 5) < 2 && Math.abs(z - 5) < 2) continue;
        const px = ox + x * S + S / 2, pz = oz + z * S + S / 2;
        pods.push({ x: px, z: pz, rot: rng.int(0, 2), chairs: [rng.next(), rng.next()], mon: rng.next() });
        // low partitions collide but don't block light
        boxes.push(box(px - 1.25, 0, pz - 0.04, px + 1.25, 1.35, pz + 0.04, { occ: false }));
        boxes.push(box(px - 0.04, 0, pz - 1.0, px + 0.04, 1.35, pz + 1.0, { occ: false }));
      }
    if (rng.chance(0.5)) {
      for (let i = 0; i < 10; i++) {
        const x = rng.int(0, N), z = rng.int(0, N);
        if (g.solid[z * N + x] || pods.some((p) => Math.abs(p.x - (ox + x * S + 1.5)) < 2 && Math.abs(p.z - (oz + z * S + 1.5)) < 2)) continue;
        const c = { x: ox + x * S + 0.5, z: oz + z * S + 0.5 };
        coolers.push(c);
        boxes.push(box(c.x - 0.18, 0, c.z - 0.18, c.x + 0.18, 1.4, c.z + 0.18, { occ: false }));
        break;
      }
    }
    for (const [type, p] of [['almond', 0.14], ['battery', 0.12], ['note', spawnChunk ? 0 : 0.14]]) {
      if (!rng.chance(p)) continue;
      for (let i = 0; i < 10; i++) {
        const x = rng.int(0, N), z = rng.int(0, N);
        if (g.solid[z * N + x]) continue;
        items.push({ type, x: ox + x * S + rng.range(0.4, 0.9), z: oz + z * S + rng.range(0.4, 0.9), rot: rng.next() * 6, id: `l4:${cx}:${cz}:${type}` });
        break;
      }
    }
    // the open window (exit to the Poolrooms), and rarely a party door
    const lt = this.game.levelTime || 0;
    const winWalls = walls.filter((w) => w.kind === WINDOW);
    let openWin = null;
    if (!spawnChunk && winWalls.length && rng.chance(0.5)) {
      const w = rng.pick(winWalls);
      openWin = { w, idx: rng.int(w.a, w.b + 1) };
    }
    let party = null;
    if (!spawnChunk && rng.chance(0.06) && lt >= 0) {
      const plain = walls.filter((w) => w.kind === WALL && w.b - w.a >= 1);
      if (plain.length) {
        const w = rng.pick(plain);
        party = { w, idx: rng.int(w.a, w.b + 1), side: rng.chance(0.5) ? 1 : -1 };
      }
    }
    return { grid: g, walls, boxes, lights, pods, coolers, items, openWin, party, voids, ox, oz };
  }

  build(lay, mb, world) {
    const { ox, oz, grid: g } = lay;
    const extra = [], inter = [], emitters = [];
    const rng = new RNG(hash32(this.seed, lay.cx, lay.cz, 45));
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        if (g.solid[z * N + x]) continue;
        const x0 = ox + x * S, z0 = oz + z * S;
        mb.flat('floor', x0, z0, x0 + S, z0 + S, 0, true, { step: 1 });
        mb.flat('ceil', x0, z0, x0 + S, z0 + S, H, false, { step: 1 });
      }
    for (const w of lay.walls) {
      const b = w.box;
      if (w.kind !== WINDOW) {
        mb.box('wall', b.minX, 0, b.minZ, b.maxX, H, b.maxZ, { faces: 'xXzZ', step: 1, vstep: 0.9 });
        continue;
      }
      // window wall: sill, header, mullions, and white nothing behind the glass
      mb.box('wall', b.minX, 0, b.minZ, b.maxX, 0.9, b.maxZ, { faces: 'xXzZY', step: 1, vstep: 0.9 });
      mb.box('wall', b.minX, 2.25, b.minZ, b.maxX, H, b.maxZ, { faces: 'xXzZy', step: 1 });
      const horiz = w.axis === 'h';
      const cz0 = (b.minZ + b.maxZ) / 2, cx0 = (b.minX + b.maxX) / 2;
      if (horiz) {
        mb.vface('p_whitevoid', b.minX, cz0, b.maxX, cz0, 0.9, 2.25, 0, 1, { sv: 1, step: 3 });
        mb.vface('p_whitevoid', b.maxX, cz0, b.minX, cz0, 0.9, 2.25, 0, -1, { sv: 1, step: 3 });
        for (let x = b.minX + T / 2; x <= b.maxX; x += S / 2) mb.box('p_metal', x - 0.04, 0.9, b.minZ, x + 0.04, 2.25, b.maxZ, { faces: 'xXzZ' });
      } else {
        mb.vface('p_whitevoid', cx0, b.maxZ, cx0, b.minZ, 0.9, 2.25, 1, 0, { sv: 1, step: 3 });
        mb.vface('p_whitevoid', cx0, b.minZ, cx0, b.maxZ, 0.9, 2.25, -1, 0, { sv: 1, step: 3 });
        for (let z = b.minZ + T / 2; z <= b.maxZ; z += S / 2) mb.box('p_metal', b.minX, 0.9, z - 0.04, b.maxX, 2.25, z + 0.04, { faces: 'xXzZ' });
      }
    }
    // ceiling panels
    for (const l of lay.lights) {
      const y = H - 0.008;
      mb.quad('panel', [l.x - 0.6, y, l.z - 0.3], [l.x + 0.6, y, l.z - 0.3], [l.x + 0.6, y, l.z + 0.3], [l.x - 0.6, y, l.z + 0.3], [0, -1, 0], [[0, 0], [0, 1], [1, 1], [1, 0]], { emit: l.slot, kind: 1, inset: 0 });
    }
    // cubicle pods
    for (const p of lay.pods) {
      mb.box('p_cubicle', p.x - 1.25, 0, p.z - 0.04, p.x + 1.25, 1.35, p.z + 0.04, { faces: 'xXzZY', step: 1.25, vstep: 0.7 });
      mb.box('p_cubicle', p.x - 0.04, 0, p.z - 1.0, p.x + 0.04, 1.35, p.z + 1.0, { faces: 'xXzZY', step: 1, vstep: 0.7 });
      const q = [[-0.65, -0.55, 0], [0.65, -0.55, 0], [-0.65, 0.55, 2], [0.65, 0.55, 2]];
      q.forEach(([dx, dz, rot], i) => {
        const dxx = p.x + dx, dzz = p.z + dz * 0.75;
        desk(mb, dxx, dzz + (rot === 0 ? -0.1 : 0.1), rot, []);
        // monitors, all off but one
        const mx = dxx, mz = dzz + (rot === 0 ? -0.25 : 0.25);
        mb.box('p_monitor', mx - 0.22, 0.78, mz - 0.03, mx + 0.22, 1.1, mz + 0.03, { faces: 'xXzZY' });
        if (i < 2 && p.chairs[i] > 0.3) officeChair(mb, dxx + (p.chairs[i] - 0.5) * 0.4, dzz + (rot === 0 ? 0.45 : -0.45), (rot + 2 + (p.chairs[i] > 0.8 ? 1 : 0)) % 4, []);
      });
      if (p.mon < 0.12) emitters.push({ x: p.x - 0.65, y: 0.95, z: p.z - 0.8, build: EMIT.monitor, opts: { range: 4, gain: 1 } });
    }
    for (const c of lay.coolers) {
      mb.box('p_white', c.x - 0.16, 0, c.z - 0.16, c.x + 0.16, 1.0, c.z + 0.16, { faces: 'xXzZY', step: 0.5 });
      mb.cylinder('cooler', c.x, 1.2, c.z, 'y', 0.13, 0.4, 10);
      emitters.push({ x: c.x, y: 0.8, z: c.z, build: EMIT.cooler, opts: { range: 12, gain: 0.25, reverb: 0.2 } });
    }
    if (lay.openWin) {
      const { w, idx } = lay.openWin;
      const b = w.box;
      let x, z, nx, nz;
      if (w.axis === 'h') {
        x = ox + idx * S + S / 2;
        z = (b.minZ + b.maxZ) / 2;
        nx = 0;
        nz = w.line < N && g.solid[w.line * N + idx] ? -1 : 1;
      } else {
        x = (b.minX + b.maxX) / 2;
        z = oz + idx * S + S / 2;
        nz = 0;
        nx = w.line < N && g.solid[idx * N + w.line] ? -1 : 1;
      }
      // a breeze, and the faint smell of chlorine
      emitters.push({ x, y: 1.5, z, build: EMIT.vent, opts: { range: 20, gain: 0.8 } });
      emitters.push({ x: x - nx * 2, y: 1.2, z: z - nz * 2, build: (ctx, out, a) => {
        const s = a.loopSource('loop_brown');
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 500;
        const gg = ctx.createGain();
        gg.gain.value = 0.25;
        s.connect(bp).connect(gg).connect(out);
        s.start();
        return () => s.stop();
      }, opts: { range: 10, gain: 0.4 } });
      inter.push({ x: x + nx * 0.4, y: 1.4, z: z + nz * 0.4, r: 2.2, prompt: 'Climb through the window', use: (game) => game.transitionTo('level37', { style: 'white' }) });
    }
    if (lay.party) {
      const { w, idx, side } = lay.party;
      const b = w.box;
      let x, z, nx = 0, nz = 0;
      if (w.axis === 'h') {
        x = ox + idx * S + S / 2;
        z = (b.minZ + b.maxZ) / 2 + side * T / 2;
        nz = side;
      } else {
        x = (b.minX + b.maxX) / 2 + side * T / 2;
        z = oz + idx * S + S / 2;
        nx = side;
      }
      doorSlab(mb, 'p_wood', x, z, nx, nz, 0.9, 2.05, 'p_metal');
      balloons(extra, x + nx * 0.3 + nz * 0.7, 2.0, z + nz * 0.3 + nx * 0.7, 3, rng, new THREE.Vector3(0.6, 0.6, 0.6));
      inter.push({ x: x + nx * 0.3, y: 1.1, z: z + nz * 0.3, r: 2.2, prompt: 'Open the door', use: (game) => game.transitionTo('levelFun', { style: 'fade' }) });
    }
    spawnItems(lay.items, world, this.game, extra, inter);
    return { extra, interactables: inter, dispose: spawnEmitters(emitters, this.game) };
  }

  surfaceAt() {
    return 'housecarpet';
  }
}
