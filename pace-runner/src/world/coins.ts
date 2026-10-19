import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { worldAt, type Course } from '../route/course';
import { pickupVisible } from './road';
import { toon } from './scene';

export interface CoinsView {
  group: THREE.Group;
  /** collected = indices picked up in the current run */
  update(time: number, collected: Set<number>, playerS?: number): void;
}

const POP_TIME = 0.28;
const R = 0.7;
const HALF_T = 0.12;

/** Raised "$": an S-curve tube plus short stubs above and below, facing +z. */
function dollarGeometry(): THREE.BufferGeometry {
  const pts = [
    [0.17, 0.19],
    [0.07, 0.26],
    [-0.08, 0.26],
    [-0.17, 0.17],
    [-0.14, 0.05],
    [0, 0],
    [0.14, -0.05],
    [0.17, -0.17],
    [0.08, -0.26],
    [-0.07, -0.26],
    [-0.17, -0.19],
  ].map(([x, y]) => new THREE.Vector3(x, y, 0));
  const s = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.05, 10, false);
  const top = new THREE.CapsuleGeometry(0.045, 0.08, 4, 10).translate(0, 0.35, 0);
  const bottom = new THREE.CapsuleGeometry(0.045, 0.08, 4, 10).translate(0, -0.35, 0);
  return mergeGeometries([s, top, bottom])!;
}

/** Both faces of a part: the front copy at +z, a mirrored copy at -z. */
function bothFaces(geo: THREE.BufferGeometry, z: number): THREE.BufferGeometry {
  const front = geo.clone().translate(0, 0, z);
  const back = geo.clone().rotateY(Math.PI).translate(0, 0, -z);
  return mergeGeometries([front, back])!;
}

/**
 * Soft matte toy coin (reference: rounded gold coin with a raised $):
 * orange edge band, slightly orange recessed face, thick pale-gold rim and symbol.
 */
export function coinParts(): { edge: THREE.BufferGeometry; face: THREE.BufferGeometry; gold: THREE.BufferGeometry } {
  const edge = new THREE.CylinderGeometry(R, R, HALF_T * 2, 48, 1, true).rotateX(Math.PI / 2);
  const face = bothFaces(new THREE.CircleGeometry(R - 0.08, 48), HALF_T);
  const rim = bothFaces(new THREE.TorusGeometry(R - 0.1, 0.1, 14, 56), HALF_T);
  const dollar = bothFaces(dollarGeometry(), HALF_T + 0.01);
  const gold = mergeGeometries([rim, dollar])!;
  return { edge, face, gold };
}

export const COIN_COLORS = { edge: '#f39a3d', face: '#fdbd4e', gold: '#ffd668' };

/** Spinning, bobbing coins; picked-up coins pop up and vanish. */
export function buildCoins(course: Course): CoinsView {
  const group = new THREE.Group();
  const n = course.coins.length;
  const parts = coinParts();
  const meshes = (Object.keys(parts) as (keyof typeof parts)[]).map((k) => {
    const m = new THREE.InstancedMesh(parts[k], toon(COIN_COLORS[k], { side: k === 'edge' ? THREE.DoubleSide : THREE.FrontSide }), n);
    m.castShadow = k === 'edge';
    group.add(m);
    return m;
  });

  const base = course.coins.map((c) => {
    const p = worldAt(course, c.s, c.lateral);
    return new THREE.Vector3(p.x, 1.1, p.z);
  });
  const pickedAt = new Float32Array(n).fill(-1);
  let seen = 0;

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();

  return {
    group,
    update(time, collected, playerS) {
      if (collected.size < seen) pickedAt.fill(-1); // new run
      seen = collected.size;
      for (let i = 0; i < n; i++) {
        if (collected.has(i) && pickedAt[i] < 0) pickedAt[i] = time;
        const age = pickedAt[i] < 0 ? -1 : time - pickedAt[i];
        let s = pickupVisible(course.coins[i].s, playerS) ? 1 : 0;
        let lift = Math.sin(time * 3 + i * 0.7) * 0.12;
        let spin = time * 2.2 + i * 0.45;
        if (age >= 0) {
          if (age > POP_TIME) {
            s = 0;
          } else {
            const k = age / POP_TIME;
            s = 1 + k * 0.6 - k * k * 1.6;
            lift += k * 2.2;
            spin += k * 12;
          }
        }
        // slight forward tilt like the reference, so the face catches the light
        e.set(-0.18, spin, 0, 'YXZ');
        m4.compose(v.copy(base[i]).setY(base[i].y + lift), q.setFromEuler(e), sc.setScalar(Math.max(0, s)));
        for (const m of meshes) m.setMatrixAt(i, m4);
      }
      for (const m of meshes) m.instanceMatrix.needsUpdate = true;
    },
  };
}
