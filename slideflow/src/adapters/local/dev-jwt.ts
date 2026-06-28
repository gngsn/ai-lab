/** HS256 JWT signing for the local dev-auth adapter (PLAN §4.3 "signed development JWTs").
 *  DEV ONLY: the secret is shared with the local PostgREST stack. Never used on cloud. */

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeSegment(value: object): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

export interface DevClaims {
  sub: string;
  role: 'authenticated';
  email?: string;
  exp: number;
}

/** Sign a dev JWT whose claims (`sub`, `role`) drive PostgREST RLS exactly like Supabase. */
export async function signDevJwt(claims: DevClaims, secret: string): Promise<string> {
  const header = encodeSegment({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeSegment(claims);
  const data = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${base64url(new Uint8Array(signature))}`;
}
