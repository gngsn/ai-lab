import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBackup } from '../lib/backups';
const medal = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  raceName: 'Seoul Marathon',
  date: '2025-03-16',
  distance: 42.195,
  duration: '',
  location: '',
  note: '',
  image: 'data:image/png;base64,aGVsbG8=',
  visibility: 'public',
  color: '#eeeeee',
  createdAt: '2025-03-16T12:00:00Z',
};
test('backup restore keeps embedded photos and resets visibility to private', () => {
  const restored = parseBackup(JSON.stringify({ version: 1, medals: [medal] }));
  assert.equal(restored[0].visibility, 'private');
  assert.equal(restored[0].image, medal.image);
});
test('backup restore rejects malformed data and external image URLs', () => {
  assert.throws(() => parseBackup('not JSON'));
  assert.throws(() =>
    parseBackup(
      JSON.stringify({
        version: 1,
        medals: [{ ...medal, image: 'https://example.com/image.png' }],
      }),
    ),
  );
  assert.throws(() => parseBackup(JSON.stringify({ version: 2, medals: [] })));
});
