import * as THREE from 'three';
import { RNG, hash32, fbm2 } from '../core/math.js';
import { worldMaterial, waterMaterial } from '../gfx/materials.js';
import { tex } from '../gfx/textures.js';
import { FLICKER } from '../gfx/lights.js';
import { box } from '../world/world.js';
import { Grid, applyBorders, ensureConnected, wallBoxes, OPEN, WALL } from './grid.js';
import { propMaterials, wallQuad, doorSlab, balloons } from './props.js';
import { spawnItems, spawnEmitters } from './common.js';
import { EMIT } from '../audio/ambience.js';

// LEVEL 1 — "Habitable Zone". A concrete parking structure that never ends.
// Pillars march off into cold fog. Lights in patches. Puddles. Crates nobody stocked.

const N = 16, S = 3, H = 4.2, T = 0.3, CH = N * S;
const COL = [0.82, 0.92, 1.0];

export class Level1 {
  constructor(game, seed) {
    this.game = game;
    this.seed = seed;
    this.id = 'level1';
    this.chunkSize = CH;
    this.floorY = 0;
    this.bakeOpts = { floorY: 0, ceilY: H, aoStrength: 0.8, wrap: 0.3 };
    this.materials = {
      ...propMaterials(),
      wall: worldMaterial({ map: tex('blockwall'), tile: [4, 4] }),
      pillar: worldMaterial({ map: tex('pillar'), tile: [0.8, 4.2] }),
      floor: worldMaterial({ map: tex('concrete'), tile: [5, 5], wet: true }),
      ceil: worldMaterial({ map: tex('concrete'), tile: [6, 6], tint: [0.7, 0.72, 0.75] }),
      tube: worldMaterial({ map: tex('panel'), tile: [1, 1], tint: [0.3, 0.3, 0.3] }),
      paint: worldMaterial({ map: tex('concrete'), tile: [3, 3], tint: [1.6, 1.4, 0.6] }),
      puddle: waterMaterial([0.12, 0.13, 0.14]),
      door: worldMaterial({ map: tex('metal'), tile: [1, 1], tint: [0.6, 0.65, 0.7] }),
    };
    this.config = {
      fogColor: [0.16, 0.19, 0.22],
      fogDensity: 0.024,
      fogLit: 0.7,
      ambient: [0.02, 0.024, 0.03],
      panelGain: 2.6,
      wetness: 0.9,
      far: 160,
      post: { key: 0.22, grade: [0.92, 0.98, 1.06], sat: 0.6, contrast: 1.1, lift: 0.012, bloom: 0.8 },
      reverb: { small: 1.0, medium: 2.6, large: 5.0, damp: 5000, dampEnd: 700, wet: 1.1 },
      hum: { bed: 0.025, voices: 0.07, pitch: -40, bright: 1200 },
      ambience: 'level1',
      card: { name: 'LEVEL 1', title: 'Habitable Zone', delay: 30, hint: 'Follow the green exit signs to the stairwells. They go down.' },
      noclip: { to: 'level2', after: 60, bump: 0.05, bumpMax: 0.35, ramp: 400, fall: 0.004, fallAfter: 150 },
      sanityAlone: 1,
      roomScale: 1.3,
      voidTex: ['concrete', 'blockwall', 'pillar'],
      director: {
        sounds: ['clank', 'doorslam', 'drag', 'thump', 'footsteps', 'voice_hello', 'creak'],
        lightEvents: true,
        humDrop: true,
        glimpse: ['faceling', 'faceling', 'hound'],
        encounter: ['hound', 'skinstealer'],
        glimpseAfter: 200,
        encounterAfter: 380,
        encounterGap: 420,
        minGap: 45,
        tensionTime: 320,
      },
    };
  }

  spawn() {
    return { x: 7 * S + 1.5, y: 0, z: 7 * S + 1.5, yaw: 0.6 };
  }

  layout(cx, cz) {
    const seed = this.seed;
    const ox = cx * CH, oz = cz * CH;
    const rng = new RNG(hash32(seed, cx, cz, 11));
    const g = new Grid(N, S);
    applyBorders(g, seed, cx, cz, 0.8);
    // a few long block walls
    for (let i = 0; i < rng.int(0, 4); i++) {
      const len = rng.int(3, 9);
      const horiz = rng.chance(0.5);
      const a = rng.int(0, N - len), line = rng.int(1, N - 1);
      const gap = a + rng.int(0, len);
      for (let j = a; j < a + len; j++) {
        if (j === gap) continue;
        horiz ? g.hSet(j, line, WALL) : g.vSet(line, j, WALL);
      }
    }
    ensureConnected(g, rng);
    const walls = wallBoxes(g, ox, oz, H, T);
    const boxes = walls.map((w) => w.box);
    // pillars on a global 6m grid
    const pillars = [];
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        const gx = cx * N + x, gz = cz * N + z;
        if (gx % 2 === 0 && gz % 2 === 0) {
          const px = ox + x * S, pz = oz + z * S;
          const b = box(px - 0.4, 0, pz - 0.4, px + 0.4, H, pz + 0.4);
          boxes.push(b);
          pillars.push(b);
        }
      }
    // lights: hanging tubes on the 6m grid between pillars, in patches
    const lights = [];
    const spawnChunk = cx === 0 && cz === 0;
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        const gx = cx * N + x, gz = cz * N + z;
        if (gx % 2 !== 1 || gz % 2 !== 1) continue;
        const lx = ox + x * S, lz = oz + z * S;
        const n = fbm2(lx / 30, lz / 30, seed + 5, 3);
        const l = { x: lx, y: H - 0.65, z: lz, r: 9, color: COL, base: rng.range(0.9, 1.15), flicker: FLICKER.NONE, dead: false, buzz: 1 };
        const near = spawnChunk && Math.hypot(lx - 22.5, lz - 22.5) < 12;
        if (!near) {
          if (n > 0.56) l.dead = rng.chance(0.92);
          else if (n > 0.5) l.flicker = FLICKER.DYING;
          const r = rng.next();
          if (r < 0.12) l.dead = true;
          else if (r < 0.24) l.flicker = FLICKER.OCCASIONAL;
          else if (r < 0.28) l.flicker = FLICKER.BAD;
        }
        lights.push(l);
      }
    // features
    const lt = this.game.levelTime || 0;
    const puddles = [];
    for (let i = 0; i < rng.int(2, 7); i++) {
      const w = rng.range(0.8, 3.5), d = rng.range(0.8, 3);
      puddles.push({ x0: ox + rng.range(1, CH - 5), z0: oz + rng.range(1, CH - 5), w, d });
    }
    const crates = [];
    const items = [];
    const used = [];
    const freeSpot = () => {
      for (let i = 0; i < 20; i++) {
        const x = ox + rng.range(4, CH - 4), z = oz + rng.range(4, CH - 4);
        // keep away from pillars and other things
        const px = Math.round((x - ox) / 6) * 6 + ox, pz = Math.round((z - oz) / 6) * 6 + oz;
        if (Math.hypot(x - px, z - pz) < 1.6) continue;
        if (used.some(([ux, uz]) => Math.hypot(ux - x, uz - z) < 4)) continue;
        used.push([x, z]);
        return [x, z];
      }
      return null;
    };
    if (rng.chance(0.55)) {
      const sp = freeSpot();
      if (sp) {
        const n = rng.int(1, 4);
        const c = { x: sp[0], z: sp[1], n, id: `l1:crate:${cx}:${cz}`, rot: rng.next() };
        crates.push(c);
        boxes.push(box(c.x - 0.5, 0, c.z - 0.5, c.x + 0.5, 0.9, c.z + 0.5, { occ: false }));
      }
    }
    const pick = (type, p) => {
      if (!rng.chance(p)) return;
      const sp = freeSpot();
      if (sp) items.push({ type, x: sp[0], z: sp[1], rot: rng.next() * 6, id: `l1:${cx}:${cz}:${type}` });
    };
    pick('almond', 0.12);
    pick('battery', 0.14);
    pick('note', spawnChunk ? 0 : 0.12);
    // structures: the stairwell down, and (rarely) a door with balloons
    const structs = [];
    void lt;
    if (!spawnChunk && rng.chance(0.38)) structs.push({ kind: 'stairs' });
    else if (!spawnChunk && rng.chance(0.08)) structs.push({ kind: 'party' });
    for (const s of structs) {
      const sp = freeSpot();
      if (!sp) continue;
      // snap to between pillars
      s.x = ox + (Math.floor((sp[0] - ox) / 6) * 6 + 3);
      s.z = oz + (Math.floor((sp[1] - oz) / 6) * 6 + 3);
      s.dir = rng.int(0, 4);
      boxes.push(box(s.x - 1.4, 0, s.z - 1.4, s.x + 1.4, H, s.z + 1.4));
      if (s.kind === 'stairs') {
        const d = [[0, -1], [1, 0], [0, 1], [-1, 0]][s.dir];
        lights.push({ x: s.x + d[0] * 1.7, y: 2.5, z: s.z + d[1] * 1.7, r: 5, color: [0.25, 1, 0.4], base: 0.9, flicker: FLICKER.NONE, dead: false, silent: true });
      }
    }
    return { grid: g, walls, boxes, lights, pillars, puddles, crates, items, structs, ox, oz };
  }

  build(lay, mb, world) {
    const { ox, oz } = lay;
    const extra = [], inter = [], zones = [], emitters = [];
    const rng = new RNG(hash32(this.seed, lay.cx, lay.cz, 77));
    // big floor / ceiling slabs per cell
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        const x0 = ox + x * S, z0 = oz + z * S;
        const v = 0.9 + rng.next() * 0.15;
        mb.flat('floor', x0, z0, x0 + S, z0 + S, 0, true, { step: 1.5, col: [v, v, v] });
        mb.flat('ceil', x0, z0, x0 + S, z0 + S, H, false, { step: 1.5 });
      }
    for (const w of lay.walls) mb.box('wall', w.box.minX, 0, w.box.minZ, w.box.maxX, H, w.box.maxZ, { faces: 'xXzZ', step: 1.5, vstep: 1.4 });
    for (const p of lay.pillars) mb.box('pillar', p.minX, 0, p.minZ, p.maxX, H, p.maxZ, { faces: 'xXzZ', step: 0.8, vstep: 1.4 });
    // parking bay lines
    const rows = [lay.oz + 6 * Math.floor(rng.range(1, 7)), lay.oz + 6 * Math.floor(rng.range(1, 7))];
    for (const rz of rows) {
      for (let x = ox + 1; x < ox + CH - 1; x += 2.6) mb.flat('paint', x, rz + 0.5, x + 0.1, rz + 2.9, 0.004, true, { step: 3 });
    }
    // hanging tubes
    for (const l of lay.lights) {
      const y = l.y;
      mb.box('tube', l.x - 0.7, y - 0.04, l.z - 0.12, l.x + 0.7, y + 0.04, l.z + 0.12, { faces: 'y', emit: l.slot });
      mb.box('p_metal', l.x - 0.72, y + 0.04, l.z - 0.14, l.x + 0.72, y + 0.1, l.z + 0.14, { faces: 'xXzZy' });
      for (const sx of [-0.6, 0.6]) mb.box('p_metal', l.x + sx - 0.006, y + 0.1, l.z - 0.006, l.x + sx + 0.006, H, l.z + 0.006, { faces: 'xX' });
    }
    // puddles
    for (const p of lay.puddles) {
      const geo = new THREE.PlaneGeometry(p.w, p.d, 1, 1).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, this.materials.puddle);
      m.position.set(p.x0 + p.w / 2, 0.006, p.z0 + p.d / 2);
      extra.push(m);
      zones.push({ minX: p.x0, maxX: p.x0 + p.w, minZ: p.z0, maxZ: p.z0 + p.d, type: 'surface', surf: 'water' });
    }
    // crates
    for (const c of lay.crates) {
      for (let i = 0; i < c.n; i++) {
        const s = 0.9 - i * 0.12, y = i === 0 ? 0 : 0.9 - (i - 1) * 0.1;
        const yy = i === 0 ? 0 : i === 1 ? 0.9 : 1.68;
        mb.box('p_crate', c.x - s / 2, yy, c.z - s / 2, c.x + s / 2, yy + s, c.z + s / 2, { faces: 'xXzZY', step: 1 });
        void y;
      }
      if (!world.taken.has(c.id)) {
        const it = {
          x: c.x, y: 0.9, z: c.z, r: 2.2, prompt: 'Search the crate',
          use: (game) => {
            world.taken.add(c.id);
            game.audio.playAt('creak', new THREE.Vector3(c.x, 0.8, c.z), { gain: 0.5, rate: 1.3 });
            game.pickup('supplies');
            inter.splice(inter.indexOf(it), 1);
            const i2 = world.interactables.indexOf(it);
            if (i2 >= 0) world.interactables.splice(i2, 1);
          },
        };
        inter.push(it);
      }
    }
    // structures
    for (const s of lay.structs) {
      mb.box('wall', s.x - 1.4, 0, s.z - 1.4, s.x + 1.4, H, s.z + 1.4, { faces: 'xXzZ', step: 1.4, vstep: 1.4 });
      const d = [[0, -1], [1, 0], [0, 1], [-1, 0]][s.dir];
      const fx = s.x + d[0] * 1.4, fz = s.z + d[1] * 1.4;
      if (s.kind === 'stairs') {
        doorSlab(mb, 'door', fx, fz, d[0], d[1], 0.95, 2.1, 'p_metal');
        wallQuad(mb, 'p_exit', fx, 2.4, fz, 0.42, 0.16, d[0], d[1], 0.03);
        mb.flat('paint', fx + d[0] * 0.5 - 0.6, fz + d[1] * 0.5 - 0.6, fx + d[0] * 0.5 + 0.6, fz + d[1] * 0.5 + 0.6, 0.004, true, { step: 2 });
        emitters.push({ x: fx + d[0] * 0.3, y: 1.5, z: fz + d[1] * 0.3, build: EMIT.vent, opts: { range: 24, gain: 0.6, reverb: 0.8 } });
        inter.push({ x: fx + d[0] * 0.3, y: 1.1, z: fz + d[1] * 0.3, r: 2.2, prompt: 'Go down the stairs', use: (game) => game.transitionTo('level2', { style: 'stairs' }) });
      } else {
        doorSlab(mb, 'p_wood', fx, fz, d[0], d[1], 0.9, 2.05, 'p_white');
        balloons(extra, fx + d[0] * 0.25 + d[1] * 0.7, 2.3, fz + d[1] * 0.25 + d[0] * 0.7, 4, rng, new THREE.Vector3(0.25, 0.25, 0.25));
        inter.push({ x: fx + d[0] * 0.3, y: 1.1, z: fz + d[1] * 0.3, r: 2.2, prompt: 'Open the door', use: (game) => game.transitionTo('levelFun', { style: 'fade' }) });
        emitters.push({ x: fx, y: 1.2, z: fz, opts: { range: 16, gain: 1 }, build: (ctx, out) => {
          // muffled music behind the door
          const o = ctx.createOscillator();
          o.type = 'square';
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 400;
          const gg = ctx.createGain();
          gg.gain.value = 0.03;
          o.connect(lp).connect(gg).connect(out);
          o.start();
          const notes = [523, 659, 784, 659, 698, 880, 784, 659];
          let i = 0;
          const iv = setInterval(() => o.frequency.setValueAtTime(notes[i++ % notes.length], ctx.currentTime), 520);
          return () => { o.stop(); clearInterval(iv); };
        } });
      }
    }
    spawnItems(lay.items, world, this.game, extra, inter);
    return { extra, interactables: inter, zones, dispose: spawnEmitters(emitters, this.game) };
  }

  surfaceAt(x, z, world, zone) {
    if (zone && zone.surf) return zone.surf;
    return 'concrete';
  }
}
