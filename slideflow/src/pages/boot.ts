import '@ui/styles/tokens.css';
import '@ui/styles/base.css';
import { applyTheme, type ThemeKey } from '@ui/theme';
import { getPorts } from '@composition/index';
import { env } from '@composition/env';
import type { Ports } from '@ports/ports';

export interface PageContext {
  ports: Ports;
  theme: ThemeKey;
}

/** Every page starts here: apply the theme, then obtain ports from the composition root. */
export function bootPage(): PageContext {
  const theme = applyTheme();
  const ports = getPorts();
  return { ports, theme };
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
