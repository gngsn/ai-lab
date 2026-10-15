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

// GitHub / remote HTML sources (public/js/remote-source.js).
export type RemoteMedia = { url: string; path: string };
export type RemoteSource = {
  fetchRemoteText: (
    input: string,
    opts?: { token?: string },
  ) => Promise<{ text: string; url: string }>;
  fetchRemoteBlob: (url: string, opts?: { token?: string }) => Promise<Blob>;
  remoteFileExists: (url: string, opts?: { token?: string }) => Promise<boolean>;
  makeSelfContained: (html: string, baseUrl: string, opts?: { token?: string }) => Promise<string>;
  findRepoMedia: (html: string, baseUrl: string) => RemoteMedia[];
  nameFromUrl: (input: string) => string;
};
const REMOTE_URL = "/js/remote-source.js";
export const loadRemoteSource = () =>
  import(/* @vite-ignore */ REMOTE_URL) as Promise<RemoteSource>;

// Pronunciation page runtime (shared training panel, asset warm-up, slide fit).
export type TrainingSection = { sectionId: string | null; title: string; text: string };
export type TrainingPanel = {
  setSection: (section: TrainingSection) => void;
  setSpeed: (speed: number) => void;
  setEngine: (name: string) => void;
  getEngine: () => string;
  synthesize: (
    sectionId: string,
    title: string,
    text: string,
  ) => Promise<{ buf: ArrayBuffer; mime?: string }>;
  destroy: () => void;
};
export type PronunciationRuntime = {
  cleanForSpeech: (text: string) => string;
  silenceWav: (seconds: number) => Blob;
  mergeBlobs: (blobs: Blob[]) => Promise<Blob>;
  createTrainingPanel: (
    container: HTMLElement,
    options: {
      deckId: string;
      getSection: () => TrainingSection;
      onScore: (sectionId: string, score: number, cls: string) => void;
    },
  ) => TrainingPanel;
  formatBytes: (bytes: number) => string;
  warmDeckAssets: (
    deck: unknown,
    slides: unknown[],
    options: { onProgress: (p: { done: number; total: number; bytes: number }) => void },
  ) => Promise<unknown>;
  fitSlideFrame: (frame: HTMLIFrameElement, box: HTMLElement) => unknown;
};
const TRAINING_URL = "/js/training-panel.js";
const PRELOAD_URL = "/js/preload-assets.js";
const FIT_URL = "/js/slide-fit.js";
export async function loadPronunciationRuntime(): Promise<PronunciationRuntime> {
  const [training, preload, fit] = await Promise.all([
    import(/* @vite-ignore */ TRAINING_URL),
    import(/* @vite-ignore */ PRELOAD_URL),
    import(/* @vite-ignore */ FIT_URL),
  ]);
  return {
    cleanForSpeech: training.cleanForSpeech,
    silenceWav: training.silenceWav,
    mergeBlobs: training.mergeBlobs,
    createTrainingPanel: training.createTrainingPanel,
    formatBytes: preload.formatBytes,
    warmDeckAssets: preload.warmDeckAssets,
    fitSlideFrame: fit.fitSlideFrame,
  };
}
