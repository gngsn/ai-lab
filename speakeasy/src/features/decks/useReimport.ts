import { useRef, useState } from "react";
import { errorMessage } from "../../lib/errors";
import { nameFromUrl } from "../../lib/remote-source";
import {
  fileSource,
  type Loaded,
  loadRemoteHtml,
  loadRemoteMarkdown,
  PARTS,
  type PartName,
  reimportDeck,
  replaceLabel,
  type Source,
  summarizePart,
} from "./import-deck";

export type PartState = { kind: "" | "busy" | "ready" | "error"; text: string };
type DeckRef = { id: string; title: string };
type PartMap<T> = Record<PartName, T>;

const idle = (): PartState => ({ kind: "", text: "" });
const eachPart = <T>(make: () => T): PartMap<T> => ({
  slides: make(),
  script: make(),
  keys: make(),
});

/** The Re-import modal: one row per replaceable part (slides, script, key messages), each holding
 *  what it will be replaced with, and running the replacement. */
export function useReimport(
  githubToken: () => string,
  onDone: (deckId: string, parts: string[]) => void,
) {
  const [deck, setDeck] = useState<DeckRef | null>(null);
  const [states, setStates] = useState<PartMap<PartState>>(() => eachPart(idle));
  const [urls, setUrls] = useState<PartMap<string>>(() => eachPart(() => ""));
  const [error, setError] = useState("");
  const [runLabel, setRunLabel] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const sources = useRef<PartMap<Source | null>>(eachPart(() => null));
  const pending = useRef<PartMap<Promise<void> | null>>(eachPart(() => null));
  const fileInputs = useRef<PartMap<HTMLInputElement | null>>(eachPart(() => null));
  const deckRef = useRef<DeckRef | null>(null);

  const setState = (name: PartName, state: PartState) =>
    setStates((all) => ({ ...all, [name]: state }));
  const setUrl = (name: PartName, value: string) => setUrls((all) => ({ ...all, [name]: value }));
  const clearFile = (name: PartName) => {
    const input = fileInputs.current[name];
    if (input) input.value = "";
  };

  const resetPart = (name: PartName) => {
    sources.current[name] = null;
    pending.current[name] = null;
    clearFile(name);
    setUrl(name, "");
    setState(name, idle());
  };

  /** Validates a chosen source right away so the row can say what it holds. */
  const pick = async (name: PartName, load: () => Promise<Loaded>, label: string) => {
    sources.current[name] = null;
    setState(name, { kind: "busy", text: "Reading…" });
    setError("");
    const task = (async () => {
      const loaded = await load();
      const summary = await summarizePart(name, loaded, deckRef.current?.id ?? "");
      sources.current[name] = loaded.source;
      setState(name, { kind: "ready", text: `✓ ${label} — ${summary}` });
    })().catch((err: unknown) => {
      sources.current[name] = null;
      setState(name, { kind: "error", text: errorMessage(err) });
    });
    pending.current[name] = task;
    await task;
  };

  const chooseFile = (name: PartName, file: File) => {
    setUrl(name, "");
    void pick(name, async () => ({ source: fileSource(file) }), file.name);
  };

  /** A link was entered (the field lost focus with a new value). */
  const commitUrl = (name: PartName, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return resetPart(name);
    clearFile(name);
    void pick(
      name,
      async () =>
        name === "slides"
          ? loadRemoteHtml(trimmed, githubToken())
          : { source: await loadRemoteMarkdown(trimmed, githubToken()) },
      nameFromUrl(trimmed),
    );
  };

  const pickedParts = PARTS.filter((name) => states[name].kind === "ready");

  const run = async () => {
    const current = deckRef.current;
    if (!current) return;
    try {
      setError("");
      await Promise.all(Object.values(pending.current));
      setRunning(true);
      const parts = await reimportDeck(
        {
          deck: current,
          slides: sources.current.slides,
          script: sources.current.script,
          keys: sources.current.keys,
          token: githubToken(),
        },
        setRunLabel,
      );
      close();
      onDone(current.id, parts);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
      setRunLabel(null);
    }
  };

  const close = () => {
    deckRef.current = null;
    setDeck(null);
  };

  return {
    deck,
    states,
    urls,
    error,
    running,
    runLabel: runLabel ?? replaceLabel(pickedParts),
    canRun: pickedParts.length > 0 && !running,
    openFor: (next: DeckRef) => {
      deckRef.current = next;
      setDeck(next);
      for (const name of PARTS) resetPart(name);
      setError("");
    },
    close,
    setUrl,
    resetPart,
    chooseFile,
    commitUrl,
    run,
    fileInputRef: (name: PartName) => (element: HTMLInputElement | null) => {
      fileInputs.current[name] = element;
    },
  };
}
