import * as THREE from 'three';
import { worldMaterial } from '../gfx/materials.js';
import { tex } from '../gfx/textures.js';

// Low-detail figures. They are only ever seen at a distance, in fog, through a
// cheap camera. Less is more.

function mat(tint, emissive = [0, 0, 0], map = 'white') {
  return worldMaterial({ map: tex(map), baked: false, tint, emissive });
}

export function facelingModel() {
  const g = new THREE.Group();
  const skin = mat([0.4, 0.37, 0.34]);
  const cloth = mat([0.05, 0.05, 0.06]);
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.95, 6), cloth);
  legs.position.y = 0.48;
  legs.scale.x = 1.7;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.68, 8), cloth);
  torso.position.y = 1.3;
  torso.scale.z = 0.6;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.12, 6), skin);
  neck.position.y = 1.68;
  // the head: smooth, no features at all
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), skin);
  head.scale.set(0.9, 1.15, 1);
  head.position.y = 1.83;
  const armG = new THREE.CylinderGeometry(0.045, 0.035, 0.75, 5);
  const a1 = new THREE.Mesh(armG, cloth);
  a1.position.set(-0.24, 1.22, 0);
  const a2 = new THREE.Mesh(armG, cloth);
  a2.position.set(0.24, 1.22, 0);
  const handG = new THREE.SphereGeometry(0.045, 6, 5);
  const h1 = new THREE.Mesh(handG, skin);
  h1.position.set(-0.25, 0.83, 0);
  const h2 = new THREE.Mesh(handG, skin);
  h2.position.set(0.25, 0.83, 0);
  g.add(legs, torso, neck, head, a1, a2, h1, h2);
  g.userData.head = head;
  g.userData.mats = [skin, cloth];
  return g;
}

export function silhouetteModel() {
  const g = facelingModel();
  for (const m of g.userData.mats) {
    m.uniforms.uTint.value.setRGB(0.02, 0.02, 0.02);
  }
  return g;
}

export function houndModel() {
  const g = new THREE.Group();
  const skin = mat([0.06, 0.055, 0.05]);
  const eye = worldMaterial({ map: tex('white'), unlit: true, emissive: [2.2, 2.1, 1.8] });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 1.0, 7), skin);
  body.rotation.x = Math.PI / 2 - 0.25;
  body.position.set(0, 0.72, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 7), skin);
  head.scale.set(0.85, 0.8, 1.2);
  head.position.set(0, 0.92, -0.58);
  const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.022, 5, 4), eye);
  e1.position.set(-0.06, 0.96, -0.74);
  const e2 = e1.clone();
  e2.position.x = 0.06;
  g.add(body, head, e1, e2);
  const legG = new THREE.CylinderGeometry(0.04, 0.025, 0.8, 5);
  legG.translate(0, -0.4, 0);
  const legs = [];
  for (const [x, z] of [[-0.16, -0.38], [0.16, -0.38], [-0.15, 0.36], [0.15, 0.36]]) {
    const l = new THREE.Mesh(legG, skin);
    l.position.set(x, 0.8, z);
    g.add(l);
    legs.push(l);
  }
  g.userData.legs = legs;
  g.userData.mats = [skin];
  return g;
}

export function partygoerModel() {
  const g = new THREE.Group();
  const yellow = mat([0.95, 0.8, 0.2], [0.05, 0.04, 0.0]);
  const face = worldMaterial({ map: tex('partyface'), baked: false, emissive: [0.08, 0.07, 0.02] });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 1.3, 10), yellow);
  body.position.y = 0.85;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), yellow);
  head.position.y = 1.72;
  const fg = new THREE.PlaneGeometry(0.34, 0.34);
  const f = new THREE.Mesh(fg, face);
  f.position.set(0, 1.74, -0.235);
  f.rotation.y = Math.PI;
  const armG = new THREE.CylinderGeometry(0.06, 0.05, 0.8, 6);
  const a1 = new THREE.Mesh(armG, yellow);
  a1.position.set(-0.3, 1.1, 0);
  a1.rotation.z = 0.15;
  const a2 = new THREE.Mesh(armG, yellow);
  a2.position.set(0.3, 1.1, 0);
  a2.rotation.z = -0.15;
  g.add(body, head, f, a1, a2);
  g.userData.mats = [yellow, face];
  return g;
}

export function smilerModel() {
  const m = new THREE.SpriteMaterial({ map: tex('smiler'), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 });
  const s = new THREE.Sprite(m);
  s.scale.set(0.9, 0.45, 1);
  return s;
}

export function chaserModel() {
  const g = new THREE.Group();
  const skin = mat([0.03, 0.02, 0.02], [0.05, 0.0, 0.0]);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.2, 2.1, 7), skin);
  body.position.y = 1.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), skin);
  head.position.y = 2.4;
  head.scale.set(1, 1.4, 1);
  const armG = new THREE.CylinderGeometry(0.06, 0.04, 1.6, 5);
  const a1 = new THREE.Mesh(armG, skin);
  a1.position.set(-0.45, 1.3, 0);
  a1.rotation.z = 0.3;
  const a2 = new THREE.Mesh(armG, skin);
  a2.position.set(0.45, 1.3, 0);
  a2.rotation.z = -0.3;
  g.add(body, head, a1, a2);
  g.userData.mats = [skin];
  return g;
}
