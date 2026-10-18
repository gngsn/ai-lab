import type { GpsPoint, Run } from './types';

/** Deterministic PRNG so sample routes are identical on every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SynthOptions {
  id: string;
  name: string;
  date: string;
  seed: number;
  center: [number, number];
  /** Path in local meters, sampled by parameter u ∈ [0, 1]. */
  shape: (u: number) => [number, number];
  /** Pace (sec/km) at distance d meters along the path. */
  pace: (d: number, total: number) => number;
  /** Distance ranges (meters) where the watch recorded no timestamps. */
  timeGaps?: [number, number][];
}

/** Builds a fake-but-plausible GPS recording: ~8 m spacing, GPS jitter, timestamps from pace. */
function synthesize(o: SynthOptions): Run {
  const rnd = mulberry32(o.seed);
  const dense: [number, number][] = [];
  for (let i = 0; i <= 4000; i++) dense.push(o.shape(i / 4000));
  const cum = [0];
  for (let i = 1; i < dense.length; i++)
    cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = cum[cum.length - 1];

  const [lat0, lon0] = o.center;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const points: GpsPoint[] = [];
  let t = Date.parse(`${o.date}T07:00:00+09:00`) / 1000;
  let j = 0;
  let prevD = 0;
  for (let d = 0; d <= total; d += 8) {
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const f = (d - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
    const x = dense[j][0] + (dense[j + 1][0] - dense[j][0]) * f + (rnd() - 0.5) * 3;
    const y = dense[j][1] + (dense[j + 1][1] - dense[j][1]) * f + (rnd() - 0.5) * 3;
    t += ((d - prevD) / 1000) * o.pace(d, total) * (0.97 + rnd() * 0.06);
    prevD = d;
    const inGap = o.timeGaps?.some(([a, b]) => d >= a && d <= b);
    const p: GpsPoint = { lat: lat0 + y / mPerDegLat, lon: lon0 + x / mPerDegLon };
    if (!inGap) p.t = Math.round(t);
    points.push(p);
  }
  return { id: o.id, name: o.name, date: o.date, points };
}

const TAU = Math.PI * 2;

export const SAMPLE_RUNS: Run[] = [
  synthesize({
    id: 'yeouido-10k',
    name: 'Yeouido Long Run 10K',
    date: '2026-10-12',
    seed: 53,
    center: [37.5271, 126.9326],
    shape: (u) => {
      const a = u * TAU * 0.93;
      const r = 1 + 0.08 * Math.sin(a * 4 + 1.1) + 0.04 * Math.sin(a * 9);
      return [Math.cos(a) * 2050 * r, Math.sin(a) * 950 * r];
    },
    // steady start, mid-race dip, tired last 2 km, kick at the end
    pace: (d, total) => {
      const u = d / total;
      return 325 + 15 * Math.sin(u * TAU * 3) + (u > 0.45 && u < 0.55 ? 45 : 0) + (u > 0.75 ? 40 * (u - 0.75) * 4 : 0) - (u > 0.96 ? 70 : 0);
    },
  }),
  synthesize({
    id: 'riverside-5k',
    name: 'Han River Side 5K',
    date: '2026-10-11',
    seed: 11,
    center: [37.5112, 126.9965],
    shape: (u) => {
      const a = u * TAU * 0.92;
      const r = 1 + 0.12 * Math.sin(a * 3 + 0.4) + 0.05 * Math.sin(a * 7);
      return [Math.cos(a) * 1060 * r, Math.sin(a) * 450 * r];
    },
    pace: (d, total) => {
      const u = d / total;
      return 310 - 25 * Math.sin(u * TAU * 2) + (u > 0.85 ? -35 : 0) + (u > 0.42 && u < 0.5 ? 70 : 0);
    },
  }),
  synthesize({
    id: 'namsan-hills-4k',
    name: 'Namsan Hills 4K',
    date: '2026-10-08',
    seed: 23,
    center: [37.5512, 126.9882],
    shape: (u) => {
      const a = u * TAU * 0.85;
      const r = 530 + 110 * Math.sin(a * 5);
      const zig = 75 * Math.sin(u * TAU * 9);
      return [Math.cos(a) * r + zig, Math.sin(a) * r * 0.8];
    },
    pace: (d, total) => {
      const u = d / total;
      const hill = Math.max(0, Math.sin(u * TAU * 3 - 0.6));
      return 345 + 140 * hill * hill - 20 * Math.cos(u * TAU * 7);
    },
  }),
  synthesize({
    id: 'olympic-intervals-3k',
    name: 'Olympic Park Intervals 3K',
    date: '2026-10-03',
    seed: 37,
    center: [37.5206, 127.1214],
    shape: (u) => {
      const a = u * TAU * 0.9;
      return [
        Math.cos(a) * 540 + 100 * Math.sin(a * 4),
        Math.sin(a) * 420 + 70 * Math.cos(a * 3),
      ];
    },
    // 400 m fast / 200 m easy
    pace: (d) => (d % 600 < 400 ? 255 : 400),
    // Watch lost time sync for a stretch — filled with the average pace.
    timeGaps: [[1900, 2350]],
  }),
];
