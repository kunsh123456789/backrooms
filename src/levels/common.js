import * as THREE from 'three';
import { itemMesh } from './props.js';

const tmp = new THREE.Vector3();

/** Spawn pickups for a chunk. items: [{type, x, y, z, id}] */
export function spawnItems(items, world, game, extra, inter) {
  for (const it of items) {
    if (world.taken.has(it.id)) continue;
    const y = it.y ?? 0.1;
    const s = game.lights.sample(it.x, y + 0.5, it.z, tmp);
    const m = itemMesh(it.type, s);
    if (it.type === 'almond') m.position.set(it.x, y + 0.1, it.z);
    else if (it.type === 'battery') m.position.set(it.x, y + 0.05, it.z);
    else m.position.set(it.x, y + 0.004, it.z);
    m.rotation.y = it.rot ?? 0;
    if (it.type === 'battery') m.rotation.z = Math.PI / 2;
    extra.push(m);
    const label = it.type === 'almond' ? 'Almond Water' : it.type === 'battery' ? 'Battery' : 'Note';
    inter.push({
      x: it.x, y: y + 0.2, z: it.z, r: 1.8, prompt: (it.type === 'note' ? 'Read ' : 'Take ') + label.toLowerCase(),
      use(g) {
        world.taken.add(it.id);
        m.visible = false;
        inter.splice(inter.indexOf(this), 1);
        const i = world.interactables.indexOf(this);
        if (i >= 0) world.interactables.splice(i, 1);
        g.pickup(it.type, it);
      },
    });
  }
}

/** Register looping audio emitters for a chunk; returns a dispose fn. */
export function spawnEmitters(list, game) {
  const es = [];
  for (const e of list) es.push(game.audio.addEmitter(new THREE.Vector3(e.x, e.y ?? 1.5, e.z), e.build, e.opts || {}));
  return () => {
    for (const e of es) game.audio.removeEmitter(e);
  };
}
