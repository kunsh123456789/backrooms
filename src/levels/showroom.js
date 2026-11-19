import * as THREE from 'three';
import { RNG } from '../core/math.js';
import { worldMaterial } from '../gfx/materials.js';
import { tex } from '../gfx/textures.js';
import { FLICKER } from '../gfx/lights.js';
import { box } from '../world/world.js';
import { propMaterials, rbox, wallQuad } from './props.js';
import { spawnEmitters } from './common.js';
import { EMIT } from '../audio/ambience.js';

// The entrance: a furniture showroom after closing time. Display rooms with no
// one in them, a stockroom out back, stairs down to the basement. And at the far
// end of the basement, a doorway that was not there yesterday.
//
// (An original take on the premise of a doorway turning up in a furniture
// store's basement; nothing here is taken from any film.)

const GH = 3.6; // showroom ceiling
const BF = -3.2, BC = -0.4; // basement floor / ceiling
const T = 0.2;
const WARM = [1.0, 0.75, 0.48], COOL = [0.85, 0.92, 1.0], SODIUM = [1.0, 0.55, 0.22], YELLOW = [1.0, 0.9, 0.66];

// stairwell: ramp from (z 19, y 0) down to (z 25, y BF), x 21.6..23.4
const ST = { x0: 21.6, x1: 23.4, z0: 19, z1: 25 };
// the doorway and the hallway beyond it
const DOOR = { x0: 25, x1: 26, z: 40 };
const HALL = { x0: 24.5, x1: 26.5, z0: 40, z1: 50 };

export class Showroom {
  constructor(game, seed) {
    this.game = game;
    this.id = 'showroom';
    this.chunkSize = 400;
    this.finite = true;
    this.finiteRadius = 1;
    this.floorY = 0;
    this.bakeOpts = { floorY: 0, ceilY: GH, aoStrength: 0.8, wrap: 0.08 };
    this.materials = {
      ...propMaterials(),
      wall: worldMaterial({ map: tex('officewall'), tile: [2, 2.8], tint: [1.0, 0.98, 0.95] }),
      floor: worldMaterial({ map: tex('woodfloor'), tile: [3, 3], tint: [0.9, 0.85, 0.8] }),
      ceil: worldMaterial({ map: tex('ceiling0'), tile: [2.4, 2.4], tint: [1, 1, 0.98] }),
      panel: worldMaterial({ map: tex('panel'), tile: [1, 1], tint: [0.3, 0.3, 0.3] }),
      concrete: worldMaterial({ map: tex('concrete'), tile: [4, 4], tint: [0.85, 0.85, 0.82], wet: true }),
      block: worldMaterial({ map: tex('blockwall'), tile: [4, 4] }),
      bceil: worldMaterial({ map: tex('concrete'), tile: [4, 4], tint: [0.55, 0.55, 0.55] }),
      bulb: worldMaterial({ map: tex('white'), tint: [0.3, 0.3, 0.3] }),
      night: worldMaterial({ map: tex('white'), unlit: true, emissive: [0.03, 0.035, 0.06] }),
      // the Backrooms, leaking into the basement
      bwall: worldMaterial({ map: tex('wallpaper0'), tile: [4, 4.4] }),
      bfloor: worldMaterial({ map: tex('carpet0'), tile: [2, 2], wet: true }),
      bceil0: worldMaterial({ map: tex('ceiling0'), tile: [2, 2] }),
      rug: worldMaterial({ map: tex('fabric'), tile: [1.5, 1.5], tint: [0.9, 0.7, 0.55] }),
      tag: worldMaterial({ map: tex('white'), tint: [0.9, 0.9, 0.85] }),
      redtag: worldMaterial({ map: tex('white'), tint: [0.75, 0.1, 0.08] }),
    };
    this.config = {
      fogColor: [0.02, 0.02, 0.025],
      fogDensity: 0.025,
      fogLit: 0.4,
      ambient: [0.012, 0.012, 0.016],
      panelGain: 2.2,
      wetness: 0.4,
      post: { key: 0.22, grade: [1.04, 0.98, 0.9], sat: 0.75, contrast: 1.06, lift: 0.015, bloom: 0.85 },
      reverb: { small: 0.45, medium: 1.1, large: 1.9, damp: 4500, dampEnd: 1200, wet: 0.6 },
      hum: { bed: 0.02, voices: 0.06, pitch: 0, bright: 1500 },
      ambience: 'house',
      rumble: false,
      noSanity: true,
      card: null,
      // if you dawdle, the building lets you through anyway
      noclip: { to: 'level0', after: 300, bump: 0.25, bumpMax: 1, ramp: 120, message: "You've noclipped out of reality." },
      voidTex: ['officewall', 'woodfloor', 'wallpaper0', 'carpet0'],
    };
    this.dropped = false;
  }

  spawn() {
    return { x: 5.5, y: 0, z: 4.2, yaw: Math.PI * 0.85 };
  }

  layout(cx, cz) {
    if (cx !== 0 || cz !== 0) return null;
    const boxes = [], walls = [], lights = [];
    // wall from (x0,z0) to (x1,z1) with gaps; y range; material
    const W = (x0, z0, x1, z1, gaps = [], { y0 = 0, y1 = GH, mat = 'wall', header = 2.2 } = {}) => {
      const horiz = z0 === z1;
      const a0 = horiz ? x0 : z0, a1 = horiz ? x1 : z1;
      let cur = a0;
      const segs = [];
      for (const [ga, gb] of gaps.sort((p, q) => p[0] - q[0])) {
        if (ga > cur) segs.push([cur, ga, y0, y1]);
        if (header !== null && y0 + header < y1) segs.push([ga, gb, y0 + header, y1]);
        cur = gb;
      }
      if (cur < a1) segs.push([cur, a1, y0, y1]);
      for (const [a, b, ya, yb] of segs) {
        const bx = horiz ? box(a - T / 2, ya, z0 - T / 2, b + T / 2, yb, z0 + T / 2) : box(x0 - T / 2, ya, a - T / 2, x0 + T / 2, yb, b + T / 2);
        if (ya > y0) bx.col = bx.occ = false;
        boxes.push(bx);
        walls.push({ b: bx, mat });
      }
    };
    // --- showroom (x 0..24, z 0..18) ---
    W(0, 0, 24, 0); // front: windows are drawn onto it
    W(0, 0, 0, 18);
    W(24, 0, 24, 18);
    W(0, 18, 24, 18, [[19.6, 21.0]]); // EMPLOYEES ONLY door
    // a display room against the west wall: two walls and a doorway, like a stage set
    W(0.1, 8, 5, 8, [[3.4, 4.4]], { header: 2.4 });
    W(5, 8, 5, 13);
    // --- stockroom (x 14..24, z 18..25) ---
    W(14, 18, 14, 25);
    W(24, 18, 24, 25);
    W(14, 25, 24, 25);
    // stairwell walls run from the basement floor up to the stockroom ceiling
    W(ST.x0 - 0.1, ST.z0, ST.x0 - 0.1, ST.z1, [], { y0: BF });
    W(ST.x1 + 0.1, ST.z0, ST.x1 + 0.1, ST.z1, [], { y0: BF });
    // --- basement (x 14..30, z 25..40) ---
    const bo = { y0: BF, y1: BC, mat: 'block', header: null };
    W(14, 25, 14, 40, [], bo);
    W(30, 25, 30, 40, [], bo);
    W(14, 25, ST.x0 - 0.1, 25, [], bo);
    W(ST.x1 + 0.1, 25, 30, 25, [], bo);
    W(14, 40, 30, 40, [[DOOR.x0, DOOR.x1]], { ...bo, header: 2.1 });
    // a partition with shelving bays
    W(20, 31, 20, 36, [], bo);
    // --- the hallway that shouldn't be there ---
    const ho = { y0: BF, y1: BF + 2.7, mat: 'bwall', header: null };
    W(HALL.x0, HALL.z0, HALL.x0, HALL.z1, [], ho);
    W(HALL.x1, HALL.z0, HALL.x1, HALL.z1 - 2, [], ho);
    W(HALL.x0, HALL.z1, HALL.x1 + 4, HALL.z1, [], ho);
    W(HALL.x1, HALL.z1 - 2, HALL.x1 + 4, HALL.z1 - 2, [], ho);
    W(HALL.x1 + 4, HALL.z1 - 2, HALL.x1 + 4, HALL.z1, [], ho);

    // lights
    const L = (x, y, z, col, base, r, extra = {}) => {
      const l = { x, y, z, r, color: col, base, flicker: FLICKER.NONE, dead: false, ...extra };
      lights.push(l);
      return l;
    };
    const rng = new RNG(4242);
    // most of the showroom panels are off for the night; a few security lights stay on
    this.panels = [];
    for (let x = 3; x < 24; x += 4.5)
      for (let z = 3; z < 18; z += 4.5) {
        const on = (x === 7.5 && z === 7.5) || (x === 16.5 && z === 12) || (x === 21 && z === 16.5) || (x === 3 && z === 16.5);
        this.panels.push(L(x, GH - 0.25, z, COOL, on ? 0.75 : 0, 8, { dead: !on, band: [-0.2, 9], flicker: on && rng.chance(0.3) ? FLICKER.OCCASIONAL : FLICKER.NONE }));
      }
    // display lamps left on, warm pools in the dark
    this.lamps = [
      L(2.2, 1.55, 11.8, WARM, 0.75, 5, { silent: true, band: [-0.2, 9] }),
      L(12.8, 1.55, 5.2, WARM, 0.7, 5, { silent: true, band: [-0.2, 9] }),
      L(18.8, 1.55, 9.8, WARM, 0.65, 5, { silent: true, band: [-0.2, 9] }),
    ];
    // parking-lot light spilling through the windows
    for (const x of [4, 12, 20]) L(x, 2.4, 0.6, SODIUM, 0.35, 6, { silent: true, band: [-0.2, 9] });
    // stockroom: one tube
    L(18, GH - 0.25, 21.5, COOL, 0.8, 7, { band: [-0.2, 9], flicker: FLICKER.OCCASIONAL });
    // stairwell bulb
    L(22.5, 1.8, 22.5, WARM, 0.6, 6, { silent: true, band: [-3.4, 9] });
    // basement: bare bulbs, and one fluorescent tube that won't stay on
    this.bulbs = [L(17, BC - 0.35, 28, WARM, 0.7, 7, { silent: true, band: [-3.4, -0.2] }), L(26, BC - 0.35, 29, WARM, 0.55, 7, { silent: true, band: [-3.4, -0.2] }), L(17, BC - 0.35, 37, WARM, 0.45, 7, { silent: true, band: [-3.4, -0.2] })];
    L(25.5, BC - 0.15, 36.5, YELLOW, 0.9, 7, { band: [-3.4, -0.2], flicker: FLICKER.BAD, buzz: 2 });
    // beyond the doorway: steady, too bright, humming
    for (const z of [42, 46]) L(25.5, BF + 2.45, z, YELLOW, 1.15, 8, { band: [-3.4, -0.2], buzz: 1.6 });

    // furniture colliders (and their geometry descriptors)
    const furn = [];
    const F = (kind, x, z, rot, opts = {}) => furn.push({ kind, x, z, rot, ...opts });
    // living-room vignette
    F('sofa', 9.5, 5.5, 2);
    F('armchair', 12.5, 3.2, 3);
    F('coffee', 9.5, 3.6, 0);
    F('rug', 10.2, 4.2, 0, { w: 4.2, d: 3 });
    F('lamp', 12.8, 5.2, 0, { light: this.lamps[1] });
    // bedroom vignette inside the display room
    F('bed', 2.2, 10.6, 1);
    F('lamp', 2.2, 11.8, 0, { light: this.lamps[0] });
    F('rug', 2.6, 10.5, 0, { w: 3.6, d: 3.2 });
    // dining sets
    F('dining', 16, 4.5, 0);
    F('dining', 20.5, 4.5, 1);
    F('dining', 16, 8.5, 1);
    // a sofa facing a blank wall
    F('sofa', 22.4, 13, 1);
    F('lamp', 18.8, 9.8, 0, { light: this.lamps[2] });
    F('sofa', 14, 12.5, 2);
    F('armchair', 10, 13.5, 0);
    F('coffee', 14, 10.6, 0);
    F('rug', 13.6, 11.3, 0, { w: 4.4, d: 3.4 });
    // checkout counter
    F('counter', 4, 2.4, 0);
    // stockroom shelving with boxed furniture
    for (const z of [19.4, 21.6, 23.8]) F('shelf', 16.6, z, 0);
    F('boxes', 19.6, 23.6, 0);
    // basement clutter
    F('mattress', 16.2, 30, 1);
    F('mattress', 16.7, 30.2, 1);
    F('boxes', 22, 33, 0);
    F('boxes', 27.5, 27, 1);
    F('chairs', 17, 38, 0);
    F('heater', 28.6, 38.4, 0);
    F('shelf', 18.6, 33.5, 1);
    for (const f of furn) {
      const fp = FOOT[f.kind];
      if (!fp) continue;
      const [hw, hd, h] = fp;
      const swap = f.rot % 2 === 1;
      const y0 = f.z > 25 ? BF : 0;
      boxes.push(box(f.x - (swap ? hd : hw), y0, f.z - (swap ? hw : hd), f.x + (swap ? hd : hw), y0 + h, f.z + (swap ? hw : hd), { occ: false }));
    }
    return { boxes, walls, lights, furn, ox: 0, oz: 0 };
  }

  build(lay, mb) {
    const extra = [], inter = [], zones = [];
    for (const w of lay.walls) {
      const b = w.b;
      mb.box(w.mat, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, { faces: b.minY > (w.mat === 'wall' ? 0 : BF) + 0.01 ? 'xXzZy' : 'xXzZ', step: 1, vstep: 0.9 });
    }
    // floors and ceilings
    mb.flat('floor', 0, 0, 24, 18, 0, true, { step: 1.5 });
    mb.flat('ceil', 0, 0, 24, 18, GH, false, { step: 1.5 });
    // stockroom floor around the stair opening
    mb.flat('concrete', 14, 18, 24, ST.z0, 0, true, { step: 1.5 });
    mb.flat('concrete', 14, ST.z0, ST.x0 - 0.1, 25, 0, true, { step: 1.5 });
    mb.flat('concrete', ST.x1 + 0.1, ST.z0, 24, 25, 0, true, { step: 1.5 });
    mb.flat('bceil', 14, 18, 24, 25, GH, false, { step: 1.5 });
    // stairs: drawn as steps, walked as a ramp
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const za = ST.z0 + ((ST.z1 - ST.z0) * i) / steps, zb = ST.z0 + ((ST.z1 - ST.z0) * (i + 1)) / steps;
      const y = (BF * (i + 1)) / steps;
      mb.box('concrete', ST.x0, y - 0.05, za, ST.x1, y, zb, { faces: 'zY', step: 2 });
      mb.box('concrete', ST.x0, y, za - 0.001, ST.x1, y + BF / -steps, za, { faces: 'z', step: 2 });
    }
    zones.push({ minX: ST.x0, maxX: ST.x1, minZ: ST.z0, maxZ: ST.z1, type: 'ramp', axis: 'z', y0: 0, y1: BF, dir: 1 });
    // above the stair passage, where it ducks under the stockroom wall
    mb.vface('block', ST.x1 + 0.1, 25 - 0.1, ST.x0 - 0.1, 25 - 0.1, BC, GH, 0, -1, { sv: 2 });
    mb.flat('bceil', ST.x0, 24.2, ST.x1, 25, BC, false, { step: 1 });
    // basement
    zones.push({ minX: 14, maxX: 30, minZ: 25, maxZ: 40, type: 'floor', y: BF });
    mb.flat('concrete', 14, 25, 30, 40, BF, true, { step: 1.5 });
    mb.flat('bceil', 14, 25, 30, 40, BC, false, { step: 1.5 });
    // the hallway beyond the doorway: carpet, wallpaper, ceiling tiles
    zones.push({ minX: HALL.x0, maxX: HALL.x1 + 4, minZ: HALL.z0, maxZ: HALL.z1, type: 'floor', y: BF, surf: 'carpet' });
    mb.flat('bfloor', HALL.x0, HALL.z0, HALL.x1, HALL.z1, BF, true, { step: 1 });
    mb.flat('bfloor', HALL.x1, HALL.z1 - 2, HALL.x1 + 4, HALL.z1, BF, true, { step: 1 });
    mb.flat('bceil0', HALL.x0, HALL.z0, HALL.x1, HALL.z1, BF + 2.7, false, { step: 1 });
    mb.flat('bceil0', HALL.x1, HALL.z1 - 2, HALL.x1 + 4, HALL.z1, BF + 2.7, false, { step: 1 });
    // the doorway itself has no frame, no door: the block wall just stops
    for (const l of lay.lights) {
      if (l.y > BF && l.y < BC && l.color === YELLOW) {
        const y = l.y < BF + 2.6 ? BF + 2.692 : BC - 0.01;
        mb.quad('panel', [l.x - 0.3, y, l.z - 0.6], [l.x + 0.3, y, l.z - 0.6], [l.x + 0.3, y, l.z + 0.6], [l.x - 0.3, y, l.z + 0.6], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], { emit: l.slot, kind: 1, inset: 0 });
      }
    }
    // showroom ceiling panels (most dark tonight)
    for (const l of this.panels) {
      const y = GH - 0.008;
      mb.quad('panel', [l.x - 0.6, y, l.z - 0.3], [l.x + 0.6, y, l.z - 0.3], [l.x + 0.6, y, l.z + 0.3], [l.x - 0.6, y, l.z + 0.3], [0, -1, 0], [[0, 0], [0, 1], [1, 1], [1, 0]], { emit: l.slot, kind: 1, inset: 0 });
    }
    for (const b of this.bulbs) {
      mb.box('bulb', b.x - 0.05, b.y - 0.07, b.z - 0.05, b.x + 0.05, b.y + 0.05, b.z + 0.05, { faces: 'xXzZy', emit: b.slot });
      mb.box('p_black', b.x - 0.005, b.y + 0.05, b.z - 0.005, b.x + 0.005, BC, b.z + 0.005, { faces: 'xXzZ' });
    }
    // front windows onto the dark parking lot, and the locked glass doors
    for (const x of [1, 6.5, 14.5, 19]) wallQuad(mb, 'night', x + 2, 0.3, T / 2, 4, 2.9, 0, 1, 0.004);
    wallQuad(mb, 'night', 12, 0, T / 2, 1.8, 2.4, 0, 1, 0.006);
    // exit signs: front doors and the back
    wallQuad(mb, 'p_exit', 12, 2.75, T / 2, 0.42, 0.16, 0, 1, 0.03);
    // EMPLOYEES ONLY, over the doorway to the back
    wallQuad(mb, 'tag', 20.3, 2.3, 18 - T / 2, 0.6, 0.18, 0, -1, 0.02);
    // furniture
    for (const f of lay.furn) this._furniture(mb, f);
    // emitters: HVAC, the stockroom tube, and the hum coming through the doorway
    const em = [
      { x: 12, y: 3.2, z: 9, build: EMIT.vent, opts: { range: 14, gain: 0.25 } },
      { x: 25.5, y: BF + 1.5, z: 44, build: EMIT.hum, opts: { range: 18, gain: 0.35, reverb: 0.4 } },
    ];
    const dispose = spawnEmitters(em, this.game);
    return { extra, interactables: inter, zones, dispose };
  }

  _furniture(mb, f) {
    const y0 = f.z > 25 ? BF : 0;
    const R = (key, a, b, c, d, e, g, o) => rbox(mb, key, f.x, f.z, f.rot, a, y0 + b, c, d, y0 + e, g, o);
    switch (f.kind) {
      case 'sofa':
        R('p_couch', -1.1, 0, -0.45, 1.1, 0.42, 0.45);
        R('p_couch', -1.1, 0.42, 0.25, 1.1, 0.85, 0.45);
        R('p_couch', -1.1, 0.42, -0.45, -0.9, 0.62, 0.25);
        R('p_couch', 0.9, 0.42, -0.45, 1.1, 0.62, 0.25);
        R('redtag', 0.6, 0.43, -0.2, 0.75, 0.431, -0.1, { faces: 'Y' });
        break;
      case 'armchair':
        R('p_fabric', -0.45, 0, -0.45, 0.45, 0.42, 0.45);
        R('p_fabric', -0.45, 0.42, 0.25, 0.45, 0.9, 0.45);
        R('p_fabric', -0.45, 0.42, -0.45, -0.32, 0.6, 0.25);
        R('p_fabric', 0.32, 0.42, -0.45, 0.45, 0.6, 0.25);
        break;
      case 'coffee':
        R('p_wood', -0.6, 0.38, -0.35, 0.6, 0.44, 0.35);
        for (const [x, z] of [[-0.55, -0.3], [0.5, -0.3], [-0.55, 0.25], [0.5, 0.25]]) R('p_wood', x, 0, z, x + 0.05, 0.38, z + 0.05);
        R('tag', 0.3, 0.441, 0.1, 0.45, 0.442, 0.2, { faces: 'Y' });
        break;
      case 'rug':
        mb.flat('rug', f.x - f.w / 2, f.z - f.d / 2, f.x + f.w / 2, f.z + f.d / 2, y0 + 0.004, true, { step: 1 });
        break;
      case 'lamp':
        R('p_metal', -0.03, 0, -0.03, 0.03, 1.4, 0.03);
        R('p_metal', -0.18, 0, -0.18, 0.18, 0.03, 0.18);
        R('bulb', -0.2, 1.4, -0.2, 0.2, 1.7, 0.2, { emit: f.light.slot });
        break;
      case 'bed':
        R('p_wood', -0.85, 0, -1.05, 0.85, 0.35, 1.05);
        R('p_white', -0.8, 0.35, -1.0, 0.8, 0.55, 1.0);
        R('p_couch', -0.8, 0.55, -0.4, 0.8, 0.58, 1.0);
        R('p_wood', -0.85, 0, -1.1, 0.85, 1.1, -1.05);
        break;
      case 'dining':
        R('p_wood', -0.8, 0.72, -0.5, 0.8, 0.77, 0.5);
        for (const [x, z] of [[-0.75, -0.45], [0.7, -0.45], [-0.75, 0.4], [0.7, 0.4]]) R('p_wood', x, 0, z, x + 0.05, 0.72, z + 0.05);
        for (const [x, z, r] of [[-0.4, -0.75, 0], [0.4, -0.75, 0], [-0.4, 0.75, 2], [0.4, 0.75, 2]]) {
          const [cx, cz] = rot(f.x, f.z, f.rot, x, z);
          rbox(mb, 'p_wood', cx, cz, (f.rot + r) % 4, -0.2, y0 + 0.43, -0.2, 0.2, y0 + 0.47, 0.2);
          rbox(mb, 'p_wood', cx, cz, (f.rot + r) % 4, -0.2, y0 + 0.47, -0.22, 0.2, y0 + 0.95, -0.18);
          rbox(mb, 'p_metal', cx, cz, (f.rot + r) % 4, -0.02, y0, -0.02, 0.02, y0 + 0.43, 0.02);
        }
        R('redtag', -0.1, 0.771, -0.05, 0.1, 0.772, 0.05, { faces: 'Y' });
        break;
      case 'counter':
        R('p_wood', -1.6, 0, -0.35, 1.6, 1.0, 0.35);
        R('p_white', -1.65, 1.0, -0.4, 1.65, 1.05, 0.4);
        R('p_dark', -0.5, 1.05, -0.2, -0.1, 1.25, 0.15);
        R('p_monitor', 0.4, 1.05, 0, 0.8, 1.4, 0.05);
        break;
      case 'shelf':
        R('p_metal', -1.5, 0, -0.45, -1.45, 2.4, 0.45);
        R('p_metal', 1.45, 0, -0.45, 1.5, 2.4, 0.45);
        for (const y of [0.1, 1.0, 1.9]) R('p_metal', -1.5, y, -0.45, 1.5, y + 0.04, 0.45);
        R('p_crate', -1.3, 0.14, -0.4, -0.2, 0.9, 0.4);
        R('p_crate', 0.1, 1.04, -0.4, 1.3, 1.6, 0.4);
        R('p_crate', -1.2, 1.94, -0.35, 0.3, 2.3, 0.35);
        break;
      case 'boxes':
        R('p_crate', -0.6, 0, -0.5, 0.5, 0.8, 0.5);
        R('p_crate', -0.4, 0.8, -0.4, 0.4, 1.4, 0.35);
        R('p_crate', 0.6, 0, -0.4, 1.3, 0.6, 0.4);
        break;
      case 'mattress':
        R('p_fabric', -1.0, 0, -0.12, 1.0, 1.9, 0.12);
        break;
      case 'chairs':
        for (let i = 0; i < 5; i++) R('p_wood', -0.22, i * 0.12, -0.22 - i * 0.02, 0.22, i * 0.12 + 0.05, 0.22 - i * 0.02);
        R('p_wood', -0.22, 0.05, 0.2, 0.22, 1.2, 0.24);
        break;
      case 'heater':
        mb.cylinder('p_white', f.x, y0 + 0.8, f.z, 'y', 0.3, 1.6, 12);
        R('p_metal', -0.03, 1.6, -0.03, 0.03, BC - BF, 0.03);
        break;
      default:
        break;
    }
  }

  extraExits() {
    const p = this.game.player.pos;
    if (p.y > -1 && p.z < 25) return [{ x: (ST.x0 + ST.x1) / 2, z: ST.z0 + 0.5, label: 'the basement stairs' }];
    return [{ x: (DOOR.x0 + DOOR.x1) / 2, z: DOOR.z, label: 'the doorway' }];
  }

  surfaceAt(x, z, world, zone) {
    if (zone && zone.surf) return zone.surf;
    if (z > 18) return 'concrete';
    return 'wood';
  }

  onEnter(game) {
    this.t = 0;
    game.audio.fadeWorld(1, 3);
  }

  update(dt, game) {
    this.t += dt;
    const p = game.player;
    if (this.t > 4 && !this.told) {
      this.told = true;
      game.ui.showMessage('Closing time. Someone left a light on in the basement.', 7);
    }
    // through the doorway, a few steps in, and you're somewhere else
    if (!this.dropped && p.pos.z > DOOR.z + 2.2 && p.pos.y < -1) {
      this.dropped = true;
      game.dropInto('level0', 'The doorway is gone behind you.');
    }
  }
}

// footprints for colliders: half-width, half-depth, height
const FOOT = {
  sofa: [1.1, 0.45, 0.85], armchair: [0.45, 0.45, 0.9], coffee: [0.6, 0.35, 0.45], bed: [0.85, 1.1, 0.6], dining: [0.8, 0.5, 0.8],
  counter: [1.65, 0.4, 1.1], shelf: [1.5, 0.45, 2.4], boxes: [1.3, 0.5, 1.4], mattress: [1.0, 0.12, 1.9], chairs: [0.25, 0.25, 1.2], heater: [0.3, 0.3, 1.6],
};

function rot(cx, cz, r, lx, lz) {
  r = ((r % 4) + 4) % 4;
  if (r === 0) return [cx + lx, cz + lz];
  if (r === 1) return [cx - lz, cz + lx];
  if (r === 2) return [cx - lx, cz - lz];
  return [cx + lz, cz - lx];
}

void THREE;
