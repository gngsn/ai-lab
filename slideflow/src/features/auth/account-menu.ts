import type { Ports } from '@ports/ports';
import type { AuthSession } from '@ports/auth-port';
import { elOpt } from '@ui/dom';

/**
 * Wire the account email + logout control present on every owner page (SPEC §4.5).
 * Ids are optional so pages without the full chrome still work.
 */
export function bindAccountMenu(ports: Ports, session: AuthSession): void {
  const emailEl = elOpt('#account-email');
  if (emailEl) emailEl.textContent = session.user.email ?? '';

  const logoutBtn = elOpt<HTMLButtonElement>('#logout-btn');
  logoutBtn?.addEventListener('click', async () => {
    try {
      await ports.auth.logout();
      location.assign('login.html');
    } catch {
      logoutBtn.textContent = 'Logout failed — retry';
    }
  });
}
