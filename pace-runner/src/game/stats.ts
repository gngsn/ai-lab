import type { Course } from '../route/course';

export type Medal = 'gold' | 'silver' | 'bronze' | null;

export interface CourseBest {
  runId: string;
  name: string;
  km: number;
  bestTime: number | null;
  bestCoins: number;
  totalCoins: number;
  medal: Medal;
}

export interface PlayerStats {
  runs: number;
  totalKm: number;
  totalSec: number;
  /** distance-weighted average pace, sec/km */
  avgPace: number;
  longest: { name: string; km: number } | null;
  /** run with the fastest average pace */
  fastest: { name: string; pace: number } | null;
  /** share of total distance in each pace bucket (fast, steady, slow, very slow), sums to 1 */
  paceShare: [number, number, number, number];
  bests: CourseBest[];
}

/** Gold: beat past you by ≥5 %, silver: beat past you, bronze: finished. */
export function medalFor(bestTime: number | null, ghostDuration: number): Medal {
  if (bestTime === null) return null;
  if (bestTime <= ghostDuration * 0.95) return 'gold';
  if (bestTime <= ghostDuration) return 'silver';
  return 'bronze';
}

export function computeStats(
  courses: Course[],
  best: (runId: string) => number | null,
  bestCoins: (runId: string) => number,
): PlayerStats {
  let totalKm = 0;
  let totalSec = 0;
  let longest: PlayerStats['longest'] = null;
  let fastest: PlayerStats['fastest'] = null;
  const bucketKm = [0, 0, 0, 0];
  const bests: CourseBest[] = [];

  for (const c of courses) {
    const km = c.realDistanceM / 1000;
    totalKm += km;
    totalSec += c.realDurationSec;
    if (!longest || km > longest.km) longest = { name: c.run.name, km };
    if (!fastest || c.avgPace < fastest.pace) fastest = { name: c.run.name, pace: c.avgPace };
    // samples are evenly spaced along the real route, so a sample count is a share of distance
    const perSample = km / c.samples.length;
    for (const s of c.samples) bucketKm[s.bucket] += perSample;
    const t = best(c.run.id);
    bests.push({
      runId: c.run.id,
      name: c.run.name,
      km,
      bestTime: t,
      bestCoins: t === null ? 0 : bestCoins(c.run.id),
      totalCoins: c.coins.length,
      medal: medalFor(t, c.ghostDuration),
    });
  }
  const sum = bucketKm.reduce((a, b) => a + b, 0) || 1;
  return {
    runs: courses.length,
    totalKm,
    totalSec,
    avgPace: totalKm ? totalSec / totalKm : 0,
    longest,
    fastest,
    paceShare: bucketKm.map((k) => k / sum) as PlayerStats['paceShare'],
    bests,
  };
}
