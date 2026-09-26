import test from 'node:test';
import assert from 'node:assert/strict';
import { medalFields, distanceLabel, durationSeconds } from '../lib/validation';
const valid = {
  raceName: 'My first marathon',
  date: '2025-03-16',
  distance: 42.195,
  duration: '03:42:17',
  location: 'Seoul',
  note: '',
  visibility: 'private',
  color: '#eeeeee',
};
test('validates real race details and trims text', () => {
  const result = medalFields.parse({ ...valid, raceName: '  First finish  ', distance: '21.0975' });
  assert.equal(result.raceName, 'First finish');
  assert.equal(result.distance, 21.0975);
});
test('rejects impossible and future dates', () => {
  for (const date of ['2025-02-30', '2025-13-01', '2099-01-01', 'tomorrow'])
    assert.equal(medalFields.safeParse({ ...valid, date }).success, false);
});
test('rejects invalid durations, distances, and required fields', () => {
  for (const data of [
    { duration: '03:75:15' },
    { duration: 'abc' },
    { distance: 0 },
    { distance: -1 },
    { distance: 1001 },
    { raceName: ' ' },
    { color: 'url(unsafe)' },
  ])
    assert.equal(medalFields.safeParse({ ...valid, ...data }).success, false);
});
test('optional finish time remains optional', () => {
  assert.equal(medalFields.safeParse({ ...valid, duration: '' }).success, true);
  assert.equal(durationSeconds(''), Infinity);
  assert.equal(durationSeconds('03:42:17'), 13337);
});
test('distance labels preserve standard race types', () => {
  assert.equal(distanceLabel(42.195), 'Marathon');
  assert.equal(distanceLabel(21.0975), 'Half marathon');
  assert.equal(distanceLabel(10), '10K');
  assert.equal(distanceLabel(50), '50K');
});
