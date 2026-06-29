import { describe, it, expect, vi, afterEach } from 'vitest';
import { RestClient } from './rest-client';

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

describe('RestClient', () => {
  it('does not JSON-parse an empty (return=minimal) body', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 201 })) as typeof fetch;
    const rest = new RestClient({ baseUrl: 'http://x' });
    await expect(rest.post('/decks', { a: 1 }, 'return=minimal')).resolves.toBeUndefined();
  });

  it('parses a JSON collection on GET', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify([{ id: 1 }]), { status: 200 }),
    ) as typeof fetch;
    const rest = new RestClient({ baseUrl: 'http://x' });
    await expect(rest.get('/decks')).resolves.toEqual([{ id: 1 }]);
  });

  it('throws with detail on a non-ok response', async () => {
    globalThis.fetch = vi.fn(async () => new Response('denied', { status: 401 })) as typeof fetch;
    const rest = new RestClient({ baseUrl: 'http://x' });
    await expect(rest.get('/decks')).rejects.toThrow(/401 denied/);
  });
});
