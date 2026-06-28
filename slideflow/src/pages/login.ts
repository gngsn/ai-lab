import '@ui/styles/auth.css';
import { bootPage } from './boot';
import { el, elOpt } from '@ui/dom';
import { QueryParams } from '@ui/constants';

const { ports } = bootPage();

const params = new URLSearchParams(location.search);
const next = params.get(QueryParams.next) || 'index.html';

void init();

async function init(): Promise<void> {
  // Already authenticated → skip the form (SPEC §4.4).
  if (await ports.auth.getSession()) {
    location.assign(next);
    return;
  }
  render();
  wire();
}

function render(): void {
  const root = el('#app');
  root.innerHTML = `
    <div class="auth-wrap">
      <form id="auth-form" class="auth-card" novalidate>
        <h1>Sign in</h1>
        <p class="auth-sub">Slideflow</p>
        <label class="auth-field">
          <input id="auth-email" type="email" name="email" placeholder="you@example.com" autocomplete="email" required />
        </label>
        <label class="auth-field">
          <input id="auth-password" type="password" name="password" placeholder="Password" autocomplete="current-password" />
        </label>
        <button id="auth-login-btn" type="submit" class="auth-btn auth-btn-primary">Sign in</button>
        <button id="auth-magic-btn" type="button" class="auth-btn auth-btn-ghost">Email me a magic link</button>
        <button id="auth-oauth-google" type="button" class="auth-btn auth-btn-ghost">Continue with Google</button>
        <div id="auth-error" class="auth-error" role="alert"></div>
        <div id="auth-status" class="auth-status"></div>
      </form>
    </div>`;
}

function wire(): void {
  const form = el<HTMLFormElement>('#auth-form');
  const emailEl = el<HTMLInputElement>('#auth-email');
  const passwordEl = el<HTMLInputElement>('#auth-password');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    run(async () => {
      await ports.auth.loginWithEmailPassword(emailEl.value.trim(), passwordEl.value);
      location.assign(next);
    });
  });

  el('#auth-magic-btn').addEventListener('click', () => {
    run(async () => {
      const redirectTo = new URL(next, location.href).href;
      await ports.auth.loginWithMagicLink(emailEl.value.trim(), redirectTo);
      // Dev adapters log in immediately; cloud sends an email.
      if (await ports.auth.getSession()) location.assign(next);
      else setStatus('Check your email for the magic link.');
    });
  });

  el('#auth-oauth-google').addEventListener('click', () => {
    run(async () => {
      const redirectTo = new URL(next, location.href).href;
      await ports.auth.loginWithOAuth('google', redirectTo);
      if (await ports.auth.getSession()) location.assign(next);
    });
  });
}

/** Run an auth action, surfacing failures in #auth-error. */
function run(action: () => Promise<void>): void {
  setError('');
  setStatus('');
  action().catch((err: unknown) =>
    setError(err instanceof Error ? err.message : 'Something went wrong'),
  );
}

function setError(message: string): void {
  const node = elOpt('#auth-error');
  if (node) node.textContent = message;
}

function setStatus(message: string): void {
  const node = elOpt('#auth-status');
  if (node) node.textContent = message;
}
