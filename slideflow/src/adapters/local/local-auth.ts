import type { AuthPort, AuthSession } from '@ports/auth-port';
import { RestClient } from './rest-client';
import { signDevJwt } from './dev-jwt';

const SESSION_KEY = 'slideflow.localAuth.session';
const TOKEN_TTL_SECONDS = 3600;

export interface LocalAuthOptions {
  apiUrl: string;
  jwtSecret: string;
}

/**
 * Dev auth for the local Docker stack: provisions a user via the `dev_login` RPC,
 * then mints an HS256 JWT signed with the stack's shared secret. The token's claims
 * drive PostgREST RLS identically to Supabase, so page + store code is unchanged.
 */
export class LocalAuth implements AuthPort {
  private readonly rest: RestClient;
  private readonly listeners = new Set<(s: AuthSession | null) => void>();

  constructor(private readonly opts: LocalAuthOptions) {
    this.rest = new RestClient({ baseUrl: opts.apiUrl });
  }

  async getSession(): Promise<AuthSession | null> {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  }

  async getUser() {
    return (await this.getSession())?.user ?? null;
  }

  async loginWithEmailPassword(email: string): Promise<AuthSession> {
    return this.provisionAndSign(email);
  }

  async loginWithMagicLink(email: string): Promise<void> {
    await this.provisionAndSign(email); // dev shortcut: link is "clicked" immediately
  }

  async loginWithOAuth(provider: string): Promise<void> {
    await this.provisionAndSign(`${provider}-user@slideflow.local`);
  }

  async logout(): Promise<void> {
    localStorage.removeItem(SESSION_KEY);
    this.emit(null);
  }

  onAuthStateChange(callback: (s: AuthSession | null) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  async requireLogin({ redirectTo }: { redirectTo: string }): Promise<AuthSession> {
    const session = await this.getSession();
    if (session) return session;
    const target = new URL(redirectTo);
    const next = encodeURIComponent(target.pathname + target.search);
    location.assign(`login.html?next=${next}`);
    return new Promise<AuthSession>(() => {});
  }

  /** Current token for the store adapters' RestClient (owner-authorized requests). */
  currentToken(): string | null {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? ((JSON.parse(raw) as AuthSession).accessToken ?? null) : null;
  }

  private async provisionAndSign(email: string): Promise<AuthSession> {
    const userId = await this.rest.rpc<string>('dev_login', { p_email: email });
    const accessToken = await signDevJwt(
      {
        sub: userId,
        role: 'authenticated',
        email,
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
      },
      this.opts.jwtSecret,
    );
    const session: AuthSession = {
      user: { id: userId, email, displayName: email },
      accessToken,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    this.emit(session);
    return session;
  }

  private emit(session: AuthSession | null): void {
    for (const listener of this.listeners) listener(session);
  }
}
