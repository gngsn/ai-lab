import '@ui/styles/tokens.css';
import '@ui/styles/base.css';
import { applyTheme, type ThemeKey } from '@ui/theme';
import { getPorts } from '@composition/index';
import { env } from '@composition/env';
import { requireLogin } from '@features/auth/require-login';
import { bindAccountMenu } from '@features/auth/account-menu';
import type { Ports } from '@ports/ports';
import type { AuthSession } from '@ports/auth-port';

export interface PageContext {
  ports: Ports;
  theme: ThemeKey;
}

export interface OwnerPageContext extends PageContext {
  session: AuthSession;
}

/** Every page starts here: apply the theme, then obtain ports from the composition root. */
export function bootPage(): PageContext {
  const theme = applyTheme();
  const ports = getPorts();
  return { ports, theme };
}

/** Owner pages: boot and enforce the login guard. Bind the account menu after the
 *  page has rendered its chrome (so the ids exist). */
export async function bootOwnerPage(): Promise<OwnerPageContext> {
  const ctx = bootPage();
  const session = await requireLogin(ctx.ports);
  return { ...ctx, session };
}

/**
 * Phase 0 placeholder — renders a themed page shell so the skeleton is verifiable.
 * Replaced by the real page UI in later phases.
 */
export function renderPlaceholder(title: string): void {
  const root = document.getElementById('app') ?? document.body;
  root.innerHTML = `
    <div class="app-placeholder">
      <h1>${title}</h1>
      <small>Slideflow · backend: ${env.backend}</small>
    </div>`;
}

/**
 * Owner placeholder: the themed shell plus the account email + logout chrome that
 * every owner page must expose (SPEC §4.5). Binds the account menu after rendering.
 */
export function renderOwnerPlaceholder(title: string, ctx: OwnerPageContext): void {
  const root = document.getElementById('app') ?? document.body;
  root.innerHTML = `
    <div class="app-placeholder">
      <h1>${title}</h1>
      <small>Slideflow · backend: ${env.backend}</small>
      <div class="account-menu">
        <span id="account-email"></span>
        <button id="logout-btn" type="button">Log out</button>
      </div>
    </div>`;
  bindAccountMenu(ctx.ports, ctx.session);
}
