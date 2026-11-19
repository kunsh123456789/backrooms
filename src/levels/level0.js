import * as THREE from 'three';
import { RNG, hash32, hashf, fbm2 } from '../core/math.js';
import { worldMaterial } from '../gfx/materials.js';
import { tex } from '../gfx/textures.js';
import { FLICKER } from '../gfx/lights.js';
import { box } from '../world/world.js';
import { Grid, applyBorders, bspRooms, ensureConnected, wallBoxes, wallDirs } from './grid.js';
import { districtOf, generateRooms, longhall, ROOM, HMAX } from './level0gen.js';
import { dynMat, propMaterials, officeChair, wetSign, outlet, wallQuad, windowToNowhere, phone, shoe, vent, stairsToCeiling } from './props.js';
import { spawnItems, spawnEmitters } from './common.js';
import { EMIT } from '../audio/ambience.js';

// LEVEL 0 — "The Lobby".
// Endless mono-yellow rooms, damp carpet, buzzing lights. Almost nothing happens.

const N = 16, S = 2, H = 2.7, T = 0.2, CH = N * S;
const LIGHT_COL = [1.0, 0.9, 0.66];
const WHITE = [1, 1, 1], MANILA_TINT = [1.05, 0.86, 0.62], RED_TINT = [1.15, 0.32, 0.26];
const WET = 1, LIT = 2, HOLE = 4, CORR = 8, DARK = 16, MANILA = 32, RED = 64, DARKROOM = 128;

export class Level0 {
  constructor(game, seed, opts = {}) {
    this.game = game;
    this.seed = seed;
    this.id = 'level0';
    this.chunkSize = CH;
    this.floorY = 0;
    this.ceilY = H;
    this.versions = new Map();
    this.visited = new Set();
    this.menu = !!opts.menu;
    this.anom = new Map();
    this.darkTime = 0;
    this.exitTriggered = false;
    this.bakeOpts = { floorY: 0, ceilY: H, aoStrength: 1, wrap: 0.35, ceilAt: (x, z) => this.ceilAt(x, z) };
    this.materials = {
      ...propMaterials(),
      wall: worldMaterial({ map: tex('wallpaper0'), tile: [4, HMAX], breathe: true }),
      soffit: worldMaterial({ map: tex('plaster'), tile: [2, 2], tint: [1.0, 0.92, 0.7] }),
      floor: worldMaterial({ map: tex('carpet0'), tile: [2, 2], wet: true }),
      ceil: worldMaterial({ map: tex('ceiling0'), tile: [2, 2] }),
      panel: worldMaterial({ map: tex('panel'), tile: [1, 1], tint: [0.35, 0.35, 0.33] }),
      pit: worldMaterial({ map: tex('black'), unlit: true, emissive: [0, 0, 0] }),
    };
    this.config = {
      fogColor: [0.6, 0.52, 0.3],
      fogDensity: 0.03,
      fogLit: 0.85,
      ambient: [0.035, 0.03, 0.018],
      panelGain: 2.4,
      wetness: 0.5,
      post: { key: 0.3, grade: [1.05, 1.0, 0.84], sat: 0.8, contrast: 1.06, lift: 0.01, bloom: 0.75 },
      reverb: { small: 0.35, medium: 0.9, large: 2.2, damp: 4500, dampEnd: 900, wet: 0.75 },
      hum: { bed: 0.05, voices: 0.11, pitch: 0, bright: 1600 },
      ambience: 'level0',
      card: { name: 'LEVEL 0', title: 'The Lobby', delay: 45, hint: 'Somewhere the lights have died. There is a way down in the dark. Hold H to find it.' },
      noclip: { to: 'level1', after: 120, bump: 0.04, bumpMax: 0.3, ramp: 600, fall: 0.004, fallAfter: 240 },
      sanityAlone: 1,
      director: {
        sounds: ['doorslam', 'thump', 'drag', 'knock', 'voice_murmur', 'footsteps', 'creak_door', 'thump'],
        lightEvents: true,
        humDrop: true,
        glimpse: ['faceling', 'smiler'],
        encounter: ['smiler'],
        glimpseAfter: 660,
        encounterAfter: 1100,
        minGap: 55,
        tensionTime: 420,
      },
    };
  }

  spawn() {
    return { x: 7 * S + 1, y: 0, z: 7 * S + 1, yaw: Math.PI * 0.25 };
  }

  darkness(x, z) {
    // continuous world-space field: pockets where the lights have failed
    if (this.menu) return 0;
    const d0 = Math.hypot(x - 15, z - 15);
    if (d0 < 55) return 0;
    const t = this.game.levelTime || 0;
    const thr = Math.max(0.62, 0.72 - Math.max(0, t - 240) / 6000);
    const n = fbm2(x / 40, z / 40, this.seed + 77, 3);
    return n > thr ? Math.min(1, (n - thr) / 0.05) : 0;
  }

  layout(cx, cz) {
    const k = cx + ',' + cz;
    const ver = this.versions.get(k) || 0;
    const seed = this.seed;
    const ox = cx * CH, oz = cz * CH;
    // identical rooms repeating: sometimes a chunk's interior copies its neighbour's
    let icx = cx, icz = cz, iver = ver;
    if (!this.menu && hashf(seed, cx, cz, 99) < 0.07 && !(cx === 0 && cz === 0)) {
      icx = cx - 1;
      iver = this.versions.get(icx + ',' + icz) || 0;
    }
    const rng = new RNG(hash32(seed, icx, icz, iver * 1013 + 7));
    const g = new Grid(N, S);
    applyBorders(g, seed, cx, cz, 0.45);
    let district = districtOf(seed, icx, icz);
    if (cx === 0 && cz === 0) district = 'mixed';
    if (this.menu) district = cx === 0 ? 'longhall' : 'halls';
    let anomaly = null;
    let rooms = [], roomOf = null, cellH = new Float32Array(N * N).fill(H), gridPillars = [];
    if (district === 'longhall') {
      const r = longhall(g, rng, bspRooms);
      for (let x = 0; x < N; x++) g.cell[r * N + x] |= CORR;
      anomaly = { r, x0: 3, x1: N - 3, ox, oz };
    } else {
      const res = generateRooms(g, rng, district, { spawn: cx === 0 && cz === 0 });
      rooms = res.rooms;
      roomOf = res.roomOf;
      cellH = res.cellH;
      gridPillars = res.pillars;
      for (const rm of rooms) {
        const flag = rm.special === 'manila' ? MANILA : rm.special === 'red' ? RED : rm.dark ? DARKROOM : 0;
        if (!flag) continue;
        for (let z = rm.z; z < rm.z + rm.h; z++) for (let x = rm.x; x < rm.x + rm.w; x++) g.cell[z * N + x] |= flag;
      }
    }
    ensureConnected(g, rng);
    // walls are all built full height; lower rooms simply hide the top above their ceiling
    const walls = wallBoxes(g, ox, oz, HMAX, T);
    const boxes = walls.map((w) => w.box);
    const roomAt = (x, z) => (roomOf && roomOf[z * N + x] >= 0 ? rooms[roomOf[z * N + x]] : null);

    // pillars in the big halls
    const pillars = [];
    for (const [x, z] of gridPillars) {
      const px = ox + x * S, pz = oz + z * S;
      const b = box(px - 0.3, 0, pz - 0.3, px + 0.3, HMAX, pz + 0.3);
      boxes.push(b);
      pillars.push(b);
    }

    // wet patches
    for (let i = 0; i < 2; i++) {
      if (!rng.chance(0.35)) continue;
      const wx = rng.int(0, N), wz = rng.int(0, N), rr = rng.int(1, 3);
      for (let z = wz - rr; z <= wz + rr; z++)
        for (let x = wx - rr; x <= wx + rr; x++) if (g.inside(x, z) && !(g.cell[z * N + x] & CORR) && rng.chance(0.75)) g.cell[z * N + x] |= WET;
    }

    // --- lights: each kind of room is lit its own way ---
    const lights = [];
    const lmap = new Int16Array(N * N).fill(-1);
    const off = (cx + cz) & 1;
    const axis = rng.chance(0.5) ? 'x' : 'z';
    const addLight = (x, z) => {
      const lx = ox + x * S + S / 2, lz = oz + z * S + S / 2;
      const dk = this.darkness(lx, lz);
      const c = g.cell[z * N + x];
      const corr = c & CORR;
      const ch = cellH[z * N + x];
      const tall = ch > 3.2;
      const l = { x: lx, y: ch - 0.25, z: lz, ceil: ch, r: tall ? 9.5 : 7.5, color: LIGHT_COL, base: corr ? 1 : rng.range(0.85, 1.05) * (tall ? 1.25 : 1), flicker: FLICKER.NONE, dead: false, axis, cell: z * N + x };
      if (c & MANILA) {
        // the manila room: one warm lamp, steady, almost cosy
        l.color = [1.0, 0.8, 0.55];
        l.base = 0.85;
      } else if (c & RED) {
        l.color = [1.0, 0.2, 0.14];
        l.base = 0.65;
        l.flicker = FLICKER.OCCASIONAL;
      } else if (corr) {
        l.flicker = FLICKER.NONE;
      } else if (dk > 0.5) {
        l.dead = rng.chance(0.9);
        if (!l.dead) l.flicker = FLICKER.DYING;
        g.cell[z * N + x] |= DARK;
      } else if (!this.menu) {
        const r = rng.next();
        if (r < 0.035) l.dead = true;
        else if (r < 0.1) l.flicker = FLICKER.OCCASIONAL;
        else if (r < 0.12) l.flicker = FLICKER.BAD;
        else if (r < 0.13) l.flicker = FLICKER.DYING;
        if (dk > 0) {
          l.flicker = rng.chance(0.5) ? FLICKER.BAD : FLICKER.DYING;
          g.cell[z * N + x] |= DARK;
        }
      }
      // the occasional panel that buzzes louder than the rest
      l.buzz = !corr && rng.chance(0.15) ? 2.2 : 1;
      lmap[z * N + x] = lights.length;
      lights.push(l);
      g.cell[z * N + x] |= LIT;
    };
    const centreLit = (rm) => rm && (rm.special || rm.type === ROOM.SMALL);
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        const c = g.cell[z * N + x];
        if (c & DARKROOM) continue;
        const rm = roomAt(x, z);
        let on;
        if (c & CORR) on = x % 2 === 0;
        else if (centreLit(rm)) on = x === rm.x + (rm.w >> 1) && z === rm.z + (rm.h >> 1);
        else if (rm && rm.type === ROOM.CORRIDOR) on = rm.w === 1 ? (z + off) % 2 === 0 : (x + off) % 2 === 0;
        else if (rm) on = (x - rm.x + off) % 2 === 0 && (z - rm.z + off) % 2 === 0;
        else on = (x + off) % 2 === 0 && (z + off) % 2 === 0;
        if (on) addLight(x, z);
      }
    // coverage: every ordinary cell within one open step of a light
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        if (lmap[z * N + x] >= 0 || g.cell[z * N + x] & (DARKROOM | MANILA | RED)) continue;
        if (centreLit(roomAt(x, z))) continue;
        let ok = false;
        for (let d = 0; d < 4 && !ok; d++) {
          if (g.blocked(x, z, d)) continue;
          const nx = x + [0, 1, 0, -1][d], nz = z + [-1, 0, 1, 0][d];
          if (g.inside(nx, nz) && lmap[nz * N + nx] >= 0) ok = true;
        }
        if (!ok) addLight(x, z);
      }

    // --- features (rare, small) ---
    const features = [];
    const items = [];
    const zones = [];
    const used = new Set();
    const freeCell = (tries = 30, needWall = false) => {
      for (let i = 0; i < tries; i++) {
        const x = rng.int(0, N), z = rng.int(0, N);
        const c = z * N + x;
        if (used.has(c) || g.cell[c] & (CORR | HOLE)) continue;
        if (needWall && !wallDirs(g, x, z).length) continue;
        used.add(c);
        return [x, z];
      }
      return null;
    };
    const spawnSafe = cx === 0 && cz === 0;
    if (!this.menu) {
      const feats = ['outlet', 'outlet', 'vent', 'vent', 'chair', 'wetsign', 'exit', 'window', 'doorwall', 'phone', 'shoe', 'tile', 'stairs', 'outletrow'];
      const nf = rng.chance(0.55) ? 1 : rng.chance(0.3) ? 2 : 0;
      for (let i = 0; i < nf; i++) {
        const f = rng.pick(feats);
        if (f === 'stairs' && (spawnSafe || !rng.chance(0.5))) continue;
        const c = freeCell(30, f !== 'chair' && f !== 'wetsign' && f !== 'shoe' && f !== 'tile');
        if (!c) continue;
        const [x, z] = c;
        const dirs = wallDirs(g, x, z);
        features.push({ type: f, x, z, dir: dirs.length ? rng.pick(dirs) : 0, a: rng.next(), b: rng.next() });
      }
      if (spawnSafe) features.push({ type: 'outlet', x: 7, z: 7, dir: wallDirs(g, 7, 7)[0] ?? 0, a: 0.2, b: 0.4 });
      // pickups
      const pick = (type, p) => {
        if (!rng.chance(p)) return;
        const c = freeCell();
        if (!c) return;
        items.push({ type, x: ox + c[0] * S + rng.range(0.4, 1.6), z: oz + c[1] * S + rng.range(0.4, 1.6), rot: rng.next() * 6, id: `l0:${cx}:${cz}:${type}:${ver}` });
      };
      pick('almond', 0.16);
      pick('battery', 0.13);
      pick('note', spawnSafe ? 0 : 0.11);
    }

    // --- exit: a dark hole in the floor, deep inside the failed lights ---
    let hole = null;
    const forced = Math.abs(cx) + Math.abs(cz) === 1; // an exit is always one chunk away from where you arrive
    if (!this.menu && !spawnSafe && (forced || rng.chance(0.4))) {
      const cands = [];
      for (let z = 2; z < N - 2; z++) for (let x = 2; x < N - 2; x++) if (!(g.cell[z * N + x] & CORR)) cands.push(z * N + x);
      if (cands.length) {
        const c = rng.pick(cands);
        const x = c % N, z = (c / N) | 0;
        g.cell[c] |= HOLE;
        // the lights around it have died
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const cc = (z + dz) * N + x + dx;
            g.cell[cc] |= DARK;
            if (lmap[cc] >= 0) lights[lmap[cc]].dead = true;
          }
        if (lmap[c] < 0) addLight(x, z);
        // ...except one, failing, right over the hole: you can see it flicker from far away
        if (lmap[c] >= 0) {
          const l = lights[lmap[c]];
          l.dead = false;
          l.flicker = FLICKER.DYING;
          l.base = 1.3;
          l.buzz = 2.5;
        }
        hole = { x, z };
        const hx0 = ox + x * S, hz0 = oz + z * S;
        zones.push({ minX: hx0 + 0.25, maxX: hx0 + S - 0.25, minZ: hz0 + 0.25, maxZ: hz0 + S - 0.25, type: 'hole', exit: 'level1' });
      }
    }

    // stairs features generate zones/boxes in layout so colliders exist before build
    for (const f of features) {
      if (f.type === 'stairs') {
        f.rot = f.dir === 0 ? 0 : f.dir === 1 ? 1 : f.dir === 2 ? 2 : 3;
      }
      if (f.type === 'chair') {
        const px = ox + f.x * S + 1, pz = oz + f.z * S + 1;
        boxes.push(box(px - 0.3, 0, pz - 0.3, px + 0.3, 1, pz + 0.3, { occ: false }));
      }
    }

    return { grid: g, walls, boxes, lights, features, items, zones, hole, anomaly, ox, oz, pillars, version: ver, cellH, rooms, roomOf, district };
  }

  build(lay, mb, world) {
    const g = lay.grid, ox = lay.ox, oz = lay.oz;
    const rng = new RNG(hash32(this.seed, lay.cx, lay.cz, 55));
    const extra = [], inter = [], emitters = [], colliders = [];
    const zones = [...lay.zones];
    // floors + ceilings per cell
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        const c = g.cell[z * N + x];
        const x0 = ox + x * S, z0 = oz + z * S;
        const corr = c & CORR;
        const v = corr ? 1 : 0.94 + rng.next() * 0.1;
        const wet = c & WET;
        let col = wet ? [v * 0.78, v * 0.75, v * 0.68] : [v, v * 0.99, v * 0.97];
        if (c & MANILA) col = [v * 0.8, v * 0.66, v * 0.5];
        if (c & RED) col = [v * 0.75, v * 0.42, v * 0.38];
        const ch = lay.cellH[z * N + x];
        if (!(c & HOLE)) mb.flat('floor', x0, z0, x0 + S, z0 + S, 0, true, { step: 1, col });
        mb.flat('ceil', x0, z0, x0 + S, z0 + S, ch, false, { step: 1, col: corr ? [1, 1, 1] : [v, v, v * 0.98] });
        // soffits: where the ceiling steps up into a taller room, a face hangs down from it
        for (let d = 0; d < 4; d++) {
          if (g.blocked(x, z, d)) continue;
          const nx = x + [0, 1, 0, -1][d], nz = z + [-1, 0, 1, 0][d];
          const inside = nx >= 0 && nz >= 0 && nx < N && nz < N;
          const top = inside ? lay.cellH[nz * N + nx] : HMAX;
          if (top <= ch + 0.01) continue;
          if (d === 0) mb.vface('soffit', x0 + S, z0, x0, z0, ch, top, 0, -1, { sv: 1, step: 1 });
          else if (d === 2) mb.vface('soffit', x0, z0 + S, x0 + S, z0 + S, ch, top, 0, 1, { sv: 1, step: 1 });
          else if (d === 3) mb.vface('soffit', x0, z0, x0, z0 + S, ch, top, -1, 0, { sv: 1, step: 1 });
          else mb.vface('soffit', x0 + S, z0 + S, x0 + S, z0, ch, top, 1, 0, { sv: 1, step: 1 });
        }
        if (c & HOLE) {
          // the pit: black all the way down
          mb.vface('pit', x0, z0, x0 + S, z0, -12, 0, 0, 1, { su: 1, sv: 1 });
          mb.vface('pit', x0 + S, z0 + S, x0, z0 + S, -12, 0, 0, -1, { su: 1, sv: 1 });
          mb.vface('pit', x0, z0 + S, x0, z0, -12, 0, 1, 0, { su: 1, sv: 1 });
          mb.vface('pit', x0 + S, z0, x0 + S, z0 + S, -12, 0, -1, 0, { su: 1, sv: 1 });
          mb.flat('pit', x0, z0, x0 + S, z0 + S, -12, true, { step: 2 });
          emitters.push({ x: x0 + S / 2, y: -0.5, z: z0 + S / 2, build: EMIT.pit, opts: { range: 26, gain: 0.7, reverb: 0.5 } });
          // ragged carpet edge
          for (let i = 0; i < 4; i++) {
            const e = 0.08 + rng.next() * 0.15;
            mb.flat('floor', x0, z0, x0 + S, z0 + e, 0.002, true, { step: 2, col: [0.5, 0.45, 0.35] });
            mb.flat('floor', x0, z0 + S - e, x0 + S, z0 + S, 0.002, true, { step: 2, col: [0.5, 0.45, 0.35] });
          }
        }
      }
    // walls
    for (const w of lay.walls) this._wall(mb, w, lay);
    for (const p of lay.pillars) mb.box('wall', p.minX, 0, p.minZ, p.maxX, HMAX, p.maxZ, { faces: 'xXzZ', step: 1, vstep: 0.9 });
    // light panels
    for (const l of lay.lights) {
      const hw = l.axis === 'x' ? 0.6 : 0.3, hd = l.axis === 'x' ? 0.3 : 0.6;
      const y = (l.ceil ?? H) - 0.008;
      const uvs = l.axis === 'x' ? [[0, 0], [0, 1], [1, 1], [1, 0]] : [[0, 0], [1, 0], [1, 1], [0, 1]];
      mb.quad('panel', [l.x - hw, y, l.z - hd], [l.x + hw, y, l.z - hd], [l.x + hw, y, l.z + hd], [l.x - hw, y, l.z + hd], [0, -1, 0], uvs, { emit: l.slot, kind: 1, inset: 0 });
    }
    // features
    for (const f of lay.features) this._feature(f, lay, mb, extra, inter, emitters, zones, world, rng, colliders);
    spawnItems(lay.items, world, this.game, extra, inter);
    const disposeEm = spawnEmitters(emitters, this.game);
    return { extra, interactables: inter, zones, colliders, dispose: disposeEm, update: this._doorUpdater(extra) };
  }

  /** A wall run, emitted face by face so each side can take its room's tint. */
  _wall(mb, w, lay) {
    const b = w.box, g = lay.grid;
    const tint = (x, z) => {
      if (x < 0 || z < 0 || x >= N || z >= N) return WHITE;
      const c = g.cell[z * N + x];
      return c & MANILA ? MANILA_TINT : c & RED ? RED_TINT : WHITE;
    };
    const o = { step: 1, vstep: 0.9 };
    if (w.axis === 'h') {
      for (let x = w.a; x <= w.b; x++) {
        const xa = x === w.a ? b.minX : lay.ox + x * S, xb = x === w.b ? b.maxX : lay.ox + (x + 1) * S;
        mb.vface('wall', xb, b.minZ, xa, b.minZ, 0, HMAX, 0, -1, { ...o, col: tint(x, w.line - 1) });
        mb.vface('wall', xa, b.maxZ, xb, b.maxZ, 0, HMAX, 0, 1, { ...o, col: tint(x, w.line) });
      }
      mb.vface('wall', b.minX, b.minZ, b.minX, b.maxZ, 0, HMAX, -1, 0, o);
      mb.vface('wall', b.maxX, b.maxZ, b.maxX, b.minZ, 0, HMAX, 1, 0, o);
    } else {
      for (let z = w.a; z <= w.b; z++) {
        const za = z === w.a ? b.minZ : lay.oz + z * S, zb = z === w.b ? b.maxZ : lay.oz + (z + 1) * S;
        mb.vface('wall', b.minX, za, b.minX, zb, 0, HMAX, -1, 0, { ...o, col: tint(w.line - 1, z) });
        mb.vface('wall', b.maxX, zb, b.maxX, za, 0, HMAX, 1, 0, { ...o, col: tint(w.line, z) });
      }
      mb.vface('wall', b.maxX, b.minZ, b.minX, b.minZ, 0, HMAX, 0, -1, o);
      mb.vface('wall', b.minX, b.maxZ, b.maxX, b.maxZ, 0, HMAX, 0, 1, o);
    }
  }

  /** Ceiling height at a world point (for baking ambient occlusion). */
  ceilAt(x, z) {
    const w = this.game.world;
    const [cx, cz] = w.chunkOf(x, z);
    const lay = w.layouts.get(cx + ',' + cz);
    if (!lay || !lay.cellH) return H;
    const gx = Math.floor((x - lay.ox) / S), gz = Math.floor((z - lay.oz) / S);
    if (gx < 0 || gz < 0 || gx >= N || gz >= N) return H;
    return lay.cellH[gz * N + gx];
  }

  _wallFace(x, z, dir, ox, oz) {
    // centre of the wall face of cell (x,z) in direction dir, and its inward normal
    const cx = ox + x * S + S / 2, cz = oz + z * S + S / 2;
    if (dir === 0) return [cx, oz + z * S + T / 2, 0, 1];
    if (dir === 2) return [cx, oz + (z + 1) * S - T / 2, 0, -1];
    if (dir === 3) return [ox + x * S + T / 2, cz, 1, 0];
    return [ox + (x + 1) * S - T / 2, cz, -1, 0];
  }

  _feature(f, lay, mb, extra, inter, emitters, zones, world, rng, colliders) {
    const { ox, oz } = lay;
    const [wx, wz, nx, nz] = this._wallFace(f.x, f.z, f.dir, ox, oz);
    const tx = -nz, tz = nx;
    const along = (f.a - 0.5) * 1.0;
    const px = wx + tx * along, pz = wz + tz * along;
    const cxm = ox + f.x * S + 1, czm = oz + f.z * S + 1;
    switch (f.type) {
      case 'outlet': {
        // outlets at heights that make no sense
        const y = f.b < 0.4 ? 2.35 : f.b < 0.7 ? 0.04 : 1.7;
        outlet(mb, px, y, pz, nx, nz);
        break;
      }
      case 'outletrow':
        for (let i = 0; i < 6; i++) outlet(mb, wx + tx * (i - 2.5) * 0.28, 0.32, wz + tz * (i - 2.5) * 0.28, nx, nz);
        break;
      case 'vent':
        vent(mb, px, 2.2, pz, nx, nz);
        emitters.push({ x: px, y: 2.3, z: pz, build: EMIT.vent, opts: { range: 9, gain: 0.35 } });
        break;
      case 'chair':
        officeChair(mb, cxm, czm, Math.floor(f.a * 4), []);
        break;
      case 'wetsign':
        wetSign(mb, cxm + (f.a - 0.5), czm + (f.b - 0.5), f.a * 6.28);
        break;
      case 'shoe':
        shoe(mb, cxm + (f.a - 0.5) * 1.2, czm + (f.b - 0.5) * 1.2, Math.floor(f.b * 4));
        break;
      case 'exit': {
        // an exit sign pointing straight into a wall
        const sx = wx + tx * 0.7, sz = wz + tz * 0.7;
        wallQuad(mb, 'p_exit', sx, 2.2, sz, 0.42, 0.16, nx, nz, 0.02, [[0, 0], [1, 0], [1, 1], [0, 1]]);
        break;
      }
      case 'window':
        windowToNowhere(mb, px, pz, nx, nz);
        break;
      case 'phone':
        phone(mb, px, pz, nx, nz);
        emitters.push({ x: px + nx * 0.1, y: 0.45, z: pz + nz * 0.1, build: EMIT.dialtone, opts: { range: 10, gain: 0.5, reverb: 0.2 } });
        break;
      case 'tile': {
        // a fallen ceiling tile and the black square above it
        const tx0 = cxm + (f.a - 0.5) * 0.6, tz0 = czm + (f.b - 0.5) * 0.6;
        mb.box('ceil', tx0 - 0.3, 0, tz0 - 0.3, tx0 + 0.3, 0.02, tz0 + 0.3, { faces: 'xXzZY', topStep: 1 });
        mb.flat('pit', cxm - 0.25 - 0.5, czm - 0.25, cxm + 0.25 - 0.5, czm + 0.25, lay.cellH[f.z * N + f.x] - 0.003, false, { step: 1 });
        break;
      }
      case 'stairs': {
        // stairs that climb into the ceiling
        const rot = f.dir;
        const sx = wx + nx * 0.0, sz = wz + nz * 0.0;
        const st = stairsToCeiling(mb, sx, sz, rot, lay.cellH[f.z * N + f.x], 'p_wood');
        for (const zz of st.zones) zones.push(zz);
        for (const b of st.boxes) colliders.push(b);
        break;
      }
      case 'doorwall': {
        // a door that opens onto more wall
        const dw = 0.9, dh = 2.05;
        // frame
        const fx = (o, y0, w, h) => {
          const cx = px + tx * o + nx * 0.025, cz = pz + tz * o + nz * 0.025;
          const hw = Math.abs(tx) > 0.5 ? w / 2 : 0.025, hd = Math.abs(tz) > 0.5 ? w / 2 : 0.025;
          mb.box('p_wood', cx - hw, y0, cz - hd, cx + hw, y0 + h, cz + hd, { faces: 'xXzZYy' });
        };
        fx(-dw / 2 - 0.04, 0, 0.08, dh + 0.06);
        fx(dw / 2 + 0.04, 0, 0.08, dh + 0.06);
        fx(0, dh, dw + 0.16, 0.08);
        // the door itself (dynamic: it can open)
        const door = makeDoor(this.game, px - tx * dw / 2 + nx * 0.03, pz - tz * dw / 2 + nz * 0.03, tx, tz, nx, nz, dw, dh);
        extra.push(door.mesh);
        inter.push({
          x: px + nx * 0.4, y: 1.1, z: pz + nz * 0.4, r: 1.7, prompt: 'Open door',
          use: (game) => {
            if (door.open) return;
            door.open = true;
            game.audio.playAt('creak', door.mesh.position, { gain: 0.5, reverb: 0.4 });
            if (game.director) game.director.note('doorwall');
          },
        });
        this._doors = this._doors || [];
        this._doors.push(door);
        break;
      }
      default:
        break;
    }
  }

  _doorUpdater(extra) {
    const doors = (this._doors || []).filter((d) => extra.includes(d.mesh));
    if (!doors.length) return null;
    return (dt) => {
      for (const d of doors) {
        if (d.open && d.ang < 1.75) {
          d.ang = Math.min(1.75, d.ang + dt * 1.2);
          d.mesh.rotation.y = d.baseRot + d.ang * d.sign;
        }
      }
    };
  }

  onChunkUnloaded(cx, cz) {
    // The Backrooms shift when you aren't looking: rooms you walked through
    // may not be the same when you come back.
    const k = cx + ',' + cz;
    if (this.menu || !this.visited.has(k) || (cx === 0 && cz === 0)) return;
    if (hashf(this.seed, cx, cz, (this.versions.get(k) || 0) + 300) < 0.4) {
      this.versions.set(k, (this.versions.get(k) || 0) + 1);
      this.visited.delete(k);
    }
  }

  exitsOf(lay) {
    return lay.hole ? [{ x: lay.ox + lay.hole.x * S + S / 2, z: lay.oz + lay.hole.z * S + S / 2, label: 'a hole in the floor' }] : [];
  }

  surfaceAt(x, z, world, zone) {
    if (zone && zone.surf) return zone.surf;
    const [cx, cz] = world.chunkOf(x, z);
    const lay = world.layouts.get(cx + ',' + cz);
    if (!lay) return 'carpet';
    const gx = Math.floor((x - lay.ox) / S), gz = Math.floor((z - lay.oz) / S);
    if (gx < 0 || gz < 0 || gx >= N || gz >= N) return 'carpet';
    return lay.grid.cell[gz * N + gx] & WET ? 'wetcarpet' : 'carpet';
  }

  update(dt, game) {
    const p = game.player;
    const world = game.world;
    const [cx, cz] = world.chunkOf(p.pos.x, p.pos.z);
    this.visited.add(cx + ',' + cz);
    if (this.menu) return;
    // fell through the hole
    if (p.pos.y < -3 && !this.exitTriggered) {
      this.exitTriggered = true;
      game.dropInto('level1');
      return;
    }
    // a long walk through failed lights is a way out too
    const l = game.localLight;
    if (l < 0.035 && p.moving) this.darkTime += dt;
    else this.darkTime = Math.max(0, this.darkTime - dt * (l > 0.15 ? 3 : 0.5));
    if (this.darkTime > 26 && game.levelTime > 200 && !this.exitTriggered) {
      this.exitTriggered = true;
      game.dropInto('level1');
      return;
    }
    this._anomaly(dt, game, world, cx, cz);
  }

  _anomaly(dt, game, world, cx, cz) {
    const lay = world.layouts.get(cx + ',' + cz);
    const p = game.player;
    if (!lay || !lay.anomaly) return;
    const a = lay.anomaly;
    const zc = a.oz + a.r * S + S / 2;
    const xa = a.ox + a.x0 * S, xb = a.ox + a.x1 * S;
    const k = lay.key;
    let st = this.anom.get(k);
    if (!st) this.anom.set(k, (st = { first: 0, back: 0, shifts: 0, prevIn: false, entry: 0 }));
    const inside = Math.abs(p.pos.z - zc) < 0.85 && p.pos.x > xa && p.pos.x < xb;
    if (inside && !st.prevIn) {
      st.entry = p.pos.x < (xa + xb) / 2 ? 1 : -1;
      st.back = 0;
      st.shifts = 0;
    }
    if (!inside && st.prevIn) {
      // left through the far end: that was a full traversal
      const exitSide = p.pos.x >= xb ? 1 : p.pos.x <= xa ? -1 : 0;
      if (exitSide !== 0 && exitSide === st.entry && !st.first) st.first = st.entry;
    }
    st.prevIn = inside;
    if (!inside || !st.first) return;
    const dirMove = Math.sign(p.vel.x);
    if (dirMove !== -st.first || Math.abs(p.vel.x) < 0.5) return;
    st.back += Math.abs(p.vel.x) * dt;
    const farEnd = st.first > 0 ? xa : xb; // walking back toward where they started
    const distToFar = Math.abs(p.pos.x - farEnd);
    if (st.back > 6.5 && st.shifts < 3 && distToFar > 7) {
      // shift them back one light period (4 m). The corridor is identical every 4 m.
      p.pos.x += st.first * 4;
      st.back = 0;
      st.shifts++;
      if (st.shifts === 3 && game.director) game.director.note('longhall');
    }
  }
}

function makeDoor(game, hx, hz, tx, tz, nx, nz, w, h) {
  // hinge at (hx,hz); door extends along tangent
  return _door(game, hx, hz, tx, tz, nx, nz, w, h);
}

const _v = new THREE.Vector3();
function _door(game, hx, hz, tx, tz, nx, nz, w, h) {
  const geo = new THREE.BoxGeometry(w, h, 0.045);
  geo.translate(w / 2, h / 2, 0);
  const s = game.lights.sample(hx + nx * 0.6, 1.3, hz + nz * 0.6, _v);
  const mesh = new THREE.Mesh(geo, dynMat(tex('wood'), s.multiplyScalar(0.85)));
  mesh.position.set(hx, 0, hz);
  const baseRot = Math.atan2(-tz, tx);
  mesh.rotation.y = baseRot;
  // opening swings toward the room (normal side)
  const sign = 1;
  return { mesh, open: false, ang: 0, baseRot, sign };
}
