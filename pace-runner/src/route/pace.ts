import type { GpsPoint, PaceBucket } from './types';

/** Half-window (meters) used to smooth pace around each point. */
const WINDOW_M = 40;
const MIN_PACE = 150; // 2:30 /km — anything faster is GPS noise
const MAX_PACE = 1200; // 20:00 /km — standing still

/**
 * Pace (sec/km) at each point, smoothed over ±WINDOW_M.
 * Returns null where the window lacks timestamps.
 */
export function pointPaces(points: GpsPoint[], cumDist: number[]): (number | null)[] {
  const n = points.length;
  const out: (number | null)[] = new Array(n).fill(null);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    while (lo < i && cumDist[i] - cumDist[lo + 1] >= WINDOW_M) lo++;
    if (hi < i) hi = i;
    while (hi < n - 1 && cumDist[hi] - cumDist[i] < WINDOW_M) hi++;
    const a = points[lo].t;
    const b = points[hi].t;
    const dist = cumDist[hi] - cumDist[lo];
    // non-monotonic timestamps are GPS/clock glitches — treat as missing
    if (a === undefined || b === undefined || dist < 5 || b <= a) continue;
    let gap = false;
    for (let j = lo; j <= hi; j++) {
      if (points[j].t === undefined) {
        gap = true;
        break;
      }
    }
    if (gap) continue;
    const pace = (b - a) / (dist / 1000);
    out[i] = Math.max(MIN_PACE, Math.min(MAX_PACE, pace));
  }
  return out;
}

/**
 * Average pace of the whole run. Prefers real timestamps from the first and last
 * timed points; falls back to the run's declared average, then 6:00/km.
 */
export function averagePace(points: GpsPoint[], cumDist: number[], declared?: number): number {
  let first = -1;
  let last = -1;
  points.forEach((p, i) => {
    if (p.t === undefined) return;
    if (first < 0) first = i;
    last = i;
  });
  if (first >= 0 && last > first) {
    const dist = cumDist[last] - cumDist[first];
    if (dist > 50) return ((points[last].t! - points[first].t!) / dist) * 1000;
  }
  return declared ?? 360;
}

/** Missing paces are replaced by the user's average pace. */
export function fillPaces(paces: (number | null)[], avg: number): number[] {
  return paces.map((p) => p ?? avg);
}

export function paceRange(paces: number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of paces) {
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return { min, max };
}

/** Split [min, max] into four equal ranges: green, yellow, orange, red. */
export function bucketOf(pace: number, min: number, max: number): PaceBucket {
  if (max - min < 1e-6) return 1;
  const t = (pace - min) / (max - min);
  return Math.max(0, Math.min(3, Math.floor(t * 4))) as PaceBucket;
}

export function formatPace(secPerKm: number): string {
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}"`;
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
