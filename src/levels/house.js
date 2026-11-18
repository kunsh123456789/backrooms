import * as THREE from 'three';
import { RNG } from '../core/math.js';
import { worldMaterial, G } from '../gfx/materials.js';
import { tex } from '../gfx/textures.js';
import { FLICKER } from '../gfx/lights.js';
import { box } from '../world/world.js';
import { propMaterials, rbox, wallQuad, dynMat } from './props.js';
import { spawnEmitters } from './common.js';
import { EMIT } from '../audio/ambience.js';

// The opening: a suburban house at 3 AM. Warm, quiet, a little lonely.
// Tiny wrongnesses: the hallway is longer than the house should allow, the hall
// closet goes back much too far, the pantry opens onto the kitchen you're standing
// in, and the clock doesn't always keep time. Then you walk into a corner.

const H = 2.5, T = 0.12;
const KDZ = 4.7; // kitchen depth: the pantry leads to a copy offset by this much

export class House {
  constructor(game, seed, opts = {}) {
    this.game = game;
    this.id = opts.wrong ? 'housewrong' : 'house';
    this.wrong = !!opts.wrong;
    this.chunkSize = 400;
    this.finite = true;
    this.finiteRadius = 1;
    this.floorY = 0;
    this.bakeOpts = { floorY: 0, ceilY: H, aoStrength: 0.9, wrap: 0.3 };
    this.materials = {
      ...propMaterials(),
      wall: worldMaterial({ map: tex('housewall'), tile: [2, 2.5] }),
      wallWrong: worldMaterial({ map: tex('wallpaper0'), tile: [4, 2.7] }),
      carpet: worldMaterial({ map: tex('housecarpet'), tile: [1.5, 1.5] }),
      wood: worldMaterial({ map: tex('woodfloor'), tile: [3, 3] }),
      tile: worldMaterial({ map: tex('kitchentile'), tile: [1.2, 1.2] }),
      ceil: worldMaterial({ map: tex('plaster'), tile: [2, 2] }),
      lampglow: worldMaterial({ map: tex('white'), tint: [0.3, 0.3, 0.3] }),
      night: worldMaterial({ map: tex('white'), unlit: true, emissive: this.wrong ? [0.9, 0.8, 0.45] : [0.018, 0.028, 0.06] }),
      led: worldMaterial({ map: tex('white'), unlit: true, emissive: [1.5, 0.05, 0.02] }),
    };
    this.config = {
      fogColor: [0.01, 0.012, 0.018],
      fogDensity: 0.03,
      fogLit: 0.3,
      ambient: [0.01, 0.012, 0.02],
      panelGain: 1.4,
      post: { key: 0.24, grade: [1.06, 0.96, 0.86], sat: 0.78, contrast: 1.05, lift: 0.018, bloom: 0.8 },
      reverb: { small: 0.28, medium: 0.55, large: 0.9, damp: 5000, dampEnd: 1500, wet: 0.45 },
      hum: { bed: 0, voices: 0 },
      ambience: 'house',
      rumble: false,
      noSanity: true,
      card: null,
      noclip: opts.wrong ? null : { to: 'level0', after: 35, bump: 0.3, bumpMax: 1, ramp: 90, fall: 0.008, fallAfter: 80, message: "You've noclipped out of reality." },
      voidTex: ['housewall', 'woodfloor', 'housecarpet', 'wallpaper0', 'carpet0', 'ceiling0'],
    };
    this.noclipped = false;
    this.kitchenLoops = 0;
    this.clock = null;
    this.doors = [];
  }

  spawn() {
    if (this.wrong) return { x: 9.5, y: 0, z: 4.65, yaw: Math.PI / 2 };
    return { x: 1.6, y: 0, z: 2.2, yaw: -2.6 };
  }

  layout(cx, cz) {
    if (cx !== 0 || cz !== 0) return null;
    const boxes = [];
    const walls = [];
    const W = (x0, z0, x1, z1, gaps = [], opts = {}) => {
      // axis-aligned wall from (x0,z0) to (x1,z1) with door gaps [a,b] along its length
      const horiz = z0 === z1;
      const a0 = horiz ? x0 : z0, a1 = horiz ? x1 : z1;
      const segs = [];
      let cur = a0;
      for (const [ga, gb] of gaps.sort((p, q) => p[0] - q[0])) {
        if (ga > cur) segs.push([cur, ga, 0, H]);
        segs.push([ga, gb, 2.08, H]); // header above door
        cur = gb;
      }
      if (cur < a1) segs.push([cur, a1, 0, H]);
      for (const [a, b, y0, y1] of segs) {
        const bx = horiz ? box(a - T / 2, y0, z0 - T / 2, b + T / 2, y1, z0 + T / 2) : box(x0 - T / 2, y0, a - T / 2, x0 + T / 2, y1, b + T / 2);
        if (y0 > 0) {
          bx.col = false;
          bx.occ = false;
        }
        boxes.push(bx);
        walls.push({ b: bx, mat: opts.mat || 'wall' });
      }
    };
    // bedroom + bath north
    W(0, 0, 7, 0);
    W(0, 0, 0, 11); // west outer
    W(4, 0, 4, 4);
    W(7, 0, 7, 4);
    // hallway (longer than it should be)
    W(0, 4, 11, 4, [[2.4, 3.3], [5.0, 5.8], [9.2, 10.0]]);
    W(0, 5.3, 11, 5.3, [[1.0, 2.8], [8.0, 9.0]]);
    W(11, 4, 11, 5.3);
    // living / kitchen
    W(6, 5.3, 6, 11);
    W(0, 11, 6, 11);
    W(11, 5.3, 11, 10);
    W(6, 10, 11, 10, [[8.0, 9.0]]);
    // the kitchen beyond the pantry door (an exact copy)
    W(6, 10, 6, 10 + KDZ);
    W(11, 10, 11, 10 + KDZ);
    W(6, 10 + KDZ, 11, 10 + KDZ, [[8.0, 9.0]]);
    // the hall closet: much deeper than the house
    W(8.6, -14, 8.6, 4);
    W(10.6, -14, 10.6, 4);
    W(8.6, -14, 10.6, -14);

    const lights = [];
    const L = (x, y, z, col, base, r = 5.5, extra = {}) => lights.push({ x, y, z, r, color: col, base, flicker: FLICKER.NONE, dead: false, ...extra });
    const WARM = [1.0, 0.72, 0.42], COOL = [0.85, 0.92, 1.0], MOON = [0.4, 0.5, 0.8];
    L(0.45, 0.95, 2.75, WARM, 0.85, 5, { silent: true, lamp: true }); // bedside lamp
    L(0.6, 1.8, 2.2, MOON, 0.28, 4, { silent: true });
    L(5.5, 2.3, 2.0, COOL, 0.9, 5.5, { silent: true }); // bathroom
    L(6.0, 0.35, 4.2, WARM, 0.32, 3.5, { silent: true }); // night light
    L(1.0, 1.6, 10.2, WARM, 1.1, 7, { silent: true, lamp: true }); // floor lamp
    L(3.0, 1.6, 10.8, MOON, 0.18, 4, { silent: true });
    for (const dz of [0, KDZ]) L(10.4, 1.35, 7.4 + dz, [1.0, 0.85, 0.62], 0.8, 4.8, { silent: true }); // under-cabinet
    L(9.6, 2.25, -12.6, WARM, 0.5, 6, { flicker: FLICKER.DYING, silent: true }); // bare bulb at the end of the closet
    if (this.wrong) {
      // a faint fluorescent glow from somewhere it shouldn't be
      L(10.5, 2.3, 4.65, [1, 0.92, 0.65], 0.35, 4, { flicker: FLICKER.BAD });
    }

    // furniture colliders
    const furn = [];
    const F = (x0, z0, x1, z1, h) => {
      const b = box(x0, 0, z0, x1, h, z1, { occ: false });
      boxes.push(b);
      furn.push(b);
    };
    F(0.15, 0.3, 1.9, 2.3, 0.6); // bed
    F(0.12, 2.5, 0.7, 3.05, 0.6); // nightstand
    F(2.8, 0.12, 3.9, 0.6, 1.1); // dresser
    F(4.2, 0.12, 4.9, 0.7, 0.9); // bath sink
    F(6.2, 0.12, 6.9, 0.8, 0.5); // toilet
    F(0.2, 7.0, 2.6, 7.9, 0.85); // couch
    F(1.0, 8.4, 2.0, 9.2, 0.45); // coffee table
    F(4.9, 7.2, 5.9, 8.6, 0.55); // tv stand
    F(0.6, 10.0, 1.2, 10.6, 1.7); // floor lamp
    for (const dz of [0, KDZ]) {
      F(10.4, 5.45 + dz, 10.95, 9.0 + dz, 0.92); // counters
      F(10.2, 9.1 + dz, 10.95, 9.92 + dz, 1.8); // fridge
      F(7.0, 6.6 + dz, 8.2, 7.8 + dz, 0.75); // table
    }
    F(8.7, -13.9, 9.3, -6, 1.5); // closet shelves
    F(10.0, -11, 10.5, -3, 1.2);

    return { boxes, walls, lights, furn, ox: 0, oz: 0 };
  }

  build(lay, mb, world) {
    const extra = [], inter = [], zones = [], colliders = [];
    const wallMat = this.wrong ? 'wallWrong' : 'wall';
    for (const w of lay.walls) {
      const b = w.b;
      mb.box(wallMat, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, { faces: b.minY > 0 ? 'xXzZy' : 'xXzZ', step: 0.8, vstep: 0.6 });
    }
    const R = (mat, x0, z0, x1, z1) => {
      mb.flat(mat, x0, z0, x1, z1, 0, true, { step: 0.7 });
      mb.flat('ceil', x0, z0, x1, z1, H, false, { step: 0.9 });
    };
    R('carpet', 0, 0, 4, 4);
    R('tile', 4, 0, 7, 4);
    R('wood', 0, 4, 11, 5.3);
    R('carpet', 0, 5.3, 6, 11);
    R('tile', 6, 5.3, 11, 10);
    R('tile', 6, 10, 11, 10 + KDZ);
    R('wood', 8.6, -14, 10.6, 4);

    // --- bedroom ---
    mb.box('p_fabric', 0.15, 0, 0.3, 1.9, 0.5, 2.3, { step: 0.6, vstep: 0.5 });
    mb.box('p_white', 0.3, 0.5, 0.35, 1.75, 0.62, 0.8, { step: 0.6, faces: 'xXzZY' });
    mb.box('p_couch', 0.2, 0.5, 1.0, 1.85, 0.56, 2.25, { step: 0.6, faces: 'xXzZY' }); // blanket, pushed back
    mb.box('p_wood', 0.15, 0, 0.15, 1.9, 1.1, 0.3, { step: 0.6 }); // headboard
    mb.box('p_wood', 0.12, 0, 2.5, 0.7, 0.55, 3.05, { step: 0.6 });
    mb.box('p_dark', 0.38, 0.55, 2.68, 0.52, 0.75, 2.82);
    mb.box('lampglow', 0.3, 0.75, 2.6, 0.6, 1.0, 2.9, { emit: lay.lights[0].slot });
    mb.box('p_wood', 2.8, 0, 0.12, 3.9, 1.1, 0.6, { step: 0.6 });
    // window (night) on the west wall
    wallQuad(mb, 'night', T / 2, 1.0, 2.2, 1.2, 1.1, 1, 0, 0.004);
    this._frame(mb, T / 2, 2.2, 1, 0, 1.2, 1.1, 1.0);

    // --- bathroom ---
    mb.box('p_white', 4.2, 0, 0.12, 4.9, 0.9, 0.7, { step: 0.5 });
    mb.box('p_white', 6.25, 0, 0.12, 6.85, 0.45, 0.75, { step: 0.5 });
    mb.box('p_white', 6.25, 0.45, 0.12, 6.85, 0.9, 0.3, { step: 0.5 });
    mb.box('lampglow', 5.2, H - 0.06, 1.7, 5.8, H, 2.3, { faces: 'y', emit: lay.lights[2].slot });

    // --- living room ---
    mb.box('p_couch', 0.2, 0, 7.0, 2.6, 0.45, 7.9, { step: 0.6 });
    mb.box('p_couch', 0.2, 0.45, 7.65, 2.6, 0.9, 7.9, { step: 0.6 });
    mb.box('p_couch', 0.2, 0.45, 7.0, 0.42, 0.65, 7.65);
    mb.box('p_couch', 2.38, 0.45, 7.0, 2.6, 0.65, 7.65);
    mb.box('p_wood', 1.0, 0.38, 8.4, 2.0, 0.45, 9.2, { step: 0.5 });
    mb.box('p_metal', 1.05, 0, 8.45, 1.1, 0.38, 8.5);
    mb.box('p_metal', 1.9, 0, 9.1, 1.95, 0.38, 9.15);
    mb.box('p_wood', 4.9, 0, 7.2, 5.9, 0.5, 8.6, { step: 0.6 });
    mb.box('p_black', 5.2, 0.5, 7.3, 5.7, 1.15, 8.5, { step: 0.6 }); // the tv
    mb.box('led', 5.18, 0.54, 8.38, 5.2, 0.56, 8.4, { faces: 'x' });
    mb.box('p_metal', 0.85, 0, 10.25, 0.95, 1.55, 10.35);
    mb.box('lampglow', 0.7, 1.45, 10.1, 1.1, 1.8, 10.5, { step: 0.3, emit: lay.lights[4].slot });
    mb.flat('p_fabric', 0.6, 8.1, 3.6, 9.6, 0.004, true, { step: 0.6 }); // rug
    wallQuad(mb, 'night', 3.0, 1.0, 11 - T / 2, 1.6, 1.1, 0, -1, 0.004);
    this._frame(mb, 3.0, 11 - T / 2, 0, -1, 1.6, 1.1, 1.0);

    // --- kitchen and its twin ---
    for (const dz of [0, KDZ]) {
      mb.box('p_white', 10.45, 0, 5.45 + dz, 10.95, 0.88, 9.0 + dz, { step: 0.7 });
      mb.box('p_wood', 10.4, 0.88, 5.42 + dz, 10.95, 0.93, 9.02 + dz, { step: 0.7 });
      mb.box('p_white', 10.62, 1.45, 5.45 + dz, 10.95, 2.2, 9.0 + dz, { step: 0.7, faces: 'xXzZYy' });
      mb.box('p_metal', 10.55, 0.9, 7.0 + dz, 10.85, 0.95, 7.6 + dz); // sink
      mb.box('p_white', 10.2, 0, 9.1 + dz, 10.95, 1.8, 9.92 + dz, { step: 0.5 }); // fridge
      mb.box('p_metal', 10.17, 1.0, 9.15 + dz, 10.2, 1.5, 9.2 + dz);
      mb.box('p_wood', 7.0, 0.72, 6.6 + dz, 8.2, 0.76, 7.8 + dz, { step: 0.6 });
      for (const [lx, lz] of [[7.05, 6.65], [8.1, 6.65], [7.05, 7.7], [8.1, 7.7]]) mb.box('p_wood', lx, 0, lz + dz, lx + 0.05, 0.72, lz + 0.05 + dz);
      mb.box('p_wood', 7.3, 0.42, 8.0 + dz, 7.8, 0.46, 8.5 + dz);
      mb.box('p_wood', 7.3, 0.46, 8.45 + dz, 7.8, 0.95, 8.5 + dz);
    }
    // the twin's pantry door is shut
    mb.box('p_wood', 8.0, 0, 10 + KDZ - 0.03, 9.0, 2.08, 10 + KDZ + 0.03, { step: 0.5 });
    colliders.push(box(7.9, 0, 10 + KDZ - 0.08, 9.1, 2.5, 10 + KDZ + 0.08, { occ: false }));

    // --- closet ---
    mb.box('p_crate', 8.7, 0, -13.9, 9.3, 0.5, -6, { step: 1 });
    mb.box('p_crate', 8.75, 0.5, -12.9, 9.25, 0.95, -9, { step: 1 });
    mb.box('p_crate', 10.0, 0, -11, 10.5, 0.6, -3, { step: 1 });
    mb.box('p_dark', 9.55, 2.1, -12.65, 9.65, 2.5, -12.55);
    mb.box('lampglow', 9.52, 2.0, -12.68, 9.68, 2.15, -12.52, { emit: lay.lights[8].slot });

    // --- doors ---
    const bedDoor = this._door(mb, extra, 2.4, 4, 1, 0, 0, -1, 0.9, 1.45, false);
    const bathDoor = this._door(mb, extra, 5.0, 4, 1, 0, 0, -1, 0.8, 0.35, false);
    const closet = this._door(mb, extra, 9.2, 4, 1, 0, 0, -1, 0.8, 0, true);
    const pantry = this._door(mb, extra, 8.0, 10, 1, 0, 0, 1, 1.0, 0, true);
    for (const d of [closet, pantry]) {
      colliders.push(d.box);
      inter.push({
        x: d.cx, y: 1.1, z: d.cz, r: 1.8, cone: 0.7, prompt: 'Open door', door: d,
        use: (game) => {
          if (d.open) return;
          d.open = true;
          d.box.disabled = true;
          game.audio.playAt('creak', new THREE.Vector3(d.cx, 1.2, d.cz), { gain: 0.4, reverb: 0.3, rate: 1.1 });
        },
        get enabled() {
          return !d.open;
        },
      });
    }
    this.doors = [bedDoor, bathDoor, closet, pantry];
    this.pantry = pantry;
    void bedDoor;
    void bathDoor;

    // --- clock on the living room wall ---
    this.clock = this._makeClock(extra, 5.94, 1.85, 6.6);

    // emitters: fridge (and its twin), the hum inside the corner
    const em = [
      { x: 10.6, y: 1.0, z: 9.5, build: EMIT.fridge, opts: { range: 14, gain: 0.32, reverb: 0.2 } },
      { x: 10.6, y: 1.0, z: 9.5 + KDZ, build: EMIT.fridge, opts: { range: 9, gain: 0.32, reverb: 0.2 } },
      { x: 11.4, y: 1.3, z: 4.65, build: EMIT.hum, opts: { range: 7, gain: this.wrong ? 0.25 : 0.12, reverb: 0.1 } },
    ];
    const disposeEm = spawnEmitters(em, this.game);

    // surfaces
    this.surfaces = [
      { x0: 0, z0: 0, x1: 4, z1: 4, s: 'housecarpet' },
      { x0: 4, z0: 0, x1: 7, z1: 4, s: 'tile' },
      { x0: 0, z0: 4, x1: 11, z1: 5.3, s: 'wood' },
      { x0: 0, z0: 5.3, x1: 6, z1: 11, s: 'housecarpet' },
      { x0: 6, z0: 5.3, x1: 11, z1: 20, s: 'tile' },
      { x0: 8.6, z0: -14, x1: 10.6, z1: 4, s: 'wood' },
    ];
    return { extra, interactables: inter, zones, colliders, dispose: disposeEm, update: (dt) => this._tick(dt) };
  }

  _frame(mb, x, z, nx, nz, w, h, y0) {
    const tx = -nz, tz = nx;
    const piece = (o, yy, ww, hh) => {
      const cx = x + tx * o + nx * 0.03, cz = z + tz * o + nz * 0.03;
      const hw = Math.abs(tx) > 0.5 ? ww / 2 : 0.03, hd = Math.abs(tz) > 0.5 ? ww / 2 : 0.03;
      mb.box('p_white', cx - hw, yy, cz - hd, cx + hw, yy + hh, cz + hd, { faces: 'xXzZYy' });
    };
    piece(0, y0 - 0.05, w + 0.1, 0.05);
    piece(0, y0 + h, w + 0.1, 0.05);
    piece(-w / 2, y0, 0.05, h);
    piece(w / 2, y0, 0.05, h);
    piece(0, y0, 0.03, h);
    piece(0, y0 + h / 2, w, 0.03);
  }

  /** Door on a wall along +x, hinged at (hx,hz), swinging toward nz (+1/-1). */
  _door(mb, extra, hx, hz, tx, tz, nx, nz, w, ang, interactive) {
    const geo = new THREE.BoxGeometry(w, 2.06, 0.04);
    geo.translate(w / 2, 1.03, 0);
    const s = this.game.lights.sample(hx + w / 2, 1.2, hz + nz * 0.5, new THREE.Vector3());
    const mesh = new THREE.Mesh(geo, dynMat(tex('wood'), s.multiplyScalar(0.8).addScalar(0.02)));
    mesh.position.set(hx, 0, hz);
    const sign = -nz;
    mesh.rotation.y = sign * Math.abs(ang);
    extra.push(mesh);
    return {
      mesh, baseRot: 0, ang: Math.abs(ang), open: !interactive, sign,
      cx: hx + w / 2, cz: hz - nz * 0.35,
      box: box(hx - 0.04, 0, hz - 0.05, hx + w + 0.04, 2.1, hz + 0.05, { occ: false }),
    };
  }

  _makeClock(extra, x, y, z) {
    const g = new THREE.Group();
    const s = this.game.lights.sample(x - 0.4, y, z, new THREE.Vector3()).multiplyScalar(0.9).addScalar(0.08);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.17, 24), dynMat(tex('clockface'), s));
    face.rotation.y = -Math.PI / 2;
    g.add(face);
    const handMat = dynMat(tex('black'), s);
    const mk = (len, w) => {
      const geo = new THREE.BoxGeometry(0.004, len, w);
      geo.translate(0, len / 2 - 0.02, 0);
      const m = new THREE.Mesh(geo, handMat);
      m.position.x = -0.01;
      g.add(m);
      return m;
    };
    const hour = mk(0.08, 0.014), minute = mk(0.13, 0.009), second = mk(0.14, 0.003);
    g.position.set(x, y, z);
    extra.push(g);
    // 3:07 AM
    const c = { g, hour, minute, second, sec: 7 * 60 + 3 * 3600 + 12, next: 1, pos: new THREE.Vector3(x, y, z), irregular: 0 };
    this._setHands(c);
    return c;
  }

  _setHands(c) {
    const s = c.sec;
    c.second.rotation.x = -(s % 60) / 60 * Math.PI * 2;
    c.minute.rotation.x = -((s / 60) % 60) / 60 * Math.PI * 2;
    c.hour.rotation.x = -((s / 3600) % 12) / 12 * Math.PI * 2;
  }

  _tick(dt) {
    for (const d of this.doors) {
      if (d.open && d.ang < 1.5 && d.mesh) {
        d.ang = Math.min(1.5, d.ang + dt * 1.1);
        d.mesh.rotation.y = d.baseRot + d.ang * d.sign;
      }
    }
    const c = this.clock;
    if (c && !this.noclipping) {
      c.next -= dt;
      if (c.next <= 0) {
        const a = this.game.audio;
        const t = this.game.levelTime;
        // mostly regular. sometimes not.
        let gap = 1;
        const r = Math.random();
        const odd = this.wrong ? 0.4 : t > 25 ? 0.07 : 0;
        if (r < odd * 0.45) gap = 1.7;
        else if (r < odd * 0.8) gap = 0.27;
        else if (r < odd) {
          gap = 1;
          c.sec -= 2; // the second hand steps backwards
        }
        c.next = gap;
        c.sec += 1;
        this._setHands(c);
        a.playAt('clocktick', c.pos, { gain: 0.32, reverb: 0.25, ref: 1.2, rate: c.sec % 2 ? 1 : 0.94 });
      }
    }
  }

  get exitText() {
    return 'There is no door out of here. Walk into the walls.';
  }

  surfaceAt(x, z) {
    for (const s of this.surfaces || []) if (x >= s.x0 && x < s.x1 && z >= s.z0 && z < s.z1) return s.s;
    return 'wood';
  }

  onEnter(game) {
    if (this.wrong) return;
    game.audio.fadeWorld(1, 3);
  }

  update(dt, game) {
    const p = game.player;
    const inside = p.pos.x > 0.1 && p.pos.x < 10.9 && p.pos.z > -13.9 && p.pos.z < 10 + KDZ - 0.1;
    if (inside) (this._lastIn = this._lastIn || new THREE.Vector3()).copy(p.pos);
    else if (this._lastIn && !this.noclipping) p.pos.copy(this._lastIn);
    if (this.wrong) return this._wrongUpdate(dt, game);
    // the kitchen loop: once inside the twin, quietly put them back in the original
    if (p.pos.z > 10.7 && p.pos.z < 10 + KDZ && p.pos.x > 6 && p.pos.x < 11 && !this._doorsInView(game)) {
      p.pos.z -= KDZ;
      this.kitchenLoops++;
      if (this.kitchenLoops === 1) game.director.note('kitchen');
    }
  }

  _doorsInView(game) {
    // are either the kitchen's doorway or pantry visible? (from the twin)
    const cam = game.camera;
    cam.updateMatrixWorld();
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const pts = [];
    for (const z of [10, 10 + KDZ, 5.3]) for (const x of [7.7, 9.3]) for (const y of [0.1, 2.1]) pts.push(new THREE.Vector3(x, y, z));
    const sphere = new THREE.Sphere(new THREE.Vector3(), 0.6);
    for (const v of pts) {
      sphere.center.copy(v);
      if (fr.intersectsSphere(sphere)) return true;
    }
    return false;
  }

  _wrongUpdate(dt, game) {
    // the ending house: everything is almost right
    if (game.levelTime > 6 && !this._endShown) {
      const p = game.player;
      if (game.levelTime > 70 || (p.pos.x < 3 && p.pos.z < 4.2)) {
        this._endShown = true;
        game.finishEscape();
      }
    }
  }
}
