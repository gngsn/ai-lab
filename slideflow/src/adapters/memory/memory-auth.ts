import type { AuthPort, AuthSession, AuthUser } from '@ports/auth-port';

const SESSION_KEY = 'slideflow.memoryAuth.session';

/**
 * Dev auth with no backend: any email/password "logs in" and persists a session
 * to localStorage. It honours the real session contract (guard, redirects,
 * state-change) so page code behaves identically to the Supabase/local adapters.
 */
export class MemoryAuth implements AuthPort {
  private listeners = new Set<(s: AuthSession | null) => void>();

  async getSession(): Promise<AuthSession | null> {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  }

  async getUser(): Promise<AuthUser | null> {
    return (await this.getSession())?.user ?? null;
  }

  async loginWithEmailPassword(email: string): Promise<AuthSession> {
    return this.persist(email);
  }

  async loginWithMagicLink(email: string): Promise<void> {
    // Dev shortcut: a magic link logs in immediately.
    this.persist(email);
  }

  async loginWithOAuth(provider: string): Promise<void> {
    this.persist(`${provider}-user@example.com`);
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
    const next = encodeURIComponent(new URL(redirectTo).pathname + new URL(redirectTo).search);
    location.assign(`login.html?next=${next}`);
    return new Promise<AuthSession>(() => {}); // never resolves; page is navigating away
  }

  private persist(email: string): AuthSession {
    const session: AuthSession = {
      user: { id: `dev-${btoa(email).replace(/=/g, '')}`, email, displayName: email },
      accessToken: 'dev-token',
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    this.emit(session);
    return session;
  }

  private emit(session: AuthSession | null): void {
    for (const listener of this.listeners) listener(session);
  }
}
