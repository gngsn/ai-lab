// Typed access to runtime files that stay in public/ (sync.js, training-panel.js, ...).
// They are loaded by URL at run time, exactly as the legacy pages loaded them.
type SlidePayload = { section_id?: string; index?: number } | null | undefined;
type SlideSync = { close: () => unknown } | null;

const SYNC_URL = "/js/sync.js";

export async function createSlideSync(
  room: string,
  onSlideChange: (payload: SlidePayload) => void,
): Promise<SlideSync> {
  const mod = (await import(/* @vite-ignore */ SYNC_URL)) as {
    createSlideSync: (room: string, onSlideChange: (payload: SlidePayload) => void) => SlideSync;
  };
  return mod.createSlideSync(room, onSlideChange);
}

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

// Slide-sized canvas scaling (public/js/slide-fit.js).
export type SlideFit = { setEnabled: (enabled: boolean) => void; disconnect: () => void };
export async function fitSlideFrame(frame: HTMLIFrameElement, box: HTMLElement): Promise<SlideFit> {
  const mod = (await import(/* @vite-ignore */ FIT_URL)) as {
    fitSlideFrame: (frame: HTMLIFrameElement, box: HTMLElement) => SlideFit;
  };
  return mod.fitSlideFrame(frame, box);
}
