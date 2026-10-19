import * as THREE from 'three';
import { PACE_COLORS, ROAD_HALF, TURBO_PAD_HALF_WIDTH } from '../game/constants';
import { worldAt, type Course } from '../route/course';
import { toon } from './scene';

/** Pastel-ised pace colours for the road surface. */
const ROAD_COLORS = PACE_COLORS.map((c) => new THREE.Color(c).lerp(new THREE.Color('#fff8ec'), 0.1));

/** Samples per road chunk (~1/25 of the course). Chunks are re-ordered every frame. */
const CHUNK = 48;
/** Pickups further than this behind / ahead of the runner are hidden (stops the other pass of an overlapping route from showing its coins on your road). */
export const PICKUP_BEHIND = 30;
export const PICKUP_AHEAD = 450;

export function pickupVisible(s: number, playerS: number | undefined): boolean {
  return playerS === undefined || (s > playerS - PICKUP_BEHIND && s < playerS + PICKUP_AHEAD);
}

/** Ribbon along samples [i0, i1] between two lateral offsets. */
function ribbon(course: Course, a0: number, b0: number, y: number, i0: number, i1: number, color?: (i: number) => THREE.Color): THREE.BufferGeometry {
  // keep left edge first so every ribbon winds counter-clockwise seen from above (front face up)
  const from = Math.min(a0, b0);
  const to = Math.max(a0, b0);
  const n = i1 - i0 + 1;
  const pos = new Float32Array(n * 2 * 3);
  const col = color ? new Float32Array(n * 2 * 3) : null;
  const uv = new Float32Array(n * 2 * 2);
  const idx: number[] = [];
  const ds = course.length / (course.samples.length - 1);
  for (let k = 0; k < n; k++) {
    const i = i0 + k;
    const s = course.samples[i];
    const yy = y;
    const lx = s.x - s.tz * from;
    const lz = s.z + s.tx * from;
    const rx = s.x - s.tz * to;
    const rz = s.z + s.tx * to;
    pos.set([lx, yy, lz, rx, yy, rz], k * 6);
    uv.set([0, i * ds, 1, i * ds], k * 4);
    if (col && color) {
      const c = color(i);
      col.set([c.r, c.g, c.b, c.r, c.g, c.b], k * 6);
    }
    if (k < n - 1) {
      const a = k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function chevronTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5fd3ff';
  g.fillRect(0, 0, 64, 128);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 12;
  g.lineJoin = 'round';
  for (const y of [28, 92]) {
    g.beginPath();
    g.moveTo(10, y + 18);
    g.lineTo(32, y - 6);
    g.lineTo(54, y + 18);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface RoadView {
  group: THREE.Group;
  pads: THREE.Mesh[];
  /** playerS: runner's distance along the course, or undefined for overview cameras */
  update(time: number, usedPads: Set<number>, playerS?: number): void;
}

interface RoadChunk {
  /** course distance at the chunk's middle */
  mid: number;
  /** [shoulders, surface, lines] — drawn in this order inside the chunk */
  layers: THREE.Mesh[][];
}

export function buildRoad(course: Course): RoadView {
  const group = new THREE.Group();

  /*
   * Overlapping routes (out-and-back, turnarounds, crossings) put two passes of road on the same
   * spot. The road is split into chunks whose layers don't write depth; every frame the chunks are
   * re-ordered so the ones nearest the runner draw last, i.e. the stretch you're on is always on top.
   */
  const n = course.samples.length;
  const ds = course.length / (n - 1);
  const surfaceMat = toon('#ffffff', { vertexColors: true, depthWrite: false });
  const shoulderMat = toon('#efdfc0', { depthWrite: false });
  const lineMat = new THREE.MeshBasicMaterial({ color: '#ffffff', depthWrite: false });
  const chunks: RoadChunk[] = [];
  for (let i0 = 0; i0 < n - 1; i0 += CHUNK) {
    const i1 = Math.min(n - 1, i0 + CHUNK);
    const shoulders: THREE.Mesh[] = [];
    const lines: THREE.Mesh[] = [];
    for (const sign of [-1, 1]) {
      shoulders.push(new THREE.Mesh(ribbon(course, sign * ROAD_HALF, sign * (ROAD_HALF + 0.9), 0.02, i0, i1), shoulderMat));
      lines.push(new THREE.Mesh(ribbon(course, sign * (ROAD_HALF - 0.45), sign * (ROAD_HALF - 0.2), 0.04, i0, i1), lineMat));
    }
    const surface = new THREE.Mesh(
      ribbon(course, -ROAD_HALF, ROAD_HALF, 0.03, i0, i1, (i) => ROAD_COLORS[course.samples[i].bucket]),
      surfaceMat,
    );
    for (const m of [...shoulders, surface]) m.receiveShadow = true;
    chunks.push({ mid: ((i0 + i1) / 2) * ds, layers: [shoulders, [surface], lines] });
    group.add(...shoulders, surface, ...lines);
  }

  // start / finish stripes belong to their chunk's line layer
  const stripe = (s: number, color: string) => {
    const p = worldAt(course, s, 0);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 1.2), new THREE.MeshBasicMaterial({ color, depthWrite: false }));
    m.rotation.order = 'YXZ';
    m.rotation.y = Math.atan2(p.tx, p.tz);
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, 0.05, p.z);
    chunks[Math.min(chunks.length - 1, Math.floor(s / ds / CHUNK))].layers[2].push(m);
    group.add(m);
  };
  stripe(0.6, '#ffffff');
  stripe(course.length - 0.6, '#333344');

  const order = chunks.map((_, i) => i);
  const applyOrder = (playerS: number | undefined) => {
    // farthest first; with no runner (overview), later stretches draw on top
    if (playerS === undefined) order.sort((a, b) => chunks[a].mid - chunks[b].mid);
    else order.sort((a, b) => Math.abs(chunks[b].mid - playerS) - Math.abs(chunks[a].mid - playerS));
    order.forEach((ci, rank) => {
      chunks[ci].layers.forEach((layer, l) => {
        for (const m of layer) m.renderOrder = 1 + rank * 3 + l;
      });
    });
  };
  applyOrder(undefined);
  group.add(finishArch(course));

  // turbo pads
  const tex = chevronTexture();
  const pads: THREE.Mesh[] = [];
  for (const pad of course.turboPads) {
    const p = worldAt(course, pad.s, pad.lateral);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(TURBO_PAD_HALF_WIDTH * 2, 4.5),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    m.rotation.order = 'YXZ';
    m.rotation.y = Math.atan2(p.tx, p.tz) + Math.PI;
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, 0.08, p.z);
    m.renderOrder = 1 + chunks.length * 3; // above every road layer
    pads.push(m);
    group.add(m);
  }

  return {
    group,
    pads,
    update(time, usedPads, playerS) {
      tex.offset.y = -time * 1.5;
      applyOrder(playerS);
      pads.forEach((m, i) => {
        m.visible = pickupVisible(course.turboPads[i].s, playerS);
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.opacity = usedPads.has(i) ? Math.max(0.15, mat.opacity - 0.05) : 0.95;
      });
    },
  };
}

function finishArch(course: Course): THREE.Group {
  const g = new THREE.Group();
  const p = worldAt(course, course.length - 0.6, 0);
  const pillarMat = toon('#ffffff');
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 5, 6, 12), pillarMat);
    pillar.position.set(side * (ROAD_HALF + 1), 2.9, 0);
    pillar.castShadow = true;
    g.add(pillar);
  }
  // checkered banner
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 4; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#333344' : '#ffffff';
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(ROAD_HALF * 2 + 2.8, 1.4, 0.4),
    [pillarMat, pillarMat, pillarMat, pillarMat, toon('#ffffff', { map: tex }), toon('#ffffff', { map: tex })],
  );
  banner.position.y = 5.8;
  banner.castShadow = true;
  g.add(banner);
  g.position.set(p.x, 0, p.z);
  g.rotation.y = Math.atan2(p.tx, p.tz);
  return g;
}
