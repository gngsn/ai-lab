// Typed access to runtime files that stay in public/ (sync.js, shortcuts-help.js).
// They are loaded by URL at run time, exactly as the legacy pages loaded them.
type SlidePayload = { section_id?: string; index?: number } | null | undefined;
type SlideSync = { close: () => unknown } | null;
type Shortcut = { keys: string[]; desc: string };

const SYNC_URL = "/js/sync.js";
const SHORTCUTS_URL = "/js/shortcuts-help.js";

export async function createSlideSync(
  room: string,
  onSlideChange: (payload: SlidePayload) => void,
): Promise<SlideSync> {
  const mod = (await import(/* @vite-ignore */ SYNC_URL)) as {
    createSlideSync: (room: string, onSlideChange: (payload: SlidePayload) => void) => SlideSync;
  };
  return mod.createSlideSync(room, onSlideChange);
}

export async function bindShortcutsHelp(pageName: string, shortcuts: Shortcut[]) {
  const mod = (await import(/* @vite-ignore */ SHORTCUTS_URL)) as {
    bindShortcutsHelp: (pageName: string, shortcuts: Shortcut[]) => void;
  };
  mod.bindShortcutsHelp(pageName, shortcuts);
}

// History drawer (public/js/history-ui.js): shared with the legacy edit.html, so it stays there.
export type HistoryUIInstance = { refresh: () => Promise<void> };
export type HistoryUIOptions = {
  deckId: string;
  panelEl: HTMLElement;
  currentSectionGetter: () => string | null;
  onRestored: (info: { section_id: string; source: string }) => void | Promise<void>;
};
const HISTORY_URL = "/js/history-ui.js";
type HistoryModule = {
  HistoryUI: new (options: HistoryUIOptions) => HistoryUIInstance;
  saveVersionPrompt: (deckId: string) => Promise<string | null>;
};
export const loadHistoryUi = () => import(/* @vite-ignore */ HISTORY_URL) as Promise<HistoryModule>;
