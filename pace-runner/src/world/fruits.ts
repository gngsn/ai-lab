import * as THREE from 'three';
import { worldAt, type Course } from '../route/course';
import { pickupVisible } from './road';
import { toon } from './scene';

export interface FruitsView {
  group: THREE.Group;
  update(time: number, taken: Set<number>, playerS?: number): void;
}

/** Curved yellow banana with brown tips. */
function banana(): THREE.Group {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.55, 0.25, 0),
    new THREE.Vector3(-0.25, -0.08, 0),
    new THREE.Vector3(0.2, -0.12, 0),
    new THREE.Vector3(0.55, 0.22, 0),
  ]);
  const body = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.17, 12, false), toon('#ffd84d'));
  g.add(body);
  for (const [t, color] of [
    [0, '#8a5a2b'],
    [1, '#6b8a2b'],
  ] as const) {
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), toon(color));
    tip.position.copy(curve.getPoint(t));
    g.add(tip);
  }
  return g;
}

/** One shine-muscat grape: glossy green sphere with a tiny stem. */
function muscat(): THREE.Group {
  const g = new THREE.Group();
  const grape = new THREE.Mesh(new THREE.SphereGeometry(0.42, 28, 20), toon('#b8e86a', { emissive: '#3f6b12', emissiveIntensity: 0.25 }));
  grape.scale.set(1, 1.08, 1);
  const glint = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: '#f4ffe0' }));
  glint.position.set(-0.16, 0.2, 0.33);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.22, 8), toon('#7a9a3a'));
  stem.position.y = 0.52;
  stem.rotation.z = 0.25;
  g.add(grape, glint, stem);
  return g;
}

const POP_TIME = 0.35;

/** Floating banana / shine-muscat pickups with a pulsing ground ring. */
export function buildFruits(course: Course): FruitsView {
  const group = new THREE.Group();
  const items = course.items.map((item) => {
    const p = worldAt(course, item.s, item.lateral);
    const root = new THREE.Group();
    root.position.set(p.x, 0, p.z);
    const model = item.kind === 'banana' ? banana() : muscat();
    model.scale.setScalar(1.4);
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.35, 32),
      new THREE.MeshBasicMaterial({ color: item.kind === 'banana' ? '#ffe27a' : '#cdf28a', transparent: true, opacity: 0.5, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.09;
    root.add(model, ring);
    group.add(root);
    return { root, model, ring, pickedAt: -1 };
  });
  let seen = 0;

  return {
    group,
    update(time, taken, playerS) {
      if (taken.size < seen) for (const it of items) it.pickedAt = -1;
      seen = taken.size;
      items.forEach((it, i) => {
        if (taken.has(i) && it.pickedAt < 0) it.pickedAt = time;
        const age = it.pickedAt < 0 ? -1 : time - it.pickedAt;
        const ringMat = it.ring.material as THREE.MeshBasicMaterial;
        if (age < 0) {
          it.root.visible = pickupVisible(course.items[i].s, playerS);
          it.model.position.y = 1.3 + Math.sin(time * 2.6 + i) * 0.15;
          it.model.rotation.set(0, time * 1.8 + i, 0);
          it.model.scale.setScalar(1.4);
          const pulse = (time * 0.9 + i * 0.3) % 1;
          it.ring.scale.setScalar(0.8 + pulse * 0.5);
          ringMat.opacity = 0.5 * (1 - pulse);
        } else if (age < POP_TIME) {
          const k = age / POP_TIME;
          it.model.position.y = 1.3 + k * 2.5;
          it.model.scale.setScalar(1.4 * (1 + k * 0.4 - k * k * 1.4));
          ringMat.opacity = 0;
        } else {
          it.root.visible = false;
        }
      });
    },
  };
}
