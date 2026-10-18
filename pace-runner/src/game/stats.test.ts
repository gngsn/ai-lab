import { describe, expect, it } from 'vitest';
import { buildCourse } from '../route/course';
import { SAMPLE_RUNS } from '../route/samples';
import { computeStats, medalFor } from './stats';

describe('stats', () => {
  const courses = SAMPLE_RUNS.map(buildCourse);

  it('summarises the whole running history', () => {
    const s = computeStats(courses, () => null, () => 0);
    expect(s.runs).toBe(4);
    expect(s.totalKm).toBeCloseTo(courses.reduce((a, c) => a + c.realDistanceM / 1000, 0), 6);
    expect(s.totalSec).toBeCloseTo(courses.reduce((a, c) => a + c.realDurationSec, 0), 6);
    expect(s.avgPace).toBeCloseTo(s.totalSec / s.totalKm, 6);
    expect(s.longest?.name).toBe('Yeouido Long Run 10K');
    const fastest = courses.reduce((a, c) => (c.avgPace < a.avgPace ? c : a));
    expect(s.fastest?.name).toBe(fastest.run.name);
    expect(s.paceShare.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    for (const share of s.paceShare) expect(share).toBeGreaterThan(0);
    expect(s.bests.every((b) => b.bestTime === null && b.medal === null && b.bestCoins === 0)).toBe(true);
  });

  it('reports per-course bests with medals against past you', () => {
    const c = courses[0];
    const s = computeStats(
      [c],
      () => c.ghostDuration * 0.9,
      () => 42,
    );
    expect(s.bests[0]).toMatchObject({ bestTime: c.ghostDuration * 0.9, bestCoins: 42, totalCoins: c.coins.length, medal: 'gold' });
    expect(medalFor(98, 100)).toBe('silver');
    expect(medalFor(100, 100)).toBe('silver');
    expect(medalFor(101, 100)).toBe('bronze');
    expect(medalFor(null, 100)).toBe(null);
  });

  it('handles an empty history', () => {
    const s = computeStats([], () => null, () => 0);
    expect(s).toMatchObject({ runs: 0, totalKm: 0, avgPace: 0, longest: null, fastest: null });
  });
});
