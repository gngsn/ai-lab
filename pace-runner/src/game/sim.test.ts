import { describe, expect, it } from 'vitest';
import { parseGpx } from '../route/gpx';
import overlapGpx from './fixtures/overlap.gpx?raw';
import { sampleAt } from '../route/course';
import { SAMPLE_RUNS } from '../route/samples';
import { MAX_V, SPEED_CAP } from './constants';
import { createSim, prepareCourse, stepSim, useItem, type SimState } from './sim';

const course = prepareCourse(SAMPLE_RUNS[0]);
const DT = 1 / 60;

/** Autopilot: steer against drift to stay centred, optionally aim at the next turbo pad. */
function autopilot(s: SimState, chasePads: boolean): number {
  let aim = 0;
  if (chasePads) {
    const pad = course.turboPads.find((p, i) => !s.usedPads.has(i) && p.s > s.dist && p.s - s.dist < 60);
    if (pad) aim = pad.lateral;
  }
  return Math.max(-1, Math.min(1, (aim - s.lateral) * 1.5));
}

function play(steerFn: (s: SimState) => number, maxT = 400): SimState {
  const s = createSim();
  while (s.phase === 'running' && s.t < maxT) stepSim(s, course, steerFn(s), DT);
  return s;
}

describe('sim', () => {
  it('without turbo, speed stays under MAX_V and settles to the segment cap', () => {
    const noPads = { ...course, turboPads: [] };
    const s = createSim();
    for (let i = 0; i < 60 * 30; i++) {
      stepSim(s, noPads, autopilot(s, false), DT);
      expect(s.v).toBeLessThanOrEqual(MAX_V + 1e-6);
    }
    // hold position on a long red stretch → speed converges to the red cap
    const red = course.samples.findIndex((p, i) => p.bucket === 3 && course.samples[i + 40]?.bucket === 3);
    const t = createSim();
    t.dist = (red / (course.samples.length - 1)) * course.length;
    t.v = MAX_V;
    for (let i = 0; i < 60; i++) stepSim(t, noPads, 0, DT);
    expect(sampleAt(course, t.dist).bucket).toBe(3);
    expect(t.v).toBeLessThan(MAX_V * SPEED_CAP[3] + 2);
  });

  it('a clean centred run beats the ghost and is never game over', () => {
    const noPads = { ...course, turboPads: [] };
    const s = createSim();
    let maxGap = -Infinity;
    while (s.phase === 'running') {
      stepSim(s, noPads, autopilot(s, false), DT);
      maxGap = Math.max(maxGap, s.ghostDist - s.dist);
    }
    // ghost and runner both start from rest, so they overlap for the first few frames
    expect(maxGap).toBeLessThan(2);
    expect(s.phase).toBe('finished');
    expect(s.finishTime).toBeLessThan(course.ghostDuration);
  });

  it('turbo pads make the run faster', () => {
    const clean = play((st) => autopilot(st, false));
    const turbo = play((st) => autopilot(st, true));
    expect(turbo.turbos).toBeGreaterThan(3);
    expect(turbo.finishTime).toBeLessThan(clean.finishTime);
  });

  it('steering through coin rows collects them; ignoring them does not', () => {
    const chase = play((st) => {
      const coin = course.coins.find((c, i) => !st.collected.has(i) && c.s > st.dist - 0.5 && c.s - st.dist < 12);
      return Math.max(-1, Math.min(1, ((coin ? coin.lateral : 0) - st.lateral) * 2));
    });
    expect(chase.phase).toBe('finished');
    expect(chase.coins).toBe(chase.collected.size);
    expect(chase.coins / course.coins.length).toBeGreaterThan(0.6);

    // hugging the left edge on the grass should pick up few or none
    const edge = createSim();
    edge.lateral = -6.5;
    for (let i = 0; i < 60 * 10 && edge.phase === 'running'; i++) stepSim(edge, course, -1, DT);
    expect(edge.coins).toBe(0);
  });

  it('an energy gel goes into the inventory and, when used, lifts speed above the pace cap', () => {
    const ten = prepareCourse(SAMPLE_RUNS.find((r) => r.id === 'yeouido-10k')!);
    const course = { ...ten, turboPads: [], items: [] };
    const gel = ten.gels[0];
    const s = createSim();
    s.dist = gel.s - 20;
    s.lateral = gel.lateral;
    s.v = MAX_V * SPEED_CAP[3];
    for (let i = 0; i < 60 * 1.5; i++) stepSim(s, course, -s.lateral, DT);
    expect(s.inventory).toEqual(['gel']);
    expect(s.v).toBeLessThanOrEqual(MAX_V + 1e-6); // carrying it does nothing yet
    expect(useItem(s)).toBe('gel');
    expect(s.inventory).toEqual([]);
    for (let i = 0; i < 60 * 3; i++) stepSim(s, course, -s.lateral, DT);
    expect(s.v).toBeGreaterThan(MAX_V);
    // wears off
    for (let i = 0; i < 60 * 8; i++) stepSim(s, course, -s.lateral, DT);
    expect(s.v).toBeLessThanOrEqual(MAX_V + 1e-6);
  });

  it('banana: no grass slowdown and less drift while it lasts', () => {
    const course = { ...prepareCourse(SAMPLE_RUNS[1]), turboPads: [], items: [], gels: [] };
    const run = (banana: boolean) => {
      const s = createSim();
      s.v = MAX_V;
      s.lateral = 6.5; // on the grass
      if (banana) {
        s.inventory = ['banana'];
        useItem(s);
      }
      for (let i = 0; i < 60 * 2; i++) stepSim(s, course, 1, DT);
      return s;
    };
    const plain = run(false);
    const grip = run(true);
    expect(grip.offRoad).toBe(true);
    expect(grip.v).toBeGreaterThan(plain.v + 8);
  });

  it('shine muscat: a short sprint faster than any pace cap', () => {
    const course = { ...prepareCourse(SAMPLE_RUNS[1]), turboPads: [], items: [], gels: [] };
    const s = createSim();
    s.v = MAX_V * 0.8;
    s.inventory = ['muscat'];
    useItem(s);
    let peak = 0;
    for (let i = 0; i < 60 * 1.4; i++) {
      stepSim(s, course, -s.lateral, DT);
      peak = Math.max(peak, s.v);
    }
    expect(peak).toBeGreaterThan(MAX_V * 1.3);
    for (let i = 0; i < 60 * 3; i++) stepSim(s, course, -s.lateral, DT);
    // eases back down to the normal cap
    expect(s.v).toBeLessThan(MAX_V + 0.5);
  });

  it('carries at most 3 items; a full inventory leaves pickups on the road', () => {
    const c = prepareCourse(SAMPLE_RUNS[0]);
    expect(c.items.length).toBeGreaterThan(4);
    expect(new Set(c.items.map((i) => i.kind))).toEqual(new Set(['banana', 'muscat']));
    for (const item of c.items) {
      expect(Math.abs(item.lateral)).toBeLessThan(4.5);
      expect(c.turboPads.some((p) => Math.abs(p.s - item.s) < 6)).toBe(false);
    }
    const s = createSim();
    s.inventory = ['gel', 'banana', 'muscat'];
    const item = c.items[0];
    s.dist = item.s - 5;
    s.lateral = item.lateral;
    s.v = 20;
    const events: string[] = [];
    for (let i = 0; i < 30; i++) events.push(...stepSim(s, { ...c, turboPads: [], gels: [] }, 0, DT));
    expect(events).toContain('full');
    expect(s.inventory).toHaveLength(3);
    expect(s.itemsTaken.size).toBe(0);
    // using an item frees a slot; the oldest goes first
    expect(useItem(s)).toBe('gel');
    expect(useItem(s, 1)).toBe('muscat');
    expect(s.inventory).toEqual(['banana']);
  });

  it('ghost timing is complete and increasing on every course', () => {
    for (const run of SAMPLE_RUNS) {
      const c = prepareCourse(run);
      const gt = c.ghostTime;
      for (let i = 1; i < gt.length; i++) expect(gt[i]).toBeGreaterThan(gt[i - 1]);
      expect(c.ghostDuration).toBeGreaterThan(30);
      expect(c.ghostDuration).toBe(gt[gt.length - 1]);
    }
  });

  it('an overlapping route (out-and-back, hairpin, figure-8) is playable to the finish', () => {
    // fixture: out along a street, 180° turnaround, back on the same street, then crossing loops
    const c = prepareCourse(parseGpx(overlapGpx));
    expect(c.ghostDuration).toBeGreaterThan(30);
    expect(c.ghostDuration).toBe(c.ghostTime[c.ghostTime.length - 1]);
    const s = createSim();
    while (s.phase === 'running' && s.t < 400) {
      const k = sampleAt(c, s.dist).k;
      const drift = Math.max(-8, Math.min(8, -k * s.v * s.v * 0.2));
      stepSim(s, { ...c, turboPads: [] }, Math.max(-1, Math.min(1, (-drift - s.lateral * 3) / 9)), DT);
    }
    expect(s.phase).toBe('finished');
  });

  it('running in the grass gets you caught by the ghost', () => {
    const s = play(() => 1);
    expect(s.offRoadTime).toBeGreaterThan(5);
    expect(s.phase).toBe('gameover');
  });
});
