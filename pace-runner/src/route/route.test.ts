import { describe, expect, it } from 'vitest';
import overlapGpx from '../game/fixtures/overlap.gpx?raw';
import { buildCourse, ghostDistanceAt, MIN_TURN_RADIUS, minTurnRadius, sampleAt, worldAt } from './course';
import { ROAD_HALF } from '../game/constants';
import { cumulativeDistance, haversine, projectLocal, simplifyRdp } from './geo';
import { parseGpx } from './gpx';
import { averagePace, bucketOf, fillPaces, pointPaces } from './pace';
import { SAMPLE_RUNS } from './samples';

describe('geo', () => {
  it('haversine ≈ 111 km per degree of latitude', () => {
    expect(haversine({ lat: 37, lon: 127 }, { lat: 38, lon: 127 })).toBeCloseTo(111195, -2);
  });

  it('projectLocal keeps distances and puts north on +y', () => {
    const pts = [
      { lat: 37.5, lon: 127 },
      { lat: 37.501, lon: 127.001 },
    ];
    const [a, b] = projectLocal(pts);
    expect(a).toEqual({ x: 0, y: 0 });
    expect(b.y).toBeGreaterThan(0);
    expect(b.x).toBeGreaterThan(0);
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(haversine(pts[0], pts[1]), 0);
  });

  it('RDP drops collinear points and keeps corners', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 0.1 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(simplifyRdp(pts, 1)).toEqual([0, 2, 3]);
  });
});

describe('pace', () => {
  it('ignores windows whose timestamps go backwards', () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({ lat: 37 + (i * 10) / 111195, lon: 127, t: i < 15 ? i * 3 : i * 3 - 100 }));
    const paces = pointPaces(pts, cumulativeDistance(pts));
    expect(paces[2]).toBeCloseTo(300, -1);
    expect(paces[15]).toBeNull();
  });

  it('splits [min, max] into four equal buckets, fastest = green', () => {
    expect(bucketOf(240, 240, 400)).toBe(0);
    expect(bucketOf(279, 240, 400)).toBe(0);
    expect(bucketOf(281, 240, 400)).toBe(1);
    expect(bucketOf(321, 240, 400)).toBe(2);
    expect(bucketOf(400, 240, 400)).toBe(3);
  });

  it('computes pace from timestamps and fills gaps with the average', () => {
    // 10 m per point, 3 s per point → 300 s/km
    const pts = Array.from({ length: 50 }, (_, i) => ({
      lat: 37 + (i * 10) / 111195,
      lon: 127,
      t: i >= 20 && i < 30 ? undefined : i * 3,
    }));
    const cum = cumulativeDistance(pts);
    const paces = pointPaces(pts, cum);
    expect(paces[5]).toBeCloseTo(300, -1);
    expect(paces[25]).toBeNull();
    const avg = averagePace(pts, cum);
    expect(avg).toBeCloseTo(300, -1);
    expect(fillPaces(paces, avg)[25]).toBe(avg);
  });
});

describe('gpx', () => {
  it('parses track points, time and name', () => {
    const run = parseGpx(`<?xml version="1.0"?><gpx><trk><name>Morning Run</name><trkseg>
      <trkpt lat="37.5" lon="127.0"><ele>10</ele><time>2026-10-01T00:00:00Z</time></trkpt>
      <trkpt lat="37.501" lon="127.0"><time>2026-10-01T00:00:30Z</time></trkpt>
      <trkpt lat="37.502" lon="127.0"/>
    </trkseg></trk></gpx>`);
    expect(run.name).toBe('Morning Run');
    expect(run.points).toHaveLength(3);
    expect(run.points[1].t! - run.points[0].t!).toBe(30);
    expect(run.points[2].t).toBeUndefined();
    expect(run.date).toBe('2026-10-01');
  });

  it('rejects files without a track', () => {
    expect(() => parseGpx('<gpx></gpx>')).toThrow();
  });
});

describe('course', () => {
  for (const run of SAMPLE_RUNS) {
    it(`${run.name}: builds a playable course`, () => {
      const c = buildCourse(run);
      expect(c.realDistanceM).toBeGreaterThan(2500);
      expect(c.length).toBeGreaterThanOrEqual(1400);
      // all four pace colours should appear in a varied run
      const buckets = new Set(c.samples.map((s) => s.bucket));
      expect(buckets.size).toBe(4);
      // ghost time is monotonic and ends at ghostDuration
      for (let i = 1; i < c.ghostTime.length; i++) expect(c.ghostTime[i]).toBeGreaterThanOrEqual(c.ghostTime[i - 1]);
      expect(c.ghostTime[c.ghostTime.length - 1]).toBeCloseTo(c.ghostDuration, 3);
      expect(c.ghostDuration).toBeGreaterThan(50);
      expect(c.ghostDuration).toBeLessThan(150);
      expect(c.turboPads.length).toBeGreaterThan(5);
      // coins: plenty, on the road, sorted along the course, never on a pad
      expect(c.coins.length).toBeGreaterThan(40);
      for (let i = 0; i < c.coins.length; i++) {
        const coin = c.coins[i];
        expect(Math.abs(coin.lateral)).toBeLessThan(4.5);
        expect(coin.s).toBeGreaterThan(0);
        expect(coin.s).toBeLessThan(c.length);
        if (i) expect(coin.s).toBeGreaterThan(c.coins[i - 1].s);
        expect(c.turboPads.some((p) => Math.abs(p.s - coin.s) < 4 && Math.abs(p.lateral - coin.lateral) < 2.4)).toBe(false);
      }
      // tangents are unit length
      for (const s of c.samples) expect(Math.hypot(s.tx, s.tz)).toBeCloseTo(1, 3);
    });
  }

  it('places an energy gel at every 5 km of the real run, not at the finish', () => {
    const byId = (id: string) => buildCourse(SAMPLE_RUNS.find((r) => r.id === id)!);
    const ten = byId('yeouido-10k');
    expect(ten.realDistanceM).toBeGreaterThan(9500);
    expect(ten.gels.map((g) => g.km)).toEqual([5]);
    expect(ten.gels[0].s / ten.length).toBeCloseTo(5000 / ten.realDistanceM, 5);
    // no coin crowds the pouch
    expect(ten.coins.some((c) => Math.abs(c.s - ten.gels[0].s) < 15)).toBe(false);
    // a 5.0 km run ends right at the 5 km mark → no gel on the finish line
    expect(byId('riverside-5k').gels).toEqual([]);
    expect(byId('olympic-intervals-3k').gels).toEqual([]);
  });

  it('separates an out-and-back route into side-by-side lanes but keeps crossings', () => {
    const c = buildCourse(parseGpx(overlapGpx));
    const S = c.samples;
    const ds = c.length / (S.length - 1);
    // compare stretches at least ~120 units apart along the course (a U-turn's tip is allowed to pinch)
    const recent = Math.ceil(120 / ds);
    const minGap = ROAD_HALF * 2 * 0.9;
    // longest continuous run of samples lying on top of an earlier, parallel stretch of road
    let run = 0;
    let longest = 0;
    let crossings = 0;
    for (let i = 0; i < S.length; i++) {
      let overlapped = false;
      for (let j = 0; j < i - recent; j++) {
        const d = Math.hypot(S[i].x - S[j].x, S[i].z - S[j].z);
        const dot = Math.abs(S[i].tx * S[j].tx + S[i].tz * S[j].tz);
        if (dot > 0.85 && d < minGap) overlapped = true;
        if (dot < 0.3 && d < 3) crossings++;
      }
      run = overlapped ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    // the 900 m return leg used to sit on the outgoing street for ~340 samples; now only
    // a brief shallow crossing remains (where the route crosses over to the loops)
    expect(longest * ds).toBeLessThan(60);
    // the figure-8 still crosses itself
    expect(crossings).toBeGreaterThan(0);
    // tangents stay unit length, and the path never folds back on itself between neighbouring
    // samples (a GPS U-turn that reversed within one sample used to do exactly that).
    // Note: the very tip of an extreme cusp may still pinch below MIN_TURN_RADIUS.
    for (let i = 0; i < S.length; i++) {
      expect(Math.hypot(S[i].tx, S[i].tz)).toBeCloseTo(1, 3);
      if (i) expect(S[i].tx * S[i - 1].tx + S[i].tz * S[i - 1].tz).toBeGreaterThan(0);
    }
  });

  it('real sample routes have no turn tighter than the road can bend', () => {
    for (const run of SAMPLE_RUNS) expect(minTurnRadius(buildCourse(run).samples)).toBeGreaterThan(MIN_TURN_RADIUS);
  });

  it('ghostDistanceAt inverts ghostTime', () => {
    const c = buildCourse(SAMPLE_RUNS[0]);
    expect(ghostDistanceAt(c, 0)).toBe(0);
    expect(ghostDistanceAt(c, c.ghostDuration + 1)).toBe(c.length);
    const mid = ghostDistanceAt(c, c.ghostDuration / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(c.length);
  });

  it('worldAt offsets to the right of travel', () => {
    const c = buildCourse(SAMPLE_RUNS[0]);
    const p = sampleAt(c, 500);
    const r = worldAt(c, 500, 2);
    // (r - p) · forward ≈ 0 and its cross with forward is positive (right side)
    const dx = r.x - p.x;
    const dz = r.z - p.z;
    expect(dx * p.tx + dz * p.tz).toBeCloseTo(0, 5);
    expect(Math.hypot(dx, dz)).toBeCloseTo(2, 5);
    expect(p.tx * dz - p.tz * dx).toBeGreaterThan(0);
  });
});
