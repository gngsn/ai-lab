import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { signDevJwt } from './dev-jwt';

const SECRET = 'super-secret-dev-jwt-token-with-at-least-32-chars';

describe('signDevJwt', () => {
  it('produces a valid HS256 token PostgREST would accept', async () => {
    const token = await signDevJwt(
      { sub: '00000000-0000-0000-0000-000000000001', role: 'authenticated', exp: 9999999999 },
      SECRET,
    );
    const [header, payload, signature] = token.split('.');

    // Header advertises HS256.
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'HS256',
      typ: 'JWT',
    });

    // Claims that drive RLS survive the round-trip.
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(claims.sub).toBe('00000000-0000-0000-0000-000000000001');
    expect(claims.role).toBe('authenticated');

    // Signature matches an independent HMAC over header.payload.
    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url');
    expect(signature).toBe(expected);
  });
});
