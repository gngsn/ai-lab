import { StorageKeys } from './constants';

/** Theme keys map to `[data-theme]` blocks in styles/tokens.css. */
export const THEMES = ['midnight', 'slate'] as const;
export type ThemeKey = (typeof THEMES)[number];

export const DEFAULT_THEME: ThemeKey = 'midnight';

/**
 * Apply the stored theme before page UI renders (SPEC §12). Unknown/missing
 * values fall back to the default. Component CSS depends only on semantic tokens,
 * so switching themes never touches component CSS.
 */
export function applyTheme(): ThemeKey {
  const stored = localStorage.getItem(StorageKeys.theme) as ThemeKey | null;
  const theme = stored && (THEMES as readonly string[]).includes(stored) ? stored : DEFAULT_THEME;
  document.documentElement.dataset.theme = theme;
  return theme;
}

export function setTheme(theme: ThemeKey): void {
  localStorage.setItem(StorageKeys.theme, theme);
  document.documentElement.dataset.theme = theme;
}
