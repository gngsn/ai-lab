import { buildCourse, ghostDistanceAt, sampleAt, type Course } from '../route/course';
import type { PaceBucket, Run } from '../route/types';
import {
  ACCEL,
  BANANA_TIME,
  GRIP_DRIFT,
  ITEM_RADIUS,
  ITEM_SLOTS,
  MUSCAT_TIME,
  SPRINT_V,
  COIN_RADIUS,
  ENERGY_OFFROAD_FACTOR,
  ENERGY_TIME,
  ENERGY_V,
  GEL_RADIUS,
  DRIFT_K,
  DRIFT_MAX,
  GAP_LIMIT,
  GHOST_SLACK,
  LATERAL_LIMIT,
  MAX_V,
  OFFROAD_FACTOR,
  ROAD_HALF,
  RUNNER_HALF,
  SPEED_CAP,
  STEER_SPEED,
  TURBO_PAD_HALF_WIDTH,
  TURBO_TIME,
  TURBO_V,
} from './constants';

export type Phase = 'running' | 'finished' | 'gameover';

export interface SimState {
  phase: Phase;
  /** seconds since GO */
  t: number;
  dist: number;
  lateral: number;
  v: number;
  turboUntil: number;
  offRoad: boolean;
  bucket: PaceBucket;
  ghostDist: number;
  usedPads: Set<number>;
  finishTime: number;
  /** total seconds spent off road — shown on the result screen */
  offRoadTime: number;
  turbos: number;
  collected: Set<number>;
  coins: number;
  energyUntil: number;
  gelsTaken: Set<number>;
  /** carried items, oldest first (max ITEM_SLOTS) */
  inventory: ItemKind[];
  itemsTaken: Set<number>;
  gripUntil: number;
  sprintUntil: number;
  itemsUsed: number;
  /** kind of the item picked up / used in the last step (for HUD and FX) */
  lastItem: ItemKind | null;
}

export type ItemKind = 'gel' | 'banana' | 'muscat';

export type SimEvent = 'turbo' | 'coin' | 'pickup' | 'full' | 'offroad' | 'finish' | 'gameover';

export function createSim(): SimState {
  return {
    phase: 'running',
    t: 0,
    dist: 0,
    lateral: 0,
    v: 0,
    turboUntil: -1,
    offRoad: false,
    bucket: 0,
    ghostDist: 0,
    usedPads: new Set(),
    finishTime: 0,
    offRoadTime: 0,
    turbos: 0,
    collected: new Set(),
    coins: 0,
    energyUntil: -1,
    gelsTaken: new Set(),
    inventory: [],
    itemsTaken: new Set(),
    gripUntil: -1,
    sprintUntil: -1,
    itemsUsed: 0,
    lastItem: null,
  };
}

export function isTurbo(s: SimState): boolean {
  return s.t < s.turboUntil;
}

export function isEnergized(s: SimState): boolean {
  return s.t < s.energyUntil;
}

export function hasGrip(s: SimState): boolean {
  return s.t < s.gripUntil;
}

export function isSprinting(s: SimState): boolean {
  return s.t < s.sprintUntil;
}

/** Use the item in `slot` (default: the oldest). Returns what was used, or null. */
export function useItem(s: SimState, slot = 0): ItemKind | null {
  if (s.phase !== 'running' || slot < 0 || slot >= s.inventory.length) return null;
  const [kind] = s.inventory.splice(slot, 1);
  if (kind === 'gel') s.energyUntil = s.t + ENERGY_TIME;
  else if (kind === 'banana') s.gripUntil = s.t + BANANA_TIME;
  else s.sprintUntil = s.t + MUSCAT_TIME;
  s.itemsUsed++;
  s.lastItem = kind;
  return kind;
}

/** steer ∈ [-1, 1]; positive = right. Mutates and returns emitted events. */
export function stepSim(s: SimState, course: Course, steer: number, dt: number): SimEvent[] {
  const events: SimEvent[] = [];
  if (s.phase !== 'running') return events;
  s.t += dt;

  const here = sampleAt(course, s.dist);
  s.bucket = here.bucket;

  // Speed: pace bucket caps the top speed; turbo overrides; grass slows you down.
  const turbo = isTurbo(s);
  const sprint = isSprinting(s);
  const energy = isEnergized(s);
  const grip = hasGrip(s);
  let target = turbo ? TURBO_V : sprint ? SPRINT_V : energy ? ENERGY_V : MAX_V * SPEED_CAP[here.bucket];
  if (s.offRoad && !turbo && !grip) target *= energy ? ENERGY_OFFROAD_FACTOR : OFFROAD_FACTOR;
  if (s.v < target) s.v = Math.min(target, s.v + ACCEL * (turbo ? 2 : sprint ? 3 : 1) * dt);
  else s.v += (target - s.v) * Math.min(1, 2.5 * dt);

  // Lateral: player steering vs. centrifugal drift on curves (right turn pushes left).
  const drift = Math.max(-DRIFT_MAX, Math.min(DRIFT_MAX, -here.k * s.v * s.v * DRIFT_K)) * (grip ? GRIP_DRIFT : 1);
  s.lateral += (steer * STEER_SPEED + drift) * dt;
  s.lateral = Math.max(-LATERAL_LIMIT, Math.min(LATERAL_LIMIT, s.lateral));

  const wasOff = s.offRoad;
  s.offRoad = Math.abs(s.lateral) > ROAD_HALF - RUNNER_HALF + 0.5;
  if (s.offRoad) {
    s.offRoadTime += dt;
    if (!wasOff) events.push('offroad');
  }

  const prev = s.dist;
  s.dist += s.v * dt;

  // Turbo pads trigger when crossed with enough lateral overlap.
  course.turboPads.forEach((pad, i) => {
    if (s.usedPads.has(i) || pad.s < prev || pad.s > s.dist + 1) return;
    if (Math.abs(s.lateral - pad.lateral) < TURBO_PAD_HALF_WIDTH + RUNNER_HALF) {
      s.usedPads.add(i);
      s.turboUntil = s.t + TURBO_TIME;
      s.turbos++;
      events.push('turbo');
    }
  });

  course.coins.forEach((coin, i) => {
    if (s.collected.has(i) || coin.s < prev - 0.5 || coin.s > s.dist + 0.5) return;
    if (Math.abs(s.lateral - coin.lateral) < COIN_RADIUS + RUNNER_HALF) {
      s.collected.add(i);
      s.coins++;
      events.push('coin');
    }
  });

  // Gels and fruit go into the inventory; a full inventory leaves them on the road.
  const pickUp = (kind: ItemKind, taken: Set<number>, i: number) => {
    if (s.inventory.length >= ITEM_SLOTS) {
      events.push('full');
      return;
    }
    taken.add(i);
    s.inventory.push(kind);
    s.lastItem = kind;
    events.push('pickup');
  };
  course.gels.forEach((gel, i) => {
    if (s.gelsTaken.has(i) || gel.s < prev - 0.5 || gel.s > s.dist + 0.5) return;
    if (Math.abs(s.lateral - gel.lateral) < GEL_RADIUS + RUNNER_HALF) pickUp('gel', s.gelsTaken, i);
  });
  course.items.forEach((item, i) => {
    if (s.itemsTaken.has(i) || item.s < prev - 0.5 || item.s > s.dist + 0.5) return;
    if (Math.abs(s.lateral - item.lateral) < ITEM_RADIUS + RUNNER_HALF) pickUp(item.kind, s.itemsTaken, i);
  });

  s.ghostDist = ghostDistanceAt(course, s.t);

  if (s.dist >= course.length) {
    // Interpolate the exact crossing moment within this frame.
    const over = (s.dist - course.length) / Math.max(1e-6, s.v);
    s.finishTime = s.t - over;
    s.dist = course.length;
    s.phase = 'finished';
    events.push('finish');
  } else if (s.ghostDist - s.dist > GAP_LIMIT) {
    s.phase = 'gameover';
    events.push('gameover');
  }
  return events;
}

/**
 * Builds the course and records the ghost ("past me") from a simulated perfect run —
 * centred, no turbo, obeying the real-pace speed caps — slowed by GHOST_SLACK.
 * A clean line beats it; time lost in the grass has to be won back with turbo.
 */
export function prepareCourse(run: Run): Course {
  const course = buildCourse(run);
  const n = course.samples.length;
  const ds = course.length / (n - 1);
  const noPads: Course = { ...course, turboPads: [], gels: [], items: [], ghostTime: new Float32Array(n).fill(Infinity) };
  const cross = new Float32Array(n);
  const s = createSim();
  const dt = 1 / 120;
  let next = 1;
  while (s.phase === 'running' && s.t < 1000) {
    // perfect steering: cancel drift exactly, then re-centre
    const k = sampleAt(course, s.dist).k;
    const drift = Math.max(-DRIFT_MAX, Math.min(DRIFT_MAX, -k * s.v * s.v * DRIFT_K));
    const steer = Math.max(-1, Math.min(1, (-drift - s.lateral * 3) / STEER_SPEED));
    const prevDist = s.dist;
    const prevT = s.t;
    stepSim(s, noPads, steer, dt);
    while (next < n && next * ds <= s.dist) {
      const f = (next * ds - prevDist) / Math.max(1e-9, s.dist - prevDist);
      cross[next++] = prevT + f * (s.t - prevT);
    }
  }
  // the last sample sits at (n-1)·ds, which rounding can push past the clamped finish distance
  for (let i = next; i < n; i++) cross[i] = s.finishTime;
  course.ghostTime = cross.map((t) => t * GHOST_SLACK);
  course.ghostDuration = course.ghostTime[n - 1];
  return course;
}
