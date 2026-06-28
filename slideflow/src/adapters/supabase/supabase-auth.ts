import type { AuthPort, AuthSession, AuthUser } from '@ports/auth-port';
import type { SupabaseClient } from './supabase-client';
import type { Session, User } from '@supabase/supabase-js';

/** AuthPort backed by Supabase Auth (SPEC §4.2). */
export class SupabaseAuth implements AuthPort {
  constructor(private readonly sb: SupabaseClient) {}

  async getSession(): Promise<AuthSession | null> {
    const { data } = await this.sb.auth.getSession();
    return data.session ? toSession(data.session) : null;
  }

  async getUser(): Promise<AuthUser | null> {
    const { data } = await this.sb.auth.getUser();
    return data.user ? toUser(data.user) : null;
  }

  async loginWithEmailPassword(email: string, password: string): Promise<AuthSession> {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw new Error(error?.message ?? 'Login failed');
    return toSession(data.session);
  }

  async loginWithMagicLink(email: string, redirectTo: string): Promise<void> {
    const { error } = await this.sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) throw new Error(error.message);
  }

  async loginWithOAuth(provider: string, redirectTo: string): Promise<void> {
    const { error } = await this.sb.auth.signInWithOAuth({
      provider: provider as 'google',
      options: { redirectTo },
    });
    if (error) throw new Error(error.message);
  }

  async logout(): Promise<void> {
    const { error } = await this.sb.auth.signOut();
    if (error) throw new Error(error.message);
  }

  onAuthStateChange(callback: (s: AuthSession | null) => void): () => void {
    const { data } = this.sb.auth.onAuthStateChange((_event, session) => {
      callback(session ? toSession(session) : null);
    });
    return () => data.subscription.unsubscribe();
  }

  async requireLogin({ redirectTo }: { redirectTo: string }): Promise<AuthSession> {
    const session = await this.getSession();
    if (session) return session;
    const target = new URL(redirectTo);
    const next = encodeURIComponent(target.pathname + target.search);
    location.assign(`login.html?next=${next}`);
    return new Promise<AuthSession>(() => {});
  }
}

function toUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email ?? null,
    displayName: (user.user_metadata?.['name'] as string | undefined) ?? user.email ?? null,
    avatarUrl: (user.user_metadata?.['avatar_url'] as string | undefined) ?? null,
  };
}

function toSession(session: Session): AuthSession {
  return { user: toUser(session.user), accessToken: session.access_token };
}
