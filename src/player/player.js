import * as THREE from 'three';
import { clamp, damp, lerp, valueNoise2 } from '../core/math.js';

// First-person controller with a human-held camera: head bob tied to footsteps,
// breathing sway, low-frequency handheld drift. Stamina and sanity are never
// shown as bars; they come through breathing, vision and sound.

const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor(camera, game) {
    this.camera = camera;
    this.game = game;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.radius = 0.3;
    this.crouch = 0; // 0..1
    this.eye = 1.62;
    this.onGround = true;
    this.stepPhase = 0;
    this.stepDist = 0;
    this.bob = 0;
    this.stamina = 1;
    this.exhausted = false;
    this.exertion = 0; // drives breathing
    this.fear = 0; // drives breathing too
    this.sanity = 100;
    this.flashlight = false;
    this.battery = 1;
    this.inv = { almond: 0, batteries: 0, notes: [] };
    this.t = 0;
    this.speed = 0;
    this.sprinting = false;
    this.moving = false;
    this.frozen = false; // cutscenes
    this.lookFrozen = false;
    this.surface = 'carpet';
    this.inWater = 0;
    this.floorY = 0;
    this.roll = 0;
    this.breathT = 0;
    this.breathIn = true;
    this.noise = 0; // how loud the player is (for hounds)
    this.speedMul = 1;
    this.staminaMul = 1;
    this.lastSafe = new THREE.Vector3();
    this.camOffset = new THREE.Vector3(); // extra scripted offset
    this.headroom = 99;
  }

  place(x, y, z, yaw = 0) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.yaw = yaw;
    this.pitch = 0;
    this.floorY = y;
    this.lastSafe.copy(this.pos);
  }

  look(dx, dy, sens, invert) {
    if (this.lookFrozen) return;
    const k = 0.0021 * sens;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (invert ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.45, 1.45);
  }

  update(dt, input, world, settings) {
    this.t += dt;
    const g = this.game;
    // --- input ---
    let fx = 0, fz = 0;
    if (!this.frozen) {
      if (input.down('KeyW') || input.down('ArrowUp')) fz -= 1;
      if (input.down('KeyS') || input.down('ArrowDown')) fz += 1;
      if (input.down('KeyA') || input.down('ArrowLeft')) fx -= 1;
      if (input.down('KeyD') || input.down('ArrowRight')) fx += 1;
    }
    const wantCrouch = !this.frozen && (input.down('KeyC') || input.down('ControlLeft'));
    const len = Math.hypot(fx, fz);
    if (len > 0) {
      fx /= len;
      fz /= len;
    }
    // head clearance forces crouch
    const forcedCrouch = this.headroom < 1.75;
    this.crouch = damp(this.crouch, wantCrouch || forcedCrouch ? 1 : 0, 10, dt);
    const wantSprint = !this.frozen && (input.down('ShiftLeft') || input.down('ShiftRight')) && fz < 0 && this.crouch < 0.3;
    if (this.stamina <= 0.01) this.exhausted = true;
    if (this.exhausted && this.stamina > 0.35) this.exhausted = false;
    this.sprinting = wantSprint && !this.exhausted && len > 0;

    let speed = 2.05;
    if (this.sprinting) speed = 4.6;
    if (this.crouch > 0.5) speed = 1.05;
    if (this.exhausted) speed = Math.min(speed, 1.7);
    speed *= 1 - this.inWater * 0.45;
    speed *= this.speedMul;

    // world-space wish direction
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const wx = fx * c + fz * s;
    const wz = -fx * s + fz * c;
    const accel = len > 0 ? 9 : 11;
    this.vel.x = damp(this.vel.x, wx * speed, accel, dt);
    this.vel.z = damp(this.vel.z, wz * speed, accel, dt);

    // stamina
    if (this.sprinting) this.stamina -= (dt / 9) / this.staminaMul;
    else this.stamina += dt / (this.moving ? 16 : 10) * (this.exhausted ? 0.7 : 1);
    this.stamina = clamp(this.stamina, 0, 1);
    const exTarget = this.sprinting ? 1 : this.exhausted ? 0.9 : (1 - this.stamina) * 0.8;
    this.exertion = damp(this.exertion, exTarget, this.sprinting ? 0.6 : 0.25, dt);

    // --- move with collision ---
    const prevX = this.pos.x, prevZ = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const headY = this.pos.y + this.currentEye() + 0.1;
    const hitWall = world.collide(this.pos, this.radius, this.pos.y + 0.35, headY);
    const moved = Math.hypot(this.pos.x - prevX, this.pos.z - prevZ);
    this.speed = moved / Math.max(dt, 1e-4);
    this.moving = this.speed > 0.3;
    this.pushT = hitWall && fz < 0 && this.speed < 0.5 ? (this.pushT || 0) + dt : 0;

    // --- floor / gravity ---
    const fl = world.floorAt(this.pos.x, this.pos.z, this.pos.y);
    this.zone = fl.zone;
    const floorY = fl.y;
    if (this.pos.y > floorY + 0.02 || floorY < this.pos.y - 0.5) {
      this.vy -= 18 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= floorY) {
        if (this.vy < -4 && g.onLand) g.onLand(-this.vy);
        this.pos.y = floorY;
        this.vy = 0;
      }
      this.onGround = this.pos.y <= floorY + 0.02;
    } else {
      // step up smoothly
      this.pos.y = damp(this.pos.y, floorY, 18, dt);
      this.vy = 0;
      this.onGround = true;
    }
    this.floorY = floorY;
    if (this.onGround && floorY > -50) this.lastSafe.copy(this.pos);

    // water depth & surface
    const wl = g.level?.waterLevel;
    this.inWater = wl !== undefined && wl > this.pos.y ? clamp((wl - this.pos.y) / 0.7, 0, 1) : 0;
    this.surface = this.inWater > 0.05 ? 'water' : (g.level?.surfaceAt?.(this.pos.x, this.pos.z, world, this.zone) ?? 'carpet');

    // --- footsteps / bob ---
    if (this.onGround && this.moving) {
      const stride = this.sprinting ? 1.05 : this.crouch > 0.5 ? 0.55 : 0.78;
      this.stepDist += moved;
      this.stepPhase += moved / stride;
      if (this.stepDist >= stride) {
        this.stepDist -= stride;
        const loud = this.sprinting ? 1 : this.crouch > 0.5 ? 0.25 : 0.55;
        this.noise = Math.max(this.noise, loud);
        if (g.onStep) g.onStep(this.surface, loud);
      }
    } else {
      this.stepDist = Math.min(this.stepDist, 0.5);
    }
    this.noise = Math.max(0, this.noise - dt * 0.8);

    // breathing (audio handled by game; we expose a 0..1 cycle)
    this._camera(dt, settings);
  }

  currentEye() {
    return lerp(this.eye, 1.0, this.crouch) - this.inWater * 0.25;
  }

  _camera(dt, settings) {
    const cam = this.camera;
    const bobOn = settings.get('headBob');
    const sp = clamp(this.speed / 4.6, 0, 1);
    const amp = bobOn ? (this.sprinting ? 0.055 : 0.03) * clamp(this.speed / 2, 0, 1.3) : 0;
    const ph = this.stepPhase * Math.PI;
    const bobY = -Math.abs(Math.sin(ph)) * amp * 1.4 + amp * 0.7;
    const bobX = Math.cos(ph) * amp * 0.6;
    // breathing sway (stronger when exerted)
    this.breathPhase = (this.breathPhase || 0) + dt * (0.9 + this.exertion * 2.2 + this.fear * 1.2);
    const br = Math.sin(this.breathPhase) * (0.004 + this.exertion * 0.012);
    // handheld drift: slow, smooth noise
    const t = this.t;
    const hx = (valueNoise2(t * 0.35, 1.3, 11) - 0.5) * 0.012 * (1 + this.fear);
    const hy = (valueNoise2(t * 0.3, 7.1, 12) - 0.5) * 0.01 * (1 + this.fear);
    const hr = (valueNoise2(t * 0.25, 3.7, 13) - 0.5) * 0.012;
    // roll into strafes
    const side = this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw);
    this.roll = damp(this.roll, -side * 0.006 * (bobOn ? 1 : 0.3), 4, dt);

    const eye = this.currentEye();
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    cam.position.set(this.pos.x + bobX * c, this.pos.y + eye + bobY + br * 2, this.pos.z - bobX * s);
    cam.position.add(this.camOffset);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw + hx;
    cam.rotation.x = this.pitch + hy + br + Math.sin(ph * 2) * amp * 0.08;
    cam.rotation.z = this.roll + hr + bobX * 0.15;
    this.bob = sp;
  }

  forward(out = new THREE.Vector3()) {
    return this.camera.getWorldDirection(out);
  }
}

export { UP };
