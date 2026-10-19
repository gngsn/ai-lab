import * as THREE from 'three';
import { toon } from './scene';

export type CharacterId = 'hoodie' | 'sprout' | 'dizzy' | 'bloom' | 'beanie';

export const CHARACTERS: { id: CharacterId; name: string; blurb: string }[] = [
  { id: 'hoodie', name: 'Hoodie', blurb: 'Mint hood kid' },
  { id: 'sprout', name: 'Sprout', blurb: 'Leafy smiler' },
  { id: 'dizzy', name: 'Dizzy', blurb: 'Giggly sprout' },
  { id: 'bloom', name: 'Bloom', blurb: 'Walking flower pot' },
  { id: 'beanie', name: 'Beanie', blurb: 'Cozy beanie walker' },
];

export interface Runner {
  group: THREE.Group;
  /** speed in units/s drives the stride; steer leans the body */
  update(dt: number, speed: number, steer: number, turbo: boolean): void;
  /** idle bounce for menus / countdown */
  idle(time: number): void;
  celebrate(time: number): void;
}

/** A colour, or a bottom→top gradient painted into vertex colours. */
type Paint = string | string[];

/** Pivots every character exposes so the shared animation can drive it. */
interface Rig {
  body: THREE.Group;
  head: THREE.Group;
  arms: [THREE.Group, THREE.Group];
  legs: [THREE.Group, THREE.Group];
  /** hip height of the leg pivots */
  hipY: number;
  /** resting outward spread of the arms (radians) */
  armRest: number;
}

interface Kit {
  mesh(geo: THREE.BufferGeometry, paint: Paint): THREE.Mesh;
  ghost: boolean;
}

/** Bake a vertical gradient (stops evenly spaced bottom→top) into vertex colours. */
function paintGradient(geo: THREE.BufferGeometry, stops: string[]): void {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox!;
  const pos = geo.getAttribute('position');
  const cols = stops.map((s) => new THREE.Color(s));
  const out = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - min.y) / Math.max(1e-6, max.y - min.y);
    const f = t * (cols.length - 1);
    const k = Math.min(cols.length - 2, Math.floor(f));
    c.copy(cols[k]).lerp(cols[k + 1], f - k);
    out.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
}

function makeKit(ghost: boolean): Kit {
  const ghostMat = new THREE.MeshBasicMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.42, depthWrite: false });
  return {
    ghost,
    mesh(geo, paint) {
      if (ghost) return new THREE.Mesh(geo, ghostMat);
      if (Array.isArray(paint)) {
        paintGradient(geo, paint);
        return new THREE.Mesh(geo, toon('#ffffff', { vertexColors: true }));
      }
      return new THREE.Mesh(geo, toon(paint));
    },
  };
}

const sphere = (r: number, w = 28, h = 20) => new THREE.SphereGeometry(r, w, h);
const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 8, 16);

/** Limb that hangs from a pivot: capsule of `len` plus an optional tip mesh at the end. */
function limb(kit: Kit, len: number, r: number, paint: Paint, tip?: THREE.Object3D): THREE.Group {
  const pivot = new THREE.Group();
  const m = kit.mesh(capsule(r, len), paint);
  m.position.y = -len / 2 - r * 0.5;
  pivot.add(m);
  if (tip) {
    tip.position.y = -len - r;
    pivot.add(tip);
  }
  return pivot;
}

interface FaceParts {
  eyes: 'googly' | 'happy' | 'beads' | 'x';
  eyeX: number;
  eyeY: number;
  /** depth of the face surface */
  z: number;
  mouth: 'smile' | 'lips' | 'open';
  lipColor?: string;
  cheeks?: boolean;
  nose?: boolean;
}

function face(kit: Kit, head: THREE.Group, parts: FaceParts) {
  if (kit.ghost) return;
  const black = new THREE.MeshBasicMaterial({ color: '#2b2233' });
  for (const sx of [-1, 1]) {
    const ex = sx * parts.eyeX;
    if (parts.eyes === 'googly') {
      const white = new THREE.Mesh(sphere(0.13, 20, 14), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      white.scale.set(1, 1, 0.45);
      white.position.set(ex, parts.eyeY, parts.z);
      const pupil = new THREE.Mesh(sphere(0.09, 16, 12), black);
      pupil.scale.set(1, 1, 0.45);
      pupil.position.set(ex, parts.eyeY, parts.z + 0.045);
      head.add(white, pupil);
    } else if (parts.eyes === 'happy') {
      // closed, smiling ∩ eyes
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.022, 8, 16, Math.PI), black);
      arc.position.set(ex, parts.eyeY, parts.z);
      head.add(arc);
    } else if (parts.eyes === 'beads') {
      // glossy black bead eyes with a tiny highlight
      const bead = kit.mesh(sphere(0.105, 20, 14), '#2b2233');
      bead.scale.set(1, 1, 0.6);
      bead.position.set(ex, parts.eyeY, parts.z);
      const glint = new THREE.Mesh(sphere(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      glint.position.set(ex - 0.03, parts.eyeY + 0.035, parts.z + 0.06);
      head.add(bead, glint);
    } else {
      // ✕ eyes: two crossed capsules
      for (const r of [Math.PI / 4, -Math.PI / 4]) {
        const bar = new THREE.Mesh(capsule(0.024, 0.13), black);
        bar.rotation.z = r;
        bar.position.set(ex, parts.eyeY, parts.z);
        head.add(bar);
      }
    }
    if (parts.cheeks) {
      const cheek = new THREE.Mesh(
        new THREE.CircleGeometry(0.085, 16),
        new THREE.MeshBasicMaterial({ color: '#ff9fb4', transparent: true, opacity: 0.85 }),
      );
      cheek.position.set(sx * (parts.eyeX + 0.12), parts.eyeY - 0.13, parts.z - 0.04);
      cheek.rotation.y = sx * 0.45;
      head.add(cheek);
    }
  }
  if (parts.nose) {
    const nose = kit.mesh(sphere(0.065, 14, 10), '#f07d5e');
    nose.position.set(0, parts.eyeY - 0.12, parts.z + 0.03);
    head.add(nose);
  }
  if (parts.mouth === 'lips') {
    const lips = kit.mesh(new THREE.TorusGeometry(0.11, 0.055, 10, 24), parts.lipColor ?? '#f2876a');
    lips.scale.set(1.35, 0.55, 0.8);
    lips.position.set(0, parts.eyeY - 0.28, parts.z - 0.02);
    head.add(lips);
  } else if (parts.mouth === 'open') {
    // big laughing mouth: shallow lower-half bowls that bulge out of the curved head
    const y = parts.eyeY - 0.2;
    const bowl = (r: number) => new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const mouth = new THREE.Mesh(bowl(0.17), new THREE.MeshBasicMaterial({ color: '#e5435a' }));
    mouth.scale.set(1, 0.95, 0.5);
    mouth.position.set(0, y, parts.z);
    const tongue = new THREE.Mesh(bowl(0.1), new THREE.MeshBasicMaterial({ color: '#ff8f9c' }));
    tongue.scale.set(1.1, 0.7, 0.5);
    tongue.position.set(0, y - 0.07, parts.z + 0.045);
    const lip = new THREE.Mesh(capsule(0.016, 0.3), new THREE.MeshBasicMaterial({ color: '#b83246' }));
    lip.rotation.z = Math.PI / 2;
    lip.position.set(0, y, parts.z + 0.05);
    head.add(mouth, tongue, lip);
  } else {
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.018, 6, 14, Math.PI), black);
    mouth.position.set(0, parts.eyeY - 0.17, parts.z);
    mouth.rotation.z = Math.PI;
    head.add(mouth);
  }
}

// ---------------------------------------------------------------------------

/** Reference 1: yellow→mint hoodie, teal bangs, googly eyes, rain boots. */
function buildHoodie(kit: Kit, root: THREE.Group): Rig {
  const skin = '#f6c1b4';
  const hoodY = ['#ffe8a8', '#ffe2a0'];
  const body = new THREE.Group();
  root.add(body);

  const torso = kit.mesh(sphere(0.55), ['#5fcfcb', '#c8ecd0', '#ffe6a4']);
  torso.scale.set(1.0, 0.82, 0.86);
  torso.position.y = 1.0;
  body.add(torso);
  // drawstrings
  for (const sx of [-1, 1]) {
    const cord = kit.mesh(capsule(0.018, 0.16), '#4fc6c2');
    cord.position.set(sx * 0.09, 1.3, 0.45);
    cord.rotation.z = sx * 0.25;
    const tip = kit.mesh(sphere(0.04, 10, 8), '#4fc6c2');
    tip.position.set(sx * 0.11, 1.2, 0.46);
    body.add(cord, tip);
  }

  const head = new THREE.Group();
  head.position.y = 1.86;
  body.add(head);
  const hood = kit.mesh(sphere(0.66, 32, 24), hoodY);
  hood.scale.set(1, 1, 0.92);
  const rim = kit.mesh(new THREE.TorusGeometry(0.47, 0.13, 14, 36), '#ffe1a0');
  rim.position.z = 0.42;
  const faceDisc = kit.mesh(sphere(0.48, 28, 20), skin);
  faceDisc.scale.set(1, 1, 0.42);
  faceDisc.position.z = 0.4;
  head.add(hood, rim, faceDisc);
  // teal bangs: two rounded halves meeting at a centre part
  for (const sx of [-1, 1]) {
    const bang = kit.mesh(sphere(0.3, 20, 14), '#7fd7d2');
    bang.scale.set(0.95, 0.62, 0.42);
    bang.position.set(sx * 0.19, 0.27, 0.5);
    bang.rotation.z = sx * -0.35;
    head.add(bang);
  }
  face(kit, head, { eyes: 'googly', eyeX: 0.15, eyeY: -0.02, z: 0.6, mouth: 'smile', cheeks: true });

  const arms: THREE.Group[] = [];
  const legs: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    // puffy sleeve with a little pink hand poking out
    const hand = kit.mesh(sphere(0.09, 12, 8), skin);
    const arm = limb(kit, 0.26, 0.16, ['#7fd8cf', '#ffe6a4'], hand);
    arm.position.set(sx * 0.5, 1.22, 0);
    body.add(arm);
    arms.push(arm);

    const boot = new THREE.Group();
    const shaft = kit.mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.2, 16), ['#8fe0d0', '#ffe6a4']);
    shaft.position.y = 0.08;
    const toe = kit.mesh(sphere(0.15, 16, 12), '#7fdcd0');
    toe.scale.set(1, 0.62, 1.5);
    toe.position.set(0, -0.04, 0.07);
    boot.add(shaft, toe);
    const leg = limb(kit, 0.36, 0.055, skin, boot);
    leg.position.set(sx * 0.17, 0.72, 0);
    root.add(leg);
    legs.push(leg);
  }
  root.scale.setScalar(0.85);
  return { body, head, arms: arms as Rig['arms'], legs: legs as Rig['legs'], hipY: 0.72, armRest: 0.35 };
}

/** Reference 2: gradient bulb head with sprout leaves, happy eyes, big lips, purple belly. */
function buildSprout(kit: Kit, root: THREE.Group): Rig {
  const mint = '#79dccb';
  const body = new THREE.Group();
  root.add(body);

  const torso = kit.mesh(sphere(0.5), ['#c27be0', '#e6b2df', '#f7dccb']);
  torso.scale.set(1, 1.05, 0.92);
  torso.position.y = 0.98;
  body.add(torso);
  for (const sx of [-1, 1]) {
    const pad = kit.mesh(sphere(0.15, 14, 10), '#f1bde8');
    pad.scale.set(0.7, 1, 1);
    pad.position.set(sx * 0.44, 1.2, 0);
    body.add(pad);
  }

  const head = new THREE.Group();
  head.position.y = 1.98;
  body.add(head);
  const bulb = kit.mesh(sphere(0.62, 32, 24), ['#5fcfc4', '#cfe8b4', '#fbecbc']);
  bulb.scale.set(1, 1.05, 0.98);
  head.add(bulb);
  for (const [y, c] of [
    [0.64, '#dca6ef'],
    [0.74, '#f3c4f0'],
  ] as const) {
    const ring = kit.mesh(new THREE.TorusGeometry(0.17, 0.06, 10, 24), c);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    head.add(ring);
  }
  for (const [rz, ry] of [
    [0.95, 0],
    [-0.95, 0],
    [0.15, 0.4],
  ]) {
    const leaf = kit.mesh(capsule(0.085, 0.28), ['#a8d98a', '#f3eeb0']);
    leaf.position.set(Math.sin(-rz) * 0.17, 0.98, 0);
    leaf.rotation.set(0, ry, rz);
    head.add(leaf);
  }
  face(kit, head, { eyes: 'happy', eyeX: 0.21, eyeY: 0.12, z: 0.58, mouth: 'lips', nose: true });

  const arms: THREE.Group[] = [];
  const legs: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const arm = limb(kit, 0.42, 0.11, mint);
    arm.position.set(sx * 0.46, 1.18, 0);
    body.add(arm);
    arms.push(arm);

    const boot = new THREE.Group();
    const cuff = kit.mesh(new THREE.TorusGeometry(0.075, 0.035, 8, 16), '#fbe39a');
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = 0.1;
    const toe = kit.mesh(sphere(0.15, 16, 12), '#e7a6f2');
    toe.scale.set(1, 0.65, 1.5);
    toe.position.set(0, -0.03, 0.07);
    boot.add(cuff, toe);
    const leg = limb(kit, 0.32, 0.065, mint, boot);
    leg.position.set(sx * 0.16, 0.66, 0);
    root.add(leg);
    legs.push(leg);
  }
  root.scale.setScalar(0.82);
  return { body, head, arms: arms as Rig['arms'], legs: legs as Rig['legs'], hipY: 0.66, armRest: 0.55 };
}

/** Reference 3: peach→yellow bulb head with leaves in a teal ring, ✕ eyes, laughing mouth, teal body. */
function buildDizzy(kit: Kit, root: THREE.Group): Rig {
  const pink = '#f4b8b2';
  const teal = '#3fb5b0';
  const body = new THREE.Group();
  root.add(body);

  const torso = kit.mesh(sphere(0.46), teal);
  torso.scale.set(1, 1.02, 0.92);
  torso.position.y = 0.98;
  const shorts = kit.mesh(sphere(0.43), '#5ec7bf');
  shorts.scale.set(1.04, 0.5, 0.95);
  shorts.position.y = 0.7;
  body.add(torso, shorts);
  for (const sx of [-1, 1]) {
    const cap = kit.mesh(sphere(0.13, 14, 10), teal);
    cap.position.set(sx * 0.42, 1.17, 0);
    body.add(cap);
  }

  const head = new THREE.Group();
  head.position.y = 1.98;
  body.add(head);
  const bulb = kit.mesh(sphere(0.64, 32, 24), ['#f19f68', '#f7c07c', '#fbd98f']);
  head.add(bulb);
  for (const [y, c] of [
    [0.63, '#4cbdb6'],
    [0.72, '#3fb0aa'],
  ] as const) {
    const ring = kit.mesh(new THREE.TorusGeometry(0.17, 0.06, 10, 24), c);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    head.add(ring);
  }
  for (const [rz, ry] of [
    [1.0, 0],
    [-1.0, 0],
    [0.35, 0.6],
    [-0.25, -0.6],
  ]) {
    const leaf = kit.mesh(capsule(0.085, 0.3), ['#f0cd86', '#fbe9b8']);
    leaf.position.set(Math.sin(-rz) * 0.18, 0.98, 0);
    leaf.rotation.set(0, ry, rz);
    head.add(leaf);
  }
  face(kit, head, { eyes: 'x', eyeX: 0.2, eyeY: 0.12, z: 0.6, mouth: 'open' });

  const arms: THREE.Group[] = [];
  const legs: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const arm = limb(kit, 0.42, 0.09, pink);
    arm.position.set(sx * 0.47, 1.16, 0);
    body.add(arm);
    arms.push(arm);

    const boot = new THREE.Group();
    const cuff = kit.mesh(new THREE.TorusGeometry(0.085, 0.04, 8, 16), '#f6c46a');
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = 0.1;
    const toe = kit.mesh(sphere(0.15, 16, 12), '#ee8b68');
    toe.scale.set(1, 0.65, 1.5);
    toe.position.set(0, -0.03, 0.07);
    boot.add(cuff, toe);
    const leg = limb(kit, 0.32, 0.075, pink, boot);
    leg.position.set(sx * 0.17, 0.64, 0);
    root.add(leg);
    legs.push(leg);
  }
  root.scale.setScalar(0.82);
  return { body, head, arms: arms as Rig['arms'], legs: legs as Rig['legs'], hipY: 0.64, armRest: 0.5 };
}

/** Reference 4: the head *is* the body — an open flower pot (mint→lilac→pink) with leaves and a pink bloom. */
function buildBloom(kit: Kit, root: THREE.Group): Rig {
  const pink = '#f3b9df';
  const body = new THREE.Group();
  root.add(body);
  const head = new THREE.Group();
  head.position.y = 1.28;
  body.add(head);

  // pot: a sphere with its top cap removed, rendered double-sided so the inside shows
  const opening = 0.52;
  const pot = kit.mesh(new THREE.SphereGeometry(0.74, 36, 26, 0, Math.PI * 2, opening, Math.PI - opening), [
    '#e58fdc',
    '#cdb3e6',
    '#9fd9d6',
    '#7fdcc8',
  ]);
  (pot.material as THREE.Material).side = THREE.DoubleSide;
  pot.scale.set(1, 0.97, 0.95);
  head.add(pot);
  const rimY = 0.74 * Math.cos(opening) * 0.97;
  const rimR = 0.74 * Math.sin(opening);
  const rim = kit.mesh(new THREE.TorusGeometry(rimR, 0.045, 10, 36), '#86e0cc');
  rim.rotation.x = Math.PI / 2;
  rim.position.y = rimY;
  const soil = kit.mesh(new THREE.CircleGeometry(rimR, 28), '#4aa892');
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = rimY - 0.05;
  head.add(rim, soil);
  // a crown of mint leaves leaning outward
  for (let i = 0; i < 7; i++) {
    const pivot = new THREE.Group();
    pivot.position.y = rimY - 0.04;
    pivot.rotation.y = (i / 7) * Math.PI * 2;
    const leaf = kit.mesh(capsule(0.07, 0.2), ['#4fc7a6', '#86e3c6']);
    leaf.scale.set(1.5, 1, 0.55);
    leaf.position.set(0.13, 0.16, 0);
    leaf.rotation.z = -0.45;
    pivot.add(leaf);
    head.add(pivot);
  }
  // curved stem with a pink flower
  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, rimY - 0.05, 0),
    new THREE.Vector3(0.02, rimY + 0.35, 0),
    new THREE.Vector3(0.1, rimY + 0.62, 0.02),
    new THREE.Vector3(0.26, rimY + 0.8, 0.05),
  ]);
  head.add(kit.mesh(new THREE.TubeGeometry(stemCurve, 24, 0.025, 8, false), '#4fbf9c'));
  const flower = new THREE.Group();
  flower.position.set(0.3, rimY + 0.86, 0.07);
  flower.rotation.set(-0.25, -0.35, 0.35);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const petal = kit.mesh(sphere(0.1, 14, 10), '#e78ae8');
    petal.scale.set(1.15, 1.15, 0.55);
    petal.position.set(Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0);
    flower.add(petal);
  }
  const center = kit.mesh(sphere(0.08, 14, 10), '#f6d44a');
  center.scale.set(1, 1, 0.7);
  center.position.z = 0.04;
  flower.add(center);
  head.add(flower);
  face(kit, head, { eyes: 'beads', eyeX: 0.17, eyeY: 0.05, z: 0.66, mouth: 'lips', lipColor: '#f6d23f' });

  const arms: THREE.Group[] = [];
  const legs: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const arm = limb(kit, 0.62, 0.075, pink, kit.mesh(sphere(0.085, 12, 8), pink));
    arm.position.set(sx * 0.72, 1.45, 0);
    body.add(arm);
    arms.push(arm);

    const boot = new THREE.Group();
    const cuff = kit.mesh(new THREE.TorusGeometry(0.08, 0.03, 8, 16), '#86e0cc');
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = 0.09;
    const toe = kit.mesh(sphere(0.15, 16, 12), ['#e58fdc', '#9fdcd6']);
    toe.scale.set(1, 0.65, 1.5);
    toe.position.set(0, -0.03, 0.07);
    boot.add(cuff, toe);
    const leg = limb(kit, 0.34, 0.07, pink, boot);
    leg.position.set(sx * 0.18, 0.6, 0);
    root.add(leg);
    legs.push(leg);
  }
  root.scale.setScalar(0.82);
  return { body, head, arms: arms as Rig['arms'], legs: legs as Rig['legs'], hipY: 0.6, armRest: 0.06 };
}

/** Reference 5: teal head in a rolled pale-yellow beanie, googly eyes, yellow→coral bell body. */
function buildBeanie(kit: Kit, root: THREE.Group): Rig {
  const teal = '#3db4b8';
  const body = new THREE.Group();
  root.add(body);

  // bell-shaped body from a lathe profile (radius, height)
  const profile = [
    [0.001, 0],
    [0.46, 0],
    [0.5, 0.05],
    [0.49, 0.2],
    [0.44, 0.4],
    [0.34, 0.6],
    [0.2, 0.74],
    [0.001, 0.8],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const bell = kit.mesh(new THREE.LatheGeometry(profile, 40), ['#f19478', '#f6b07f', '#fbd88e']);
  bell.position.y = 0.5;
  body.add(bell);

  const head = new THREE.Group();
  head.position.y = 1.72;
  body.add(head);
  head.add(kit.mesh(sphere(0.56, 32, 24), teal));
  const dome = kit.mesh(new THREE.SphereGeometry(0.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), '#f8dfa2');
  dome.scale.set(1.06, 0.95, 1.06);
  dome.position.y = 0.22;
  const brim = kit.mesh(new THREE.TorusGeometry(0.52, 0.11, 14, 40), '#fae5b0');
  brim.rotation.x = Math.PI / 2;
  brim.position.y = 0.24;
  head.add(dome, brim);
  face(kit, head, { eyes: 'googly', eyeX: 0.16, eyeY: -0.04, z: 0.52, mouth: 'smile', cheeks: true });

  const arms: THREE.Group[] = [];
  const legs: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const arm = limb(kit, 0.3, 0.065, teal, kit.mesh(sphere(0.08, 12, 8), teal));
    const sleeve = kit.mesh(capsule(0.11, 0.08), '#f7b48a');
    sleeve.position.y = -0.06;
    arm.add(sleeve);
    arm.position.set(sx * 0.4, 1.1, 0);
    body.add(arm);
    arms.push(arm);

    const boot = new THREE.Group();
    const cuff = kit.mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.08, 16), '#f8d98e');
    cuff.position.y = 0.09;
    const toe = kit.mesh(sphere(0.15, 16, 12), '#f39f74');
    toe.scale.set(1, 0.65, 1.5);
    toe.position.set(0, -0.03, 0.07);
    boot.add(cuff, toe);
    const leg = limb(kit, 0.36, 0.06, teal, boot);
    leg.position.set(sx * 0.16, 0.6, 0);
    root.add(leg);
    legs.push(leg);
  }
  root.scale.setScalar(0.85);
  return { body, head, arms: arms as Rig['arms'], legs: legs as Rig['legs'], hipY: 0.6, armRest: 0.3 };
}

const BUILDERS: Record<CharacterId, (kit: Kit, root: THREE.Group) => Rig> = {
  hoodie: buildHoodie,
  sprout: buildSprout,
  dizzy: buildDizzy,
  bloom: buildBloom,
  beanie: buildBeanie,
};

/** Cute rounded toy character; all variants share the same rig and animation. */
export function createRunner(opts: { ghost?: boolean; kind?: CharacterId } = {}): Runner {
  const ghost = !!opts.ghost;
  const group = new THREE.Group();
  const inner = new THREE.Group(); // per-character scale lives here
  group.add(inner);
  const rig = BUILDERS[opts.kind ?? 'hoodie'](makeKit(ghost), inner);
  const { body, head, arms, legs, hipY, armRest } = rig;

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = !ghost;
  });

  let phase = 0;
  let lean = 0;

  const pose = (swing: number, bob: number) => {
    legs[0].rotation.x = swing;
    legs[1].rotation.x = -swing;
    arms[0].rotation.set(-swing * 1.1, 0, -armRest);
    arms[1].rotation.set(swing * 1.1, 0, armRest);
    body.position.y = bob;
    legs[0].position.y = legs[1].position.y = hipY + bob * 0.5;
  };

  return {
    group,
    update(dt, speed, steer, turbo) {
      // stride frequency grows with speed but saturates — toy legs can only go so fast
      phase += dt * (4 + Math.min(speed, 45) * 0.32);
      const swing = Math.sin(phase) * Math.min(1.1, 0.3 + speed * 0.03);
      pose(swing, Math.abs(Math.cos(phase)) * 0.12);
      lean += (-steer * 0.25 - lean) * Math.min(1, dt * 8);
      body.rotation.z = lean;
      body.rotation.x = turbo ? 0.35 : 0.12 + speed * 0.003;
      head.rotation.set(-body.rotation.x * 0.5, 0, 0);
    },
    idle(time) {
      pose(Math.sin(time * 2) * 0.08, Math.abs(Math.sin(time * 2.4)) * 0.05);
      body.rotation.set(0, 0, 0);
      head.rotation.set(0, Math.sin(time * 0.8) * 0.25, 0);
    },
    celebrate(time) {
      const j = Math.abs(Math.sin(time * 6));
      body.position.y = j * 0.5;
      legs[0].position.y = legs[1].position.y = hipY + j * 0.5;
      arms[0].rotation.set(Math.PI, 0, -0.5 - j * 0.3);
      arms[1].rotation.set(Math.PI, 0, 0.5 + j * 0.3);
      body.rotation.set(0, 0, 0);
    },
  };
}

/** Renders a small portrait of each character (the real 3D model) to a data URL. */
export function renderThumbnails(size = 192): Record<CharacterId, string> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#c9b9a8', 2.2));
  const sun = new THREE.DirectionalLight('#fff1d6', 1.8);
  sun.position.set(2, 4, 5);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  cam.position.set(0.5, 1.6, 5.5);
  cam.lookAt(0, 1.28, 0);

  const out = {} as Record<CharacterId, string>;
  for (const { id } of CHARACTERS) {
    const r = createRunner({ kind: id });
    r.idle(0.3);
    r.group.rotation.y = -0.25;
    scene.add(r.group);
    renderer.render(scene, cam);
    out[id] = renderer.domElement.toDataURL('image/png');
    scene.remove(r.group);
    r.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
