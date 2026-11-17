import * as THREE from 'three';
import { tex } from './textures.js';

// The fall between levels: a void of smeared, half-rendered surfaces streaming
// past. Rendered through the normal camcorder pipeline with feedback smear on.

export class VoidFall {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x000000, 0.06);
    this.cam = new THREE.PerspectiveCamera(80, 1, 0.05, 100);
    this.scene.add(this.cam);
    this.planes = [];
    this.active = false;
    this.t = 0;
  }

  begin(texNames) {
    this.active = true;
    this.t = 0;
    for (const p of this.planes) this.scene.remove(p);
    this.planes = [];
    const g = new THREE.PlaneGeometry(1, 1, 4, 4);
    for (let i = 0; i < 70; i++) {
      const t = tex(texNames[i % texNames.length]);
      const m = new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide, transparent: true, opacity: 0.4 + Math.random() * 0.6, color: new THREE.Color().setScalar(0.6 + Math.random() * 1.2) });
      const mesh = new THREE.Mesh(g, m);
      this._place(mesh, true);
      this.scene.add(mesh);
      this.planes.push(mesh);
    }
    this.cam.position.set(0, 0, 0);
    this.cam.rotation.set(-1.2, 0, 0);
    const gc = this.game.camera;
    this.cam.aspect = gc.aspect;
    this.cam.updateProjectionMatrix();
  }

  _place(m, initial) {
    const a = Math.random() * Math.PI * 2;
    const r = 1.5 + Math.random() * 9;
    m.position.set(Math.cos(a) * r, this.cam.position.y - (initial ? Math.random() * 40 : 30 + Math.random() * 15), Math.sin(a) * r);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    const s = 1 + Math.random() * 4;
    // textures stretched long, like geometry failing to resolve
    m.scale.set(s, s * (1 + Math.random() * 7), 1);
    m.userData.spin = (Math.random() - 0.5) * 2;
  }

  end() {
    this.active = false;
  }

  render(dt) {
    this.t += dt;
    const speed = 9 + this.t * 6;
    this.cam.position.y -= speed * dt;
    this.cam.rotation.z += dt * 0.25;
    this.cam.rotation.x = -1.25 + Math.sin(this.t * 0.9) * 0.15;
    for (const p of this.planes) {
      p.rotation.y += p.userData.spin * dt;
      if (p.position.y > this.cam.position.y + 8) this._place(p, false);
      p.visible = Math.random() > 0.05; // half-rendered, popping
    }
    this.game.post.render(this.scene, this.cam, dt);
  }
}
