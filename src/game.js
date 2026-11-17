import * as THREE from 'three';
import { Input } from './core/input.js';
import { Settings, SaveData, Codex } from './core/settings.js';
import { clamp, damp, lerp, RNG, valueNoise2 } from './core/math.js';
import { LightSystem } from './gfx/lights.js';
import { G } from './gfx/materials.js';
import { Post } from './gfx/post.js';
import { AudioEngine } from './audio/audio.js';
import { createAmbience } from './audio/ambience.js';
import { World } from './world/world.js';
import { Player } from './player/player.js';
import { createLevel, LEVEL_INFO } from './levels/index.js';
import { UI } from './ui/ui.js';
import { Director } from './director.js';
import { Entities } from './entities/entities.js';
import { VoidFall } from './gfx/voidfall.js';
import { NOTES } from './lore.js';
import { runEnding } from './endings.js';

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

export class Game {
  constructor(container, uiRoot) {
    this.container = container;
    this.settings = new Settings();
    this.codex = new Codex();
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = true;
    this.renderer.setClearColor(0x000000, 1);
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.get('fov'), 16 / 9, 0.05, 140);
    this.scene.add(this.camera);
    this.post = new Post(this.renderer);
    this.lights = new LightSystem();
    G.uLightTex.value = this.lights.tex;
    this.audio = new AudioEngine();
    this.input = new Input(this.canvas);
    this.world = new World(this);
    this.player = new Player(this.camera, this);
    this.ui = new UI(uiRoot, this);
    this.director = new Director(this);
    this.entities = new Entities(this);
    this.voidFall = new VoidFall(this);
    this.clock = new THREE.Clock();
    this.time = 0;
    this.state = 'boot';
    this.level = null;
    this.levelTime = 0;
    this.runTime = 0;
    this.localLight = 1;
    this.roomTimer = 0;
    this.humTimer = 0;
    this.nearLights = [];
    this.flash = { pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), flick: 1 };
    this.seq = null; // scripted sequence (noclip, transitions, endings)
    this.ambience = null;
    this.breath = { t: 2, inhale: true };
    this.fx = { glitch: 0, tunnel: 0, fade: 1, fadeColor: new THREE.Color(0, 0, 0), smear: 0, staticAmt: 0, track: 0, redTint: 0, extraNoise: 0 };
    this.cardShown = false;
    this.paused = false;
    this.seed = (Math.random() * 1e9) | 0;
    this.prompt = null;
    this.alone = 0;
    this.fakeStepT = 20;
    this.periphT = 30;

    this.input.onKey = (code, e) => this._onKey(code, e);
    // clicking the game captures the mouse again (after Esc, a note, the inventory...)
    this.input.onCanvasClick = () => {
      if ((this.state === 'play' || this.state === 'intro') && !this.paused && !this.ui.modal && !this.input.locked) this.input.lock();
    };
    this.input.onLockChange = (locked) => {
      if (!locked && (this.state === 'play' || this.state === 'intro') && !this.ui.modal && !this.seq?.noPause) this.pause();
    };
    window.addEventListener('resize', () => this._resize());
    this.settings.onChange((k, v) => this._applySetting(k, v));
    this.codex.onNew = (kind, id) => this.ui.codexToast(kind, id);
    this._resize();
  }

  start() {
    this.ui.showBoot();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  /** First user gesture: start audio and go to the menu. */
  boot() {
    this.audio.init();
    this.audio.setVolume(this.settings.get('volume'));
    this.goMenu();
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const q = this.settings.q;
    this.post.setSize(w, h, q.renderScale);
    this.post.bloomEnabled = q.bloom;
    this.world.viewChunks = q.viewChunks;
  }

  _applySetting(k, v) {
    if (k === 'fov') {
      this.camera.fov = v;
      this.camera.updateProjectionMatrix();
    } else if (k === 'volume') this.audio.setVolume(v);
    else if (k === 'quality') {
      this._resize();
      this.world.update(this.player.pos.x, this.player.pos.z, true);
    }
  }

  // ---------------- levels ----------------

  loadLevel(id, { fromSave = false, spawn = null, menu = false } = {}) {
    if (this.ambience) {
      this.ambience.stop();
      this.ambience = null;
    }
    this.audio.clearEmitters?.();
    this.entities.clear();
    if (this.level && this.level.dispose) this.level.dispose();
    const level = createLevel(id, this, (this.seed + id.length * 7919) | 0, { menu });
    this.level = level;
    this.levelId = id;
    this.world.setLevel(level);
    this.levelTime = 0;
    this.player.camOffset.set(0, 0, 0);
    this.player.lookFrozen = false;
    this.cardShown = false;
    this.fx.redTint = 0;
    this.fx.staticAmt = 0;
    this.fx.glitch = 0;
    this.fx.smear = 0;
    this.alone = 0;
    const sp = spawn || level.spawn();
    this.player.place(sp.x, sp.y, sp.z, sp.yaw ?? 0);
    this.player.speedMul = level.config.speedMul ?? 1;
    this.player.staminaMul = level.config.staminaMul ?? 1;
    this._applyLevelConfig(level.config);
    this.world.update(sp.x, sp.z, true);
    this.post.snap = true;
    this.director.reset(level);
    if (level.onEnter) level.onEnter(this);
    if (!menu) {
      this.ambience = createAmbience(level.config.ambience, this.audio);
      if (LEVEL_INFO[id]?.codex) this.codex.addLevel(id);
      if (!fromSave && LEVEL_INFO[id]?.checkpoint) this.saveGame();
    } else {
      this.ambience = null;
    }
  }

  _applyLevelConfig(c) {
    G.uFogColor.value.setRGB(...c.fogColor);
    G.uFogDensity.value = c.fogDensity;
    G.uFogLit.value = c.fogLit ?? 0.8;
    G.uAmbient.value.setRGB(...c.ambient);
    G.uPanelGain.value = c.panelGain ?? 2.2;
    G.uWetness.value = c.wetness ?? 0;
    G.uWaterLevel.value = c.waterLevel ?? -100;
    G.uCaustics.value = c.caustics ?? 0;
    const p = c.post;
    const u = this.post.u;
    u.uKey.value = p.key;
    u.uGrade.value.setRGB(...p.grade);
    u.uSat.value = p.sat;
    u.uContrast.value = p.contrast;
    u.uLift.value = p.lift;
    u.uBloom.value = p.bloom;
    this.audio.setReverbProfile(c.reverb);
    this.audio.setHumProfile(c.hum || {});
    this.renderer.setClearColor(new THREE.Color(...c.fogColor).multiplyScalar(0.2));
    this.camera.far = c.far ?? 140;
    this.camera.updateProjectionMatrix();
  }

  /** Move to another level with a transition style. */
  transitionTo(id, { style = 'fade', spawn = null } = {}) {
    if (this.seq && this.seq.kind === 'transition') return;
    const run = this._transitionSeq(id, style, spawn);
    this.seq = { kind: 'transition', gen: run, wait: 0, noPause: true };
  }

  *_transitionSeq(id, style, spawn) {
    const fx = this.fx;
    const a = this.audio;
    this.player.frozen = style !== 'fade';
    if (style === 'fall' || style === 'noclip') {
      // falling through: smear, warped audio, void
      a.setMuffle(500, 1.5);
      a.play('whoosh', { gain: 0.5, bus: 'ui' });
      this.voidFall.begin(this.level?.config?.voidTex || ['wallpaper0', 'carpet0', 'ceiling0']);
      fx.smear = 0.85;
      a.fadeWorld(0.0, 2.5);
      yield 2.6;
      fx.fadeColor.setRGB(0, 0, 0);
      for (let t = 0; t < 1; t += 0.05) {
        fx.fade = t;
        yield 0.05;
      }
      fx.fade = 1;
      this.voidFall.end();
      fx.smear = 0;
      yield 2.5; // total silence and black
    } else if (style === 'white') {
      fx.fadeColor.setRGB(1, 1, 1);
      a.fadeWorld(0, 2);
      for (let t = 0; t < 1; t += 0.02) {
        fx.fade = t * t;
        yield 0.04;
      }
      fx.fade = 1;
      yield 2.5;
    } else {
      fx.fadeColor.setRGB(0, 0, 0);
      if (style === 'stairs') {
        // footsteps going down, echoing
        for (let i = 0; i < 14; i++) a.play('step_concrete', { gain: 0.45 - i * 0.02, when: 0.3 + i * 0.42, reverb: 1.2, bus: 'ui', rate: 0.95 + Math.random() * 0.1 });
        a.play('doorslam', { gain: 0.4, when: 0.1, reverb: 1, bus: 'ui' });
      }
      a.fadeWorld(0, 1);
      for (let t = 0; t < 1; t += 0.05) {
        fx.fade = t;
        yield 0.05;
      }
      fx.fade = 1;
      yield style === 'stairs' ? 5.5 : 1.2;
    }
    this.loadLevel(id, { spawn });
    a.setMuffle(20000, 0.5);
    this.player.frozen = false;
    // the first sound is the level itself
    a.fadeWorld(1, style === 'fade' ? 1 : 3);
    const dur = style === 'fade' ? 1.2 : 3.5;
    for (let t = 0; t < dur; t += 0.05) {
      fx.fade = 1 - t / dur;
      if (style === 'white') fx.fade = 1 - Math.sqrt(t / dur);
      yield 0.05;
    }
    fx.fade = 0;
    fx.fadeColor.setRGB(0, 0, 0);
  }

  // ---------------- menu / flow ----------------

  goMenu() {
    this.state = 'menu';
    this._endingBusy = false;
    this.endingUpdate = null;
    this.player.frozen = false;
    this.paused = false;
    this.seq = null;
    this.input.unlock();
    this.loadLevel('level0', { menu: true, spawn: { x: 1, y: 0, z: 0, yaw: -Math.PI / 2 } });
    const lay0 = this.world.layouts.get('0,0');
    this.level.menuZ = lay0 && lay0.anomaly ? lay0.oz + lay0.anomaly.r * 2 + 1 : 1;
    this.menuCam = { t: 0 };
    this.fx.fade = 1;
    this.fx.fadeColor.setRGB(0, 0, 0);
    this.audio.fadeWorld(0.35, 2);
    this.ui.showMenu(!!SaveData.load());
  }

  newGame() {
    SaveData.clear();
    this.seed = (Math.random() * 1e9) | 0;
    this.world.taken.clear();
    this.player.inv = { almond: 0, batteries: 0, notes: [] };
    this.player.sanity = 100;
    this.player.battery = 1;
    this.player.stamina = 1;
    this.player.flashlight = false;
    this.notesRead = [];
    this.runTime = 0;
    this.ui.hideMenu();
    this.state = 'intro';
    this.fx.fade = 1;
    this.audio.fadeWorld(0, 0.1);
    this.loadLevel('house');
    this.input.lock();
    this.seq = { kind: 'fadein', gen: this._fadeIn(3), wait: 0 };
    setTimeout(() => this.ui.hint('WASD move · SHIFT run · C crouch · E interact · F flashlight · TAB pockets', 7), 2500);
  }

  continueGame() {
    const s = SaveData.load();
    if (!s) return this.newGame();
    this.seed = s.seed;
    this.player.inv = s.inv || { almond: 0, batteries: 0, notes: [] };
    this.player.sanity = s.sanity ?? 100;
    this.player.battery = s.battery ?? 1;
    this.player.flashlight = false;
    this.notesRead = s.notesRead || [];
    this.runTime = s.runTime || 0;
    this.world.taken = new Set(s.taken || []);
    this.ui.hideMenu();
    this.state = 'play';
    this.fx.fade = 1;
    this.audio.fadeWorld(0, 0.1);
    this.loadLevel(s.level, { fromSave: true });
    this.input.lock();
    this.seq = { kind: 'fadein', gen: this._fadeIn(2.5), wait: 0 };
  }

  *_fadeIn(d) {
    this.audio.fadeWorld(1, d);
    for (let t = 0; t < d; t += 0.05) {
      this.fx.fade = 1 - t / d;
      yield 0.05;
    }
    this.fx.fade = 0;
  }

  saveGame() {
    if (!this.level || !LEVEL_INFO[this.levelId]?.checkpoint) return;
    SaveData.save({
      seed: this.seed,
      level: this.levelId,
      inv: this.player.inv,
      sanity: Math.max(35, this.player.sanity),
      battery: this.player.battery,
      notesRead: this.notesRead || [],
      runTime: this.runTime,
      taken: [...this.world.taken].slice(-300),
    });
  }

  pause() {
    if (this.state !== 'play' && this.state !== 'intro') return;
    this.paused = true;
    this.audio.setMuffle(700, 0.3);
    this.audio.fadeWorld(0.5, 0.3);
    this.ui.showPause();
  }

  resume() {
    this.paused = false;
    this.input.consumeMouse();
    this.ui.hidePause();
    this.audio.setMuffle(20000, 0.3);
    this.audio.fadeWorld(1, 0.3);
    this.input.lock();
  }

  quitToMenu() {
    this.ui.hidePause();
    this.ui.closeAll();
    this.audio.setMuffle(20000, 0.3);
    this.goMenu();
  }

  _onKey(code) {
    if (this.state === 'boot') return;
    if (this.ui.handleKey(code)) return;
    if (this.state !== 'play' && this.state !== 'intro') return;
    if (this.paused) return;
    if (code === 'Escape') {
      this.pause();
    }
  }

  // ---------------- items / interaction ----------------

  pickup(type, it) {
    const p = this.player;
    if (type === 'almond') {
      p.inv.almond++;
      this.audio.play('bottle', { gain: 0.5 });
      this.ui.toast('Almond Water');
      this.codex.addEntity('item_almond');
    } else if (type === 'battery') {
      p.inv.batteries++;
      this.audio.play('click', { gain: 0.6 });
      this.ui.toast('Battery');
    } else if (type === 'note') {
      this.audio.play('paper', { gain: 0.6 });
      const note = this.nextNote(this.levelId);
      if (note) {
        p.inv.notes.push(note.id);
        this.codex.addNote(note.id);
        this.ui.showNote(note);
        p.sanity = Math.min(100, p.sanity + 6); // someone else was here
      }
    } else if (type === 'supplies') {
      // crates contain a little of everything, sometimes nothing
      const r = Math.random();
      if (r < 0.45) this.pickup('almond');
      else if (r < 0.8) this.pickup('battery');
      else {
        this.ui.toast('Empty');
        this.audio.play('creak', { gain: 0.3, rate: 1.4 });
      }
    }
  }

  nextNote(levelId) {
    this.notesRead = this.notesRead || [];
    const pool = NOTES.filter((n) => !this.notesRead.includes(n.id) && (!n.levels || n.levels.includes(levelId)));
    const pool2 = pool.length ? pool : NOTES.filter((n) => !this.notesRead.includes(n.id));
    const n = pool2.sort((a, b) => (a.order ?? 99) - (b.order ?? 99))[0];
    if (!n) return NOTES[Math.floor(Math.random() * NOTES.length)];
    this.notesRead.push(n.id);
    return n;
  }

  useAlmond() {
    const p = this.player;
    if (p.inv.almond <= 0) return false;
    p.inv.almond--;
    p.sanity = Math.min(100, p.sanity + 35);
    this.audio.play('bottle', { gain: 0.6, rate: 0.8 });
    this.ui.toast('It tastes faintly sweet.');
    return true;
  }

  useBattery() {
    const p = this.player;
    if (p.inv.batteries <= 0) return false;
    p.inv.batteries--;
    p.battery = 1;
    this.audio.play('click', { gain: 0.7, rate: 0.8 });
    this.ui.toast('Flashlight battery replaced');
    return true;
  }

  _interact() {
    const p = this.player;
    const fwd = this.camera.getWorldDirection(tmpV);
    const cam = this.camera.position;
    let best = null, bestScore = -1;
    for (const it of this.world.interactables) {
      if (it.enabled === false) continue;
      const dx = it.x - cam.x, dy = it.y - cam.y, dz = it.z - cam.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > (it.r || 1.8)) continue;
      const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / (d || 1);
      if (dot < (it.cone ?? 0.82)) continue;
      if (!this.world.lineOfSight(p.pos.x, p.pos.z, it.x, it.z, Math.max(0.3, Math.min(it.y, 1.4))) && d > 0.9) continue;
      const score = dot - d * 0.1;
      if (score > bestScore) {
        bestScore = score;
        best = it;
      }
    }
    return best;
  }

  // ---------------- main loop ----------------

  _frame() {
    let dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    G.uTime.value = this.time;
    const u = this.post.u;
    u.uTime.value = this.time;

    // scripted sequences
    if (this.seq) {
      this.seq.wait -= dt;
      while (this.seq && this.seq.wait <= 0) {
        const r = this.seq.gen.next(dt);
        if (r.done) {
          this.seq = null;
          break;
        }
        this.seq.wait += r.value ?? 0;
      }
    }

    if (this.state === 'menu') this._menuFrame(dt);
    else if (this.state === 'play' || this.state === 'intro') {
      if (!this.paused) this._playFrame(dt);
    } else if (this.state === 'ending') {
      if (this.endingUpdate) this.endingUpdate(dt);
    }

    this.input.endFrame();
    this._render(dt);
  }

  _menuFrame(dt) {
    // slow pan down an empty corridor, like a tape left running
    const m = this.menuCam;
    m.t += dt;
    const p = this.player;
    p.pos.x = 2 + (m.t * 0.4) % 26;
    p.pos.z = 0;
    const lay = this.level;
    const cam = this.camera;
    const zc = lay.menuZ ?? 0;
    cam.position.set(p.pos.x, 1.55 + Math.sin(m.t * 0.7) * 0.01, zc + Math.sin(m.t * 0.13) * 0.15);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(-0.02 + (valueNoise2(m.t * 0.2, 3, 1) - 0.5) * 0.02, -Math.PI / 2 + Math.sin(m.t * 0.05) * 0.12, (valueNoise2(m.t * 0.2, 9, 1) - 0.5) * 0.01);
    this.world.update(cam.position.x, cam.position.z);
    this.lights.update(dt);
    this.audio.updateListener(cam);
    this._updateHumAudio(dt, cam.position);
    this.audio.setRoomSize(10);
    this.fx.fade = damp(this.fx.fade, 0, 0.8, dt);
    this.fx.track = 0.25 + 0.15 * Math.sin(this.time * 0.3);
    if ((m.t * 0.4) % 26 < 0.02) this.post.snap = true;
  }

  _playFrame(dt) {
    const p = this.player;
    const input = this.input;
    const set = this.settings;
    this.levelTime += dt;
    this.runTime += dt;

    // look
    const [mx, my] = input.consumeMouse();
    if ((input.locked || input.lockFailed) && !this.ui.modal) {
      p.look(mx, my, set.get('sensitivity'), set.get('invertY'));
      const [ex, ey] = input.edgeTurn();
      if (ex || ey) p.look(ex * dt * 1100, ey * dt * 700, set.get('sensitivity'), set.get('invertY'));
    }

    // ui keys
    if (!this.ui.modal && !p.frozen) {
      if (input.hit('KeyF')) this.toggleFlashlight();
      if (input.hit('Tab')) this.ui.toggleInventory();
      if (input.hit('KeyQ')) this.useAlmond();
      if (input.hit('KeyR')) this.useBattery();
      if (input.hit('KeyE')) {
        const it = this._interact();
        if (it) it.use(this);
      }
    }

    if (!this.ui.modal) p.update(dt, input, this.world, set);
    else p.update(dt, { down: () => false }, this.world, set);

    this.world.update(p.pos.x, p.pos.z);
    this.world.tick(dt);
    if (this.level.update) this.level.update(dt, this);
    this.lights.update(dt);

    // light at the player's eyes (occlusion-aware), drives sanity and exposure hints
    this._sampleLocalLight(dt);

    this._noclipCheck(dt);
    this.director.update(dt);
    this.entities.update(dt);
    this._updateFlashlight(dt);
    this._updateSanity(dt);
    this._updateAudio(dt);

    // interaction prompt
    const it = this.ui.modal ? null : this._interact();
    this.ui.setPrompt(it ? it.prompt : null);

    // level name card, only after a while
    const card = this.level.config.card;
    if (card && !this.cardShown && this.levelTime > card.delay) {
      this.cardShown = true;
      this.ui.levelCard(card.name, card.title, card.hint);
    }
  }

  _sampleLocalLight(dt) {
    this._llT = (this._llT || 0) - dt;
    if (this._llT > 0) return;
    this._llT = 0.15;
    const p = this.player;
    const hy = p.pos.y + 1.5;
    const w = this.world;
    const s = this.lights.sample(p.pos.x, hy, p.pos.z, tmpV, (x0, z0, x1, z1) => !w.lineOfSight(x0, z0, x1, z1, 2.0));
    const lum = s.x * 0.3 + s.y * 0.5 + s.z * 0.2 + (this.level.config.ambientLum ?? 0);
    this.localLight = lum;
  }

  /**
   * Random noclips. Walking into a wall can take you straight through it; walking
   * along, the floor can simply stop being there. No warning, no effects.
   */
  _noclipCheck(dt) {
    const nc = this.level.config.noclip;
    const p = this.player;
    const pushing = p.pushT > 0.1;
    const fresh = pushing && !this._wasPushing;
    this._wasPushing = pushing;
    if (!nc || this.seq || p.frozen || this.ui.modal || this.levelTime < nc.after) return;
    const k = Math.min(1, (this.levelTime - nc.after) / (nc.ramp ?? 600));
    if (fresh && Math.random() < nc.bump + (nc.bumpMax - nc.bump) * k) {
      this.noclip('wall');
      return;
    }
    if (nc.fall && p.moving && p.onGround && p.inWater < 0.05 && this.levelTime > (nc.fallAfter ?? nc.after)) {
      if (Math.random() < nc.fall * (0.3 + k) * dt) this.noclip('floor');
    }
  }

  noclip(kind) {
    const nc = this.level.config.noclip;
    if (!nc || this.seq) return;
    this.seq = { kind: 'transition', noPause: true, wait: 0, gen: this._noclipSeq(kind, nc.to, nc.message) };
  }

  *_noclipSeq(kind, to, message) {
    const p = this.player, a = this.audio, fx = this.fx;
    p.frozen = true;
    p.lookFrozen = true;
    const fwd = this.camera.getWorldDirection(new THREE.Vector3());
    fwd.y = 0;
    fwd.normalize();
    // the sound just stops
    a.fadeWorld(0, 0.3);
    a.setMuffle(350, 0.2);
    if (kind === 'wall') {
      // you keep walking and the wall isn't there
      for (let t = 0; t < 0.9; t += 0.03) {
        const k = t / 0.9;
        p.camOffset.copy(fwd).multiplyScalar(0.3 + k * 1.6);
        p.camOffset.y = -k * k * 0.6;
        yield 0.03;
      }
    } else {
      // the floor stops being there
      for (let t = 0; t < 0.7; t += 0.03) {
        const k = t / 0.7;
        p.camOffset.set(fwd.x * k * 0.4, -k * k * 2.6, fwd.z * k * 0.4);
        p.pitch = Math.max(-0.5, p.pitch - 0.02);
        yield 0.03;
      }
    }
    p.camOffset.set(0, 0, 0);
    this.voidFall.begin(this.level.config.voidTex || ['wallpaper0', 'carpet0', 'ceiling0']);
    fx.smear = 0.85;
    a.play('whoosh', { gain: 0.25, bus: 'ui', rate: 0.75 });
    yield 3.2;
    fx.fade = 1;
    fx.fadeColor.setRGB(0, 0, 0);
    this.voidFall.end();
    fx.smear = 0;
    yield 3.0; // black, and nothing at all
    this.state = 'play';
    this.loadLevel(to);
    p.frozen = false;
    p.lookFrozen = false;
    a.setMuffle(20000, 0.1);
    a.fadeWorld(1, 2.5);
    for (let t = 0; t < 4; t += 0.05) {
      fx.fade = 1 - t / 4;
      yield 0.05;
    }
    fx.fade = 0;
    if (message) {
      yield 10;
      if (this.levelId === to) this.ui.showMessage(message, 7);
    }
  }

  toggleFlashlight() {
    const p = this.player;
    if (!p.flashlight && p.battery <= 0.001) {
      this.audio.play('click', { gain: 0.4, rate: 1.3 });
      this.ui.toast('The flashlight is dead');
      return;
    }
    p.flashlight = !p.flashlight;
    this.audio.play('click', { gain: 0.55, rate: p.flashlight ? 1 : 0.85 });
  }

  _updateFlashlight(dt) {
    const p = this.player;
    const f = this.flash;
    const cam = this.camera;
    const fwd = cam.getWorldDirection(tmpV);
    // the light lags a little behind the view, like it's held in a hand
    f.dir.lerp(fwd, 1 - Math.exp(-dt * 14)).normalize();
    const right = tmpV2.set(-fwd.z, 0, fwd.x).normalize();
    f.pos.copy(cam.position).addScaledVector(right, 0.18).add(new THREE.Vector3(0, -0.22, 0));
    if (p.flashlight) {
      p.battery = Math.max(0, p.battery - dt / 260);
      if (p.battery <= 0) {
        p.flashlight = false;
        this.audio.play('click', { gain: 0.3, rate: 0.7 });
        this.ui.toast('The flashlight dies');
      }
    }
    let inten = p.flashlight ? 1 : 0;
    if (p.flashlight) {
      const low = p.battery < 0.18;
      f.flick = damp(f.flick, 1, 6, dt);
      if (low && Math.random() < dt * 3) f.flick = Math.random() * 0.3;
      if (this.director.flashFlicker > 0 && Math.random() < dt * 12) f.flick = Math.random() * 0.4;
      inten = (0.55 + p.battery * 0.45) * f.flick * (low ? 0.7 : 1);
    }
    G.uFlashPos.value.copy(f.pos);
    G.uFlashDir.value.copy(f.dir);
    G.uFlashColor.value.setRGB(1.0, 0.92, 0.78).multiplyScalar(inten * 2.4);
    G.uFlashCos.value.set(Math.cos(0.36), Math.cos(0.16));
  }

  _updateSanity(dt) {
    const p = this.player;
    const c = this.level.config;
    if (c.noSanity) return;
    let drain = 0.035 * (c.sanityAlone ?? 1);
    const dark = clamp(1 - this.localLight / 0.08, 0, 1);
    drain += dark * (p.flashlight ? 0.12 : 0.3);
    drain += this.entities.fearSource * 1.6;
    if (c.sanityRegen && this.localLight > 0.3) drain -= c.sanityRegen;
    p.sanity = clamp(p.sanity - drain * dt, 0, 100);
    p.fear = damp(p.fear, clamp(this.entities.fearSource + (this.director.fear || 0), 0, 1), 1.5, dt);
    const ins = 1 - p.sanity / 100;
    // camcorder glitches more as sanity goes
    this.fx.glitch = damp(this.fx.glitch, Math.max(0, ins - 0.45) * 1.4 + this.entities.glitch, 2, dt);
    G.uBreath.value = damp(G.uBreath.value, Math.max(0, ins - 0.5) * 2, 0.5, dt);
    if (p.sanity <= 0 && !this.seq) this.ending('wander');
    // hallucinations: fake footsteps behind you, shapes at the edge of vision
    if (ins > 0.5 && !this.seq) {
      this.fakeStepT -= dt * (ins - 0.4);
      if (this.fakeStepT <= 0) {
        this.fakeStepT = 25 + Math.random() * 40;
        this._fakeFootsteps();
      }
    }
    if (ins > 0.62 && !this.seq) {
      this.periphT -= dt * (ins - 0.55);
      if (this.periphT <= 0) {
        this.periphT = 30 + Math.random() * 40;
        this.entities.peripheral();
      }
    }
  }

  _fakeFootsteps() {
    const p = this.player;
    const back = this.camera.getWorldDirection(tmpV).multiplyScalar(-1);
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const pos = new THREE.Vector3(p.pos.x + back.x * (6 - i * 0.6), 0.1, p.pos.z + back.z * (6 - i * 0.6));
      this.audio.playAt('step_' + p.surface, pos, { gain: 0.35, when: i * 0.55, rate: 0.92, reverb: 0.5 });
    }
  }

  onStep(surface, loud) {
    const p = this.player;
    const gain = 0.16 + loud * 0.32;
    this.audio.play('step_' + surface, { gain, rate: 0.92 + Math.random() * 0.16, reverb: 0.35 + (surface === 'tile' || surface === 'concrete' || surface === 'metal' ? 0.4 : 0), bus: 'self' });
    if (p.inWater > 0.1 && surface !== 'water') this.audio.play('step_water', { gain: 0.3 });
  }

  onLand(v) {
    this.audio.play('thump', { gain: Math.min(1, v / 10) * 0.6, bus: 'self', reverb: 0.4 });
  }

  _updateHumAudio(dt, pos) {
    this.humTimer -= dt;
    if (this.humTimer <= 0) {
      this.humTimer = 0.1;
      const near = this.lights.query(pos.x, pos.z, 14, []);
      near.sort((a, b) => (a.x - pos.x) ** 2 + (a.z - pos.z) ** 2 - ((b.x - pos.x) ** 2 + (b.z - pos.z) ** 2));
      this.nearLights = near.filter((l) => !l.dead && l.cur > 0.01 && !l.silent).slice(0, 6);
      // how much fluorescent light is around (drives the bed volume)
      let amt = 0;
      for (const l of near) {
        const d = Math.hypot(l.x - pos.x, l.z - pos.z);
        amt += (l.silent ? 0 : l.cur) / (1 + d * 0.25);
      }
      this.humAmt = clamp(amt / 3, 0, 1.3);
    }
    const wob = valueNoise2(pos.x * 0.08, pos.z * 0.08, 5) * 2 - 1 + Math.sin(this.time * 0.05) * 0.3;
    this.audio.updateHum(dt, this.nearLights, this.humAmt ?? 0, wob);
  }

  _updateAudio(dt) {
    const a = this.audio;
    const p = this.player;
    if (!a.ready) return;
    a.updateListener(this.camera);
    this._updateHumAudio(dt, p.pos);
    a.updateEmitters();
    // room size from 8 rays (drives which reverb you hear)
    this.roomTimer -= dt;
    if (this.roomTimer <= 0) {
      this.roomTimer = 0.35;
      let sum = 0;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + this.time;
        sum += this.world.raycast(p.pos.x, p.pos.z, Math.cos(ang), Math.sin(ang), 40, 1.5);
      }
      a.setRoomSize((sum / 8) * (this.level.config.roomScale ?? 1));
    }
    // loneliness: a low rumble that rises the longer nothing happens
    this.alone += dt;
    if (this.director.sinceEvent < 2) this.alone = Math.min(this.alone, 30);
    const rum = this.level.config.rumble === false ? 0 : clamp((this.alone - 60) / 600, 0, 1) * 0.22;
    a.setRumble(rum);
    a.updateSanity(dt, 1 - p.sanity / 100, (this.humAmt ?? 0) > 0.2);
    // breathing: always there, quiet when calm
    this._breathe(dt);
    if (this.ambience) this.ambience.update(dt, { alarm: this.level.alarm, player: p });
  }

  _breathe(dt) {
    const p = this.player;
    const b = this.breath;
    b.t -= dt;
    if (b.t > 0) return;
    const ex = clamp(Math.max(p.exertion, p.fear * 0.8), 0, 1);
    const heavy = ex > 0.55;
    const name = `breath_${b.inhale ? 'in' : 'out'}${heavy ? '_h' : ''}`;
    const gain = 0.05 + ex * 0.4;
    const src = this.audio.play(name, { gain, bus: 'self', reverb: 0.15, rate: 0.95 + Math.random() * 0.1, lowpass: 5000 });
    const dur = src ? src.buffer.duration : 1;
    const gap = heavy ? 0.05 + (1 - ex) * 0.2 : b.inhale ? 0.2 + Math.random() * 0.3 : 1.6 + (1 - ex) * 2.2 + Math.random() * 1.2;
    b.t = dur * 0.95 + gap;
    b.inhale = !b.inhale;
  }

  // ---------------- endings ----------------
  ending(kind, opts = {}) {
    if (this.state === 'ending') return;
    runEnding(this, kind, opts);
  }

  // ---------------- render ----------------
  _render(dt) {
    const u = this.post.u;
    const fx = this.fx;
    const film = this.settings.get('filmEffects') ? 1 : 0;
    u.uFilm.value = film;
    u.uGlitch.value = film ? fx.glitch : fx.glitch * 0.3;
    u.uTunnel.value = damp(u.uTunnel.value, Math.max(0, (this.player.exertion - 0.5) * 1.6) + this.player.fear * 0.4, 3, dt);
    u.uFade.value = fx.fade;
    u.uFadeColor.value.copy(fx.fadeColor);
    u.uSmear.value = fx.smear;
    u.uTrack.value = film ? clamp(fx.track + fx.glitch * 0.5, 0, 1) : 0;
    u.uStatic.value = fx.staticAmt;
    u.uRedTint.value = fx.redTint;
    u.uNoise.value = fx.extraNoise;
    G.uCamPos.value.copy(this.camera.position);
    if (this.voidFall.active) this.voidFall.render(dt);
    else this.post.render(this.scene, this.camera, dt);
  }
}
