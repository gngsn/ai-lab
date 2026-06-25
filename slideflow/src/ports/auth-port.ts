/** The authenticated owner (SPEC §4.1). */
export interface AuthUser {
  id: string;
  email: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface AuthSession {
  user: AuthUser;
  accessToken?: string;
}

/**
 * Provider-agnostic auth. Implemented by adapters/supabase and adapters/local;
 * page code depends only on this interface (SPEC §4.3).
 */
export interface AuthPort {
  getSession(): Promise<AuthSession | null>;
  getUser(): Promise<AuthUser | null>;
  loginWithEmailPassword(email: string, password: string): Promise<AuthSession>;
  loginWithMagicLink(email: string, redirectTo: string): Promise<void>;
  loginWithOAuth(provider: string, redirectTo: string): Promise<void>;
  logout(): Promise<void>;
  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void;
  requireLogin(opts: { redirectTo: string }): Promise<AuthSession>;
}
