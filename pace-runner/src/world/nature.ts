import * as THREE from 'three';
import { ROAD_HALF } from '../game/constants';
import type { Course } from '../route/course';
import { mulberry32 } from '../route/samples';
import { GROUND, toon } from './scene';

/** Grid of course samples for "how far is this point from the road?" queries. */
class RoadGrid {
  private cells = new Map<string, number[]>();
  constructor(private course: Course, private cell = 8) {
    course.samples.forEach((s, i) => {
      const key = `${Math.floor(s.x / cell)},${Math.floor(s.z / cell)}`;
      const list = this.cells.get(key);
      if (list) list.push(i);
      else this.cells.set(key, [i]);
    });
  }
  /** Distance to the road centreline, capped at 2 cells. */
  distance(x: number, z: number): number {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = this.cell * 2;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        const list = this.cells.get(`${cx + dx},${cz + dz}`);
        if (!list) continue;
        for (const i of list) {
          const s = this.course.samples[i];
          const d = Math.hypot(s.x - x, s.z - z);
          if (d < best) best = d;
        }
      }
    return best;
  }
}

export interface NatureView {
  group: THREE.Group;
  update(time: number): void;
}

const windUniform = { value: 0 };

function grassBlade(): THREE.BufferGeometry {
  // tapered 3-segment blade, base at y=0, tip at y=1
  const w = 0.09;
  const pos = [-w, 0, 0, w, 0, 0, -w * 0.75, 0.4, 0, w * 0.75, 0.4, 0, -w * 0.4, 0.75, 0, w * 0.4, 0.75, 0, 0, 1, 0];
  const idx = [0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 4, 5, 6];
  const base = new THREE.Color('#5f9f45');
  const tip = new THREE.Color('#d8f0a0');
  const col: number[] = [];
  for (let i = 0; i < pos.length; i += 3) {
    const c = base.clone().lerp(tip, pos[i + 1]);
    col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // all normals up: blades shade like the ground, which reads as a soft lawn
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

function windMaterial(): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = windUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 ip = instanceMatrix[3].xz;
          float h = position.y * position.y;
          float sway = sin(uWind * 1.7 + ip.x * 0.12 + ip.y * 0.09) * 0.22 + sin(uWind * 3.3 + ip.x * 0.5) * 0.06;
          transformed.x += sway * h;
          transformed.z += sway * 0.6 * h;
        #endif`,
      );
  };
  return m;
}

export function buildNature(course: Course): NatureView {
  const group = new THREE.Group();
  const rnd = mulberry32(course.run.id.length * 7919 + course.samples.length);
  const grid = new RoadGrid(course);
  const b = course.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), toon(GROUND));
  ground.rotation.x = -Math.PI / 2;
  ground.scale.set(b.maxX - b.minX + 1600, b.maxZ - b.minZ + 1600, 1);
  ground.position.set(cx, 0, cz);
  ground.receiveShadow = true;
  group.add(ground);

  /** Random point beside the road at a lateral distance in [near, far]; null if it lands on road. */
  const beside = (near: number, far: number, clearance: number) => {
    const s = course.samples[Math.floor(rnd() * course.samples.length)];
    const side = rnd() < 0.5 ? -1 : 1;
    const off = side * (near + rnd() * (far - near));
    const x = s.x - s.tz * off + (rnd() - 0.5) * 2;
    const z = s.z + s.tx * off + (rnd() - 0.5) * 2;
    return grid.distance(x, z) < clearance ? null : { x, z };
  };

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const c = new THREE.Color();

  // Grass — dense along the shoulders, swaying in the wind.
  const grassCount = Math.round(course.length * 13);
  const grass = new THREE.InstancedMesh(grassBlade(), windMaterial(), grassCount);
  let gi = 0;
  for (let tries = 0; gi < grassCount && tries < grassCount * 3; tries++) {
    const p = beside(ROAD_HALF + 0.9, ROAD_HALF + 16, ROAD_HALF + 0.9);
    if (!p) continue;
    e.set(0, rnd() * Math.PI, 0);
    const h = 0.5 + rnd() * 0.8;
    m4.compose(v.set(p.x, 0, p.z), q.setFromEuler(e), sc.set(1, h, 1));
    grass.setMatrixAt(gi, m4);
    grass.setColorAt(gi, c.setHSL(0.24 + rnd() * 0.06, 0.45, 0.75 + rnd() * 0.2));
    gi++;
  }
  grass.count = gi;
  group.add(grass);

  // Flowers
  const flowerCount = Math.round(course.length * 1.2);
  const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.2, 0), toon('#ffffff'), flowerCount);
  const flowerColors = ['#ffffff', '#ffb3c7', '#ffe17a', '#c9b6ff'];
  let fi = 0;
  for (let tries = 0; fi < flowerCount && tries < flowerCount * 3; tries++) {
    const p = beside(ROAD_HALF + 1.2, ROAD_HALF + 12, ROAD_HALF + 1.2);
    if (!p) continue;
    m4.compose(v.set(p.x, 0.35 + rnd() * 0.2, p.z), q.identity(), sc.setScalar(0.7 + rnd() * 0.6));
    flowers.setMatrixAt(fi, m4);
    flowers.setColorAt(fi, c.set(flowerColors[Math.floor(rnd() * flowerColors.length)]));
    fi++;
  }
  flowers.count = fi;
  group.add(flowers);

  // Lollipop trees + round bushes
  const treeCount = Math.round(course.length / 5);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.32, 2.6, 8).translate(0, 1.3, 0), toon('#b98a62'), treeCount);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.9, 3), toon('#ffffff'), treeCount);
  const crownColors = ['#7cc26b', '#94d070', '#6db86a', '#f6b8c8', '#ffd38a'];
  let ti = 0;
  for (let tries = 0; ti < treeCount && tries < treeCount * 4; tries++) {
    const p = beside(ROAD_HALF + 5, ROAD_HALF + 70, ROAD_HALF + 5);
    if (!p) continue;
    const s = 0.8 + rnd() * 0.7;
    m4.compose(v.set(p.x, 0, p.z), q.identity(), sc.setScalar(s));
    trunks.setMatrixAt(ti, m4);
    m4.compose(v.set(p.x, 2.9 * s + 1.2 * s, p.z), q.identity(), sc.set(s, s * (0.95 + rnd() * 0.25), s));
    crowns.setMatrixAt(ti, m4);
    crowns.setColorAt(ti, c.set(crownColors[rnd() < 0.8 ? Math.floor(rnd() * 3) : 3 + Math.floor(rnd() * 2)]));
    ti++;
  }
  trunks.count = crowns.count = ti;
  trunks.castShadow = crowns.castShadow = true;
  group.add(trunks, crowns);

  const bushCount = Math.round(course.length / 8);
  const bushes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), toon('#ffffff'), bushCount);
  let bi = 0;
  for (let tries = 0; bi < bushCount && tries < bushCount * 4; tries++) {
    const p = beside(ROAD_HALF + 2.6, ROAD_HALF + 9, ROAD_HALF + 2.6);
    if (!p) continue;
    const s = 0.6 + rnd() * 0.7;
    m4.compose(v.set(p.x, s * 0.45, p.z), q.identity(), sc.set(s * 1.3, s * 0.85, s * 1.2));
    bushes.setMatrixAt(bi, m4);
    bushes.setColorAt(bi, c.set('#6fb35a').offsetHSL(rnd() * 0.04, 0, rnd() * 0.08));
    bi++;
  }
  bushes.count = bi;
  bushes.castShadow = true;
  group.add(bushes);

  // Puffy clouds — no fog so they stay white against the sky.
  const cloudMat = toon('#ffffff', { fog: false, transparent: true, opacity: 0.95 });
  const puff = new THREE.IcosahedronGeometry(1, 2);
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 400;
  for (let i = 0; i < 26; i++) {
    const cloud = new THREE.Group();
    const parts = 4 + Math.floor(rnd() * 4);
    for (let k = 0; k < parts; k++) {
      const m = new THREE.Mesh(puff, cloudMat);
      const r = 8 + rnd() * 10;
      m.scale.set(r, r * 0.7, r);
      m.position.set((k - parts / 2) * 9 + rnd() * 4, rnd() * 5, rnd() * 8);
      cloud.add(m);
    }
    cloud.position.set(cx + (rnd() - 0.5) * span, 85 + rnd() * 50, cz + (rnd() - 0.5) * span);
    cloud.rotation.y = rnd() * Math.PI;
    group.add(cloud);
  }

  return {
    group,
    update(time) {
      windUniform.value = time;
    },
  };
}
