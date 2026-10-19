import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { worldAt, type Course } from '../route/course';
import { pickupVisible } from './road';
import { toon } from './scene';

export interface GelsView {
  group: THREE.Group;
  update(time: number, taken: Set<number>, playerS?: number): void;
}

function labelTexture(km: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 360;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.font = '700 46px Lexend, sans-serif';
  g.fillText('ENERGY', 128, 70);
  g.font = '800 120px Lexend, sans-serif';
  g.fillText('GEL', 128, 190);
  // lightning bolt
  g.beginPath();
  g.moveTo(140, 214);
  g.lineTo(98, 282);
  g.lineTo(126, 282);
  g.lineTo(112, 340);
  g.lineTo(160, 262);
  g.lineTo(132, 262);
  g.closePath();
  g.fill();
  g.font = '600 34px Lexend, sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillText(`${km}K`, 210, 330);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft toy energy-gel pouch: red body, pink shoulders and tear-off cap, white label. */
function pouch(km: number): THREE.Group {
  const g = new THREE.Group();
  const red = toon('#e8414f');
  const pink = toon('#f4899a');
  const light = toon('#f8a9b4');

  const body = new THREE.Mesh(new RoundedBoxGeometry(1.0, 1.3, 0.32, 4, 0.14), red);
  const band = new THREE.Mesh(new RoundedBoxGeometry(1.02, 0.18, 0.34, 3, 0.08), pink);
  band.position.y = -0.6;
  const shoulder = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.36, 0.26, 4, 0.12), pink);
  shoulder.position.y = 0.76;
  const cap = new THREE.Mesh(new RoundedBoxGeometry(0.78, 0.2, 0.2, 3, 0.08), light);
  cap.position.y = 0.98;
  g.add(body, band, shoulder, cap);

  const labelMat = new THREE.MeshBasicMaterial({ map: labelTexture(km), transparent: true, depthWrite: false });
  for (const side of [1, -1]) {
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.0), labelMat);
    label.position.set(0, 0.02, side * 0.165);
    if (side < 0) label.rotation.y = Math.PI;
    g.add(label);
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material !== labelMat) o.castShadow = true;
  });
  return g;
}

const POP_TIME = 0.4;

/** Big floating gel pouches with a pulsing ground halo. */
export function buildGels(course: Course): GelsView {
  const group = new THREE.Group();
  const items = course.gels.map((gel) => {
    const p = worldAt(course, gel.s, gel.lateral);
    const root = new THREE.Group();
    root.position.set(p.x, 0, p.z);
    root.rotation.y = Math.atan2(p.tx, p.tz) + Math.PI; // label faces the runner
    const model = pouch(gel.km);
    model.scale.setScalar(1.6);
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 2.3, 40),
      new THREE.MeshBasicMaterial({ color: '#ff8fa3', transparent: true, opacity: 0.5, depthWrite: false }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.09;
    root.add(model, halo);
    group.add(root);
    return { root, model, halo, pickedAt: -1 };
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
        const haloMat = it.halo.material as THREE.MeshBasicMaterial;
        if (age < 0) {
          it.root.visible = pickupVisible(course.gels[i].s, playerS);
          it.model.position.y = 1.8 + Math.sin(time * 2.4) * 0.18;
          it.model.rotation.set(0, Math.sin(time * 1.6) * 0.5, Math.sin(time * 2.1) * 0.08);
          it.model.scale.setScalar(1.6);
          const pulse = (time * 0.8) % 1;
          it.halo.scale.setScalar(0.8 + pulse * 0.5);
          haloMat.opacity = 0.55 * (1 - pulse);
        } else if (age < POP_TIME) {
          const k = age / POP_TIME;
          it.model.position.y = 1.8 + k * 3;
          it.model.rotation.y += 0.4;
          it.model.scale.setScalar(1.6 * (1 + k * 0.4 - k * k * 1.4));
          haloMat.opacity = 0;
        } else {
          it.root.visible = false;
        }
      });
    },
  };
}
