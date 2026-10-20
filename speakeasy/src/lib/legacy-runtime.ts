// Typed access to runtime files that stay in public/ (training-panel.js).
// They are loaded by URL at run time, exactly as the legacy pages loaded them.
// Pronunciation page runtime (the shared training panel).
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
};
const TRAINING_URL = "/js/training-panel.js";
export async function loadPronunciationRuntime(): Promise<PronunciationRuntime> {
  const [training] = await Promise.all([import(/* @vite-ignore */ TRAINING_URL)]);
  return {
    cleanForSpeech: training.cleanForSpeech,
    silenceWav: training.silenceWav,
    mergeBlobs: training.mergeBlobs,
    createTrainingPanel: training.createTrainingPanel,
  };
}
