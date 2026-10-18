import { CatmullRomCurve3, Vector3 } from 'three';
import { COIN_SPACING, GEL_EVERY_M, GEL_FINISH_MARGIN_M, MAX_V, ROAD_HALF, SPEED_CAP, TURBO_PAD_HALF_WIDTH } from '../game/constants';
import { cumulativeDistance, projectLocal, simplifyRdp } from './geo';
import { averagePace, bucketOf, fillPaces, paceRange, pointPaces } from './pace';
import { mulberry32 } from './samples';
import type { PaceBucket, Run } from './types';

export interface CourseSample {
  x: number;
  z: number;
  /** unit tangent */
  tx: number;
  tz: number;
  /** signed curvature (1/units); positive = right turn */
  k: number;
  pace: number;
  bucket: PaceBucket;
}

export interface TurboPad {
  /** distance along the course */
  s: number;
  lateral: number;
}

/** A collectible coin, positioned like a turbo pad. */
export type Coin = TurboPad;

export type FruitKind = 'banana' | 'muscat';

/** Banana / shine-muscat pickup lying on the road. */
export interface FruitItem {
  s: number;
  lateral: number;
  kind: FruitKind;
}

/** Energy gel pickup; `km` is the real-run distance it marks. */
export interface Gel {
  s: number;
  lateral: number;
  km: number;
}

export interface Course {
  run: Run;
  /** game units */
  length: number;
  /** evenly spaced by arc length; spacing = length / (samples.length - 1) */
  samples: CourseSample[];
  realDistanceM: number;
  realDurationSec: number;
  avgPace: number;
  paceMin: number;
  paceMax: number;
  /** ghost's game-time (seconds) when reaching each sample, normalized to ghostDuration */
  ghostTime: Float32Array;
  ghostDuration: number;
  turboPads: TurboPad[];
  coins: Coin[];
  gels: Gel[];
  items: FruitItem[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const N = 1200;

/** 3 km → 1600 units, 5 km → 2400, capped at 3200. Keeps a game around 1–2 minutes. */
export function gameLengthFor(km: number): number {
  return Math.max(1400, Math.min(3200, km * 400 + 400));
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function buildCourse(run: Run): Course {
  const cum = cumulativeDistance(run.points);
  const realDistanceM = cum[cum.length - 1];
  if (realDistanceM < 200) throw new Error('Route is too short (needs at least 200 m).');

  // Pace per GPS point; gaps are filled with the user's average pace.
  const avgPace = averagePace(run.points, cum, run.avgPaceSec);
  const paces = fillPaces(pointPaces(run.points, cum), avgPace);
  const { min: paceMin, max: paceMax } = paceRange(paces);

  // Shape: project → simplify → centripetal Catmull-Rom → even arc-length samples.
  const local = projectLocal(run.points);
  const kept = simplifyRdp(local, 3);
  const curve = new CatmullRomCurve3(
    kept.map((i) => new Vector3(local[i].x, 0, -local[i].y)), // north = -z
    false,
    'centripetal',
  );
  const pts = curve.getSpacedPoints(N - 1);
  const rawLen = curve.getLength();
  const length = gameLengthFor(realDistanceM / 1000);
  const scale = length / rawLen;
  const ds = length / (N - 1);

  const samples: CourseSample[] = [];
  let pj = 0;
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(N - 1, i + 1)];
    const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    // Map back to real distance by fraction of the route.
    const realD = (i / (N - 1)) * realDistanceM;
    while (pj < cum.length - 2 && cum[pj + 1] < realD) pj++;
    const f = (realD - cum[pj]) / Math.max(1e-6, cum[pj + 1] - cum[pj]);
    const pace = paces[pj] + (paces[pj + 1] - paces[pj]) * Math.min(1, Math.max(0, f));
    samples.push({
      x: p.x * scale,
      z: p.z * scale,
      tx: (b.x - a.x) / tl,
      tz: (b.z - a.z) / tl,
      k: 0,
      pace,
      bucket: bucketOf(pace, paceMin, paceMax),
    });
  }

  // Majority filter (±8 samples ≈ ±15 units) so pace hovering on a bucket boundary
  // doesn't paint thin flickering stripes.
  const rawBuckets = samples.map((s) => s.bucket);
  for (let i = 0; i < N; i++) {
    const votes = [0, 0, 0, 0];
    for (let j = Math.max(0, i - 8); j <= Math.min(N - 1, i + 8); j++) votes[rawBuckets[j]]++;
    samples[i].bucket = votes.indexOf(Math.max(...votes)) as PaceBucket;
  }

  // Out-and-back stretches and U-turns put two passes of the run on (almost) the same street.
  // Push the later pass sideways so the two roads sit side by side like a two-lane road.
  separateParallelPasses(samples, ds);
  // GPS U-turns can reverse direction within a sample or two; round them so the road
  // (and its inner edge) never folds over itself.
  roundTightTurns(samples, ds);

  // Signed curvature from tangent turn rate, smoothed so tiny GPS wiggles don't jerk the runner.
  const rawK = samples.map((s, i) => {
    const n = samples[Math.min(N - 1, i + 1)];
    const cross = s.tx * n.tz - s.tz * n.tx;
    return cross / ds;
  });
  const W = 5;
  for (let i = 0; i < N; i++) {
    let sum = 0;
    let c = 0;
    for (let j = Math.max(0, i - W); j <= Math.min(N - 1, i + W); j++) {
      sum += rawK[j];
      c++;
    }
    samples[i].k = sum / c;
  }

  // Ghost placeholder: real pacing profile scaled to an analytic time.
  // prepareCourse() replaces it with a simulated run.
  let idealTime = 0;
  let paceTime = 0;
  const paceCum = new Float32Array(N);
  for (let i = 1; i < N; i++) {
    idealTime += ds / (MAX_V * SPEED_CAP[samples[i].bucket]);
    paceTime += samples[i].pace;
    paceCum[i] = paceTime;
  }
  const ghostDuration = idealTime;
  const ghostTime = new Float32Array(N);
  for (let i = 0; i < N; i++) ghostTime[i] = (paceCum[i] / paceTime) * ghostDuration;

  // Turbo pads: mostly on fast (green/yellow) stretches, deterministic per run.
  const rnd = mulberry32(hashString(run.id));
  const turboPads: TurboPad[] = [];
  const margin = ROAD_HALF - TURBO_PAD_HALF_WIDTH - 0.3;
  for (let s = 120; s < length - 120; s += 70 + rnd() * 60) {
    const b = samples[Math.round(s / ds)].bucket;
    if (b >= 2 && rnd() < 0.75) continue;
    turboPads.push({ s, lateral: (rnd() * 2 - 1) * margin });
    s += 90;
  }

  // Coins: short rows (straight, diagonal, arc) that reward steering. Own RNG stream
  // so adding coins never moves the turbo pads.
  const crnd = mulberry32(hashString(run.id) ^ 0x9e3779b9);
  const coins: Coin[] = [];
  const cm = ROAD_HALF - 1.1;
  for (let s = 60; s < length - 50; ) {
    const count = 5 + Math.floor(crnd() * 4);
    const kind = crnd();
    const a = (crnd() * 2 - 1) * cm;
    const side = crnd() < 0.5 ? -1 : 1;
    for (let k = 0; k < count; k++) {
      const u = k / (count - 1);
      const lateral =
        kind < 0.4 ? a : kind < 0.75 ? side * cm * (1 - 2 * u) : side * cm * (Math.sin(u * Math.PI) * 1.6 - 0.8);
      const cs = s + k * COIN_SPACING;
      // keep pads readable: no coin sitting on top of one
      if (turboPads.some((p) => Math.abs(p.s - cs) < 4 && Math.abs(p.lateral - lateral) < 2.4)) continue;
      coins.push({ s: cs, lateral: Math.max(-cm, Math.min(cm, lateral)) });
    }
    s += count * COIN_SPACING + 35 + crnd() * 55;
  }

  // Energy gels at every GEL_EVERY_M of the real run (like a race aid station).
  const gels: Gel[] = [];
  for (let m = GEL_EVERY_M; m < realDistanceM - GEL_FINISH_MARGIN_M; m += GEL_EVERY_M) {
    const s = (m / realDistanceM) * length;
    gels.push({ s, lateral: 0, km: m / 1000 });
  }
  // clear coins right around a gel so the pouch stands alone
  for (let i = coins.length - 1; i >= 0; i--) {
    if (gels.some((g) => Math.abs(g.s - coins[i].s) < 15)) coins.splice(i, 1);
  }

  // Fruit items: one every 260–420 units, own RNG stream so pads/coins/gels never move.
  const irnd = mulberry32(hashString(run.id) ^ 0x51ed27);
  const items: FruitItem[] = [];
  const im = ROAD_HALF - 1.2;
  for (let s = 200; s < length - 150; s += 260 + irnd() * 160) {
    if (turboPads.some((p) => Math.abs(p.s - s) < 6) || gels.some((g) => Math.abs(g.s - s) < 20)) continue;
    const item: FruitItem = { s, lateral: (irnd() * 2 - 1) * im, kind: irnd() < 0.5 ? 'banana' : 'muscat' };
    items.push(item);
    for (let i = coins.length - 1; i >= 0; i--) {
      if (Math.abs(coins[i].s - s) < 6 && Math.abs(coins[i].lateral - item.lateral) < 1.6) coins.splice(i, 1);
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of samples) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z);
    maxZ = Math.max(maxZ, s.z);
  }

  return {
    run,
    length,
    samples,
    realDistanceM,
    // averagePace extrapolates over untimed edges, so this covers the whole route.
    realDurationSec: (avgPace * realDistanceM) / 1000,
    avgPace,
    paceMin,
    paceMax,
    ghostTime,
    ghostDuration,
    turboPads,
    coins,
    gels,
    items,
    bounds: { minX, maxX, minZ, maxZ },
  };
}

/** Centre-to-centre distance between two side-by-side passes: two road widths plus a strip of grass. */
export const LANE_SEPARATION = ROAD_HALF * 2 + 1.5;

/**
 * Where a later stretch of the course runs along an earlier one (parallel or antiparallel,
 * within a road width), shift the later stretch sideways so the roads don't overlap.
 * Perpendicular crossings are left alone. Offsets are smoothed so lanes merge and split
 * gradually, then tangents are recomputed. Mutates `samples`.
 */
export function separateParallelPasses(samples: CourseSample[], ds: number): void {
  const N = samples.length;
  const CELL = LANE_SEPARATION;
  // ignore the last ~25 units: those are just the road you're on bending (U-turn apex)
  const RECENT = Math.ceil(25 / ds);
  const grid = new Map<string, number[]>();
  const px = samples.map((p) => p.x);
  const pz = samples.map((p) => p.z);
  const add = (i: number) => {
    const k = `${Math.floor(px[i] / CELL)},${Math.floor(pz[i] / CELL)}`;
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  };

  // Pass 1: for each sample, the closest earlier parallel/antiparallel sample and which side of it we're on.
  const bestJ = new Int32Array(N).fill(-1);
  const side = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t = samples[i];
    let bestD = LANE_SEPARATION;
    const cx = Math.floor(px[i] / CELL);
    const cz = Math.floor(pz[i] / CELL);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const j of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (j > i - RECENT) continue;
          const d = Math.hypot(px[i] - px[j], pz[i] - pz[j]);
          // only parallel / antiparallel stretches, not crossings
          if (d < bestD && Math.abs(t.tx * samples[j].tx + t.tz * samples[j].tz) > 0.6) {
            bestD = d;
            bestJ[i] = j;
          }
        }
    if (bestJ[i] >= 0) {
      const o = samples[bestJ[i]];
      side[i] = (px[i] - px[bestJ[i]]) * -o.tz + (pz[i] - pz[bestJ[i]]) * o.tx;
    }
    add(i);
  }

  // Pass 2: group into overlapping stretches (small gaps bridged). Each stretch moves to the
  // side it *exits* toward, so the route never has to cross back over the earlier road.
  const ox = new Float64Array(N);
  const oz = new Float64Array(N);
  for (let i = 0; i < N; ) {
    if (bestJ[i] < 0) {
      i++;
      continue;
    }
    let end = i;
    let gap = 0;
    for (let k = i + 1; k < N && gap <= 4; k++) {
      if (bestJ[k] >= 0) {
        end = k;
        gap = 0;
      } else gap++;
    }
    let exit = 0;
    const tail = Math.max(i, end - Math.max(3, Math.floor((end - i) / 4)));
    for (let k = tail; k <= end; k++) if (bestJ[k] >= 0) exit += side[k];
    const sign = exit < 0 ? -1 : 1;
    for (let k = i; k <= end; k++) {
      if (bestJ[k] < 0) continue;
      const o = samples[bestJ[k]];
      // only ever push apart; a pass that is already far enough stays where it is
      const push = sign * side[k] < LANE_SEPARATION ? sign * LANE_SEPARATION - side[k] : 0;
      ox[k] = -o.tz * push;
      oz[k] = o.tx * push;
    }
    i = end + 1;
  }

  // Widen each offset over ±W samples (keep the largest), then average over ±W: lanes ease
  // in and out *outside* the overlapping stretch instead of shrinking at its ends.
  const W = 12;
  const wx = new Float64Array(N);
  const wz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let m = 0;
    for (let j = Math.max(0, i - W); j <= Math.min(N - 1, i + W); j++) {
      const mag = ox[j] * ox[j] + oz[j] * oz[j];
      if (mag > m) {
        m = mag;
        wx[i] = ox[j];
        wz[i] = oz[j];
      }
    }
  }
  // two box-filter passes = a triangle filter: smooth ramps, no kinks
  const box = (src: Float64Array) => {
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let sum = 0;
      let c = 0;
      for (let j = Math.max(0, i - W); j <= Math.min(N - 1, i + W); j++) {
        sum += src[j];
        c++;
      }
      out[i] = sum / c;
    }
    return out;
  };
  const fx = box(box(wx));
  const fz = box(box(wz));
  for (let i = 0; i < N; i++) {
    samples[i].x = px[i] + fx[i];
    samples[i].z = pz[i] + fz[i];
  }
  for (let i = 0; i < N; i++) {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(N - 1, i + 1)];
    const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    samples[i].tx = (b.x - a.x) / tl;
    samples[i].tz = (b.z - a.z) / tl;
  }
}

/** Tightest turn the road can take without its inner edge folding over itself. */
export const MIN_TURN_RADIUS = ROAD_HALF;

/**
 * Rebuild the course line through every `step`-th sample (≈ one lane-gap apart) with a
 * centripetal Catmull-Rom curve and resample it evenly. This rounds GPS cusps — a U-turn
 * that reverses within one sample, or the 1–2 m hop at a turnaround — into curves the road
 * can follow, without looping. Pace data stays attached by sample index. Mutates `samples`.
 */
export function roundTightTurns(samples: CourseSample[], ds: number): void {
  const N = samples.length;
  if (minTurnRadius(samples) >= MIN_TURN_RADIUS) return;
  const orig = samples.map((p) => ({ x: p.x, z: p.z }));
  // retry with a coarser control polygon while any turn is still tighter than the road can bend
  for (const mult of [1, 1.5, 2, 3]) {
    const step = Math.max(2, Math.round((LANE_SEPARATION * mult) / ds));
    let poly: { x: number; z: number }[] = [];
    for (let i = 0; i < N - 1; i += step) poly.push(orig[i]);
    poly.push(orig[N - 1]);
    // Drop spikes (a control point the path runs straight past and comes back to): corner
    // cutting can't round a spike because there's no area to cut into.
    for (let changed = true; changed && poly.length > 3; ) {
      changed = false;
      for (let i = 1; i < poly.length - 1; i++) {
        const a = poly[i - 1];
        const b = poly[i];
        const c = poly[i + 1];
        const ux = b.x - a.x;
        const uz = b.z - a.z;
        const vx = c.x - b.x;
        const vz = c.z - b.z;
        const cos = (ux * vx + uz * vz) / ((Math.hypot(ux, uz) || 1) * (Math.hypot(vx, vz) || 1));
        if (cos < -0.5) {
          poly.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    // Chaikin corner cutting (keeps the end points): converges to a quadratic B-spline,
    // which — unlike an interpolating spline — rounds every corner instead of passing through it.
    for (let it = 0; it < 4; it++) {
      const next = [poly[0]];
      for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i];
        const b = poly[i + 1];
        next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
        next.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
      }
      next.push(poly[poly.length - 1]);
      poly = next;
    }
    resamplePolyline(poly, samples);
    if (minTurnRadius(samples) >= MIN_TURN_RADIUS) break;
  }
  for (let i = 0; i < N; i++) {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(N - 1, i + 1)];
    const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    samples[i].tx = (b.x - a.x) / tl;
    samples[i].tz = (b.z - a.z) / tl;
  }
}

/** Write `out.length` points evenly spaced by arc length along `poly` into `out` (x, z). */
function resamplePolyline(poly: { x: number; z: number }[], out: { x: number; z: number }[]): void {
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].z - poly[i - 1].z));
  const total = cum[cum.length - 1];
  let j = 0;
  for (let i = 0; i < out.length; i++) {
    const d = (i / (out.length - 1)) * total;
    while (j < poly.length - 2 && cum[j + 1] < d) j++;
    const f = (d - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    out[i].x = poly[j].x + (poly[j + 1].x - poly[j].x) * f;
    out[i].z = poly[j].z + (poly[j + 1].z - poly[j].z) * f;
  }
}

/** Smallest local turning radius along the course (chord length ÷ turning angle). */
export function minTurnRadius(samples: { x: number; z: number }[]): number {
  let min = Infinity;
  for (let i = 1; i < samples.length - 1; i++) {
    const ux = samples[i].x - samples[i - 1].x;
    const uz = samples[i].z - samples[i - 1].z;
    const vx = samples[i + 1].x - samples[i].x;
    const vz = samples[i + 1].z - samples[i].z;
    const lu = Math.hypot(ux, uz);
    const lv = Math.hypot(vx, vz);
    if (!lu || !lv) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uz * vz) / (lu * lv))));
    if (angle > 1e-6) min = Math.min(min, (lu + lv) / 2 / angle);
  }
  return min;
}

/** Interpolated sample at distance s. */
export function sampleAt(course: Course, s: number): CourseSample & { i: number } {
  const n = course.samples.length;
  const ds = course.length / (n - 1);
  const f = Math.max(0, Math.min(n - 1.0001, s / ds));
  const i = Math.floor(f);
  const t = f - i;
  const a = course.samples[i];
  const b = course.samples[i + 1];
  const tx = a.tx + (b.tx - a.tx) * t;
  const tz = a.tz + (b.tz - a.tz) * t;
  const tl = Math.hypot(tx, tz) || 1;
  return {
    i,
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    tx: tx / tl,
    tz: tz / tl,
    k: a.k + (b.k - a.k) * t,
    pace: a.pace + (b.pace - a.pace) * t,
    bucket: t < 0.5 ? a.bucket : b.bucket,
  };
}

/** World position for (distance along, lateral offset). Right of travel = +lateral. */
export function worldAt(course: Course, s: number, lateral: number): { x: number; z: number; tx: number; tz: number } {
  // beyond either end, extend straight along the end tangent
  const clamped = Math.max(0, Math.min(course.length, s));
  const p = sampleAt(course, clamped);
  const extra = s - clamped;
  // right = forward × up = (-tz, tx)
  return {
    x: p.x + p.tx * extra - p.tz * lateral,
    z: p.z + p.tz * extra + p.tx * lateral,
    tx: p.tx,
    tz: p.tz,
  };
}

/** Ghost distance at game time t (seconds since GO). */
export function ghostDistanceAt(course: Course, t: number): number {
  const gt = course.ghostTime;
  if (t <= 0) return 0;
  if (t >= gt[gt.length - 1]) return course.length;
  let lo = 0;
  let hi = gt.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (gt[mid] <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - gt[lo]) / Math.max(1e-6, gt[hi] - gt[lo]);
  const ds = course.length / (gt.length - 1);
  return (lo + f) * ds;
}
