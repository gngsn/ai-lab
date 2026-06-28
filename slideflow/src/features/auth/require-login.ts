import type { Ports } from '@ports/ports';
import type { AuthSession } from '@ports/auth-port';

/**
 * Owner-page guard (SPEC §4.6). Resolves with the session, or redirects to
 * login.html?next=<current path> (the adapter performs the redirect and never resolves).
 */
export function requireLogin(ports: Ports): Promise<AuthSession> {
  return ports.auth.requireLogin({ redirectTo: location.href });
}
