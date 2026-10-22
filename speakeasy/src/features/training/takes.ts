// The panel's two take histories in IndexedDB: generated speech ("history",
// newest first, up to ten, reused while text and engine stay the same) and the
// user's own recordings ("recordings"). Port of the history code in
// public/js/training-panel.js; the record layout is unchanged.
import { sha1Hex } from "../../lib/sha1";
import { MAX_HISTORY, trainingConfig } from "./config";
import { idbStore, type KeyValueStore } from "./db";
import { synthesizeSpeech } from "./tts";

export type TtsVersion = {
  ts: number;
  engine: string;
  voice: string;
  textHash: string;
  mime: string;
  buf: ArrayBuffer;
  remotePath?: string;
};
export type RecVersion = { ts: number; mime: string; buf: ArrayBuffer };
export type History<T> = { versions: T[] };

export type TakeDeps = {
  store?: KeyValueStore;
  synthesize?: (engine: string, text: string, speed: number) => Promise<Blob>;
  hash?: (text: string) => Promise<string>;
  now?: () => number;
};

export const historyKey = (deckId: string, sectionId: string) => `${deckId}/${sectionId}`;

function remember<T>(hist: History<T>, version: T) {
  hist.versions.unshift(version);
  if (hist.versions.length > MAX_HISTORY) hist.versions.length = MAX_HISTORY;
}

/** The takes of one deck, bound to a storage and a speech engine call. */
export function createTakes(deckId: string, deps: TakeDeps = {}) {
  const store = deps.store ?? idbStore;
  const synthesize = deps.synthesize ?? synthesizeSpeech;
  const hash = deps.hash ?? sha1Hex;
  const now = deps.now ?? Date.now;

  async function getHistory(sectionId: string): Promise<History<TtsVersion>> {
    return (
      (await store.get<History<TtsVersion>>(historyKey(deckId, sectionId), "history")) || {
        versions: [],
      }
    );
  }
  async function saveHistory(sectionId: string, hist: History<TtsVersion>) {
    await store.put(historyKey(deckId, sectionId), hist, "history");
  }

  /**
   * Reuse the latest take when its text and engine are unchanged (or when it came from the
   * shared bucket for this exact text); otherwise synthesize once and store it as the newest.
   */
  async function getOrCreateVersion(
    sectionId: string,
    cleanText: string,
    opts: { engine: string; speed: number; forceNew?: boolean },
  ) {
    const textHash = await hash(cleanText);
    const hist = await getHistory(sectionId);
    if (!opts.forceNew) {
      const match = hist.versions.find(
        (v) => v.textHash === textHash && (v.engine === opts.engine || v.remotePath),
      );
      if (match) return { version: match, hist, reused: true };
    }
    const blob = await synthesize(opts.engine, cleanText, opts.speed);
    const buf = await blob.arrayBuffer();
    const version: TtsVersion = {
      ts: now(),
      engine: opts.engine,
      voice: opts.engine === "kokoro" ? trainingConfig().kokoroVoice : "",
      textHash,
      mime: blob.type || "audio/mpeg",
      buf,
    };
    remember(hist, version);
    await saveHistory(sectionId, hist);
    return { version, hist, reused: false };
  }

  /** Cache a take downloaded from the shared audio bucket. */
  async function addRemoteVersion(
    sectionId: string,
    hist: History<TtsVersion>,
    blob: Blob,
    remotePath: string,
    cleanText: string,
  ) {
    const buf = await blob.arrayBuffer();
    const version: TtsVersion = {
      ts: now(),
      engine: "supabase",
      voice: "",
      textHash: await hash(cleanText),
      mime: blob.type || "audio/mpeg",
      buf,
      remotePath,
    };
    remember(hist, version);
    await saveHistory(sectionId, hist);
    return version;
  }

  async function getRecordings(sectionId: string): Promise<History<RecVersion>> {
    return (
      (await store.get<History<RecVersion>>(historyKey(deckId, sectionId), "recordings")) || {
        versions: [],
      }
    );
  }
  async function saveRecording(sectionId: string, blob: Blob) {
    const buf = await blob.arrayBuffer();
    const hist = await getRecordings(sectionId);
    const version: RecVersion = { ts: now(), mime: blob.type || "audio/webm", buf };
    remember(hist, version);
    await store.put(historyKey(deckId, sectionId), hist, "recordings");
    return { version, hist };
  }

  return {
    getHistory,
    saveHistory,
    getOrCreateVersion,
    addRemoteVersion,
    getRecordings,
    saveRecording,
  };
}
export type Takes = ReturnType<typeof createTakes>;
