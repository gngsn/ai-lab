/** One GPS fix. `t` is unix seconds; missing when the device didn't record time. */
export interface GpsPoint {
  lat: number;
  lon: number;
  t?: number;
}

export interface Run {
  id: string;
  name: string;
  /** ISO date of the real run */
  date: string;
  points: GpsPoint[];
  /** Fallback average pace (sec/km) when timestamps are missing entirely. */
  avgPaceSec?: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

/** 0 = green (fastest) … 3 = red (slowest) */
export type PaceBucket = 0 | 1 | 2 | 3;
