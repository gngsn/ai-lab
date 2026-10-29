import { useEffect, useRef, useState } from "react";
import type { DeckRow } from "../../data/types";
import { cleanForSpeech } from "./cleanForSpeech";
import { exportNotesMd } from "./notes-md";

type Props = { deck: DeckRow; deckId: string; content: string };

export function NotesView({ deck, deckId, content }: Props) {
  const synth = typeof window === "undefined" ? undefined : window.speechSynthesis;
  const [, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    document.title = `Notes · ${deck.title || deckId}`;
  }, [deck, deckId]);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const speaking = !!synth?.speaking;
  const paused = !!synth?.paused;

  const stopSpeech = () => {
    if (!synth) return;
    synth.cancel();
    refresh();
  };

  const speakNotes = () => {
    if (!synth) {
      alert("This browser does not support speech synthesis.");
      return;
    }
    if (synth.speaking && synth.paused) {
      synth.resume();
      refresh();
      return;
    }
    if (synth.speaking) {
      synth.pause();
      refresh();
      return;
    }
    stopSpeech();
    const utterance = new SpeechSynthesisUtterance(cleanForSpeech(content));
    utterance.lang = "en-US";
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onend = refresh;
    utterance.onerror = refresh;
    synth.speak(utterance);
    refresh();
  };

  const copy = async () => {
    try {
      await exportNotesMd(deckId, { copy: true });
      setCopied(true);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1400);
    } catch (err) {
      alert(`Copy failed: ${(err as Error).message}`);
    }
  };

  const q = encodeURIComponent(deckId);
  return (
    <>
      <header>
        <span className="title" id="deck-title">
          {deck.title || deckId}
        </span>
        <span className="spacer" />
        <a className="btn home" href="./index.html" title="Home">
          ⌂ Home
        </a>
        <a className="btn" id="pronunciation-link" href={`./pronunciation.html?deck=${q}`}>
          🔊 Pronunciation
        </a>
        {/* A second link with the same id as the one above; the e2e tests pin the duplicate. */}
        {/* biome-ignore lint/a11y/useValidAnchor: pointer-only control by design */}
        <a className="btn" id="pronunciation-link" href="#">
          🔊 Pronunciation
        </a>
        <a
          className="btn"
          id="script-link"
          href={`./script.html?deck=${q}`}
          target="_blank"
          rel="noreferrer"
        >
          ⌨ Script
        </a>
        <button
          type="button"
          className={`btn${speaking || paused ? " warn" : ""}`}
          id="tts-btn"
          onClick={speakNotes}
        >
          {paused ? "▶ Resume" : speaking ? "⏸ Pause" : "▶ TTS"}
        </button>
        <button
          type="button"
          className="btn"
          id="tts-stop-btn"
          disabled={!speaking && !paused}
          onClick={stopSpeech}
        >
          ■ Stop
        </button>
        <button type="button" className={`btn${copied ? " ok" : ""}`} id="copy-btn" onClick={copy}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
        <button
          type="button"
          className="btn"
          id="download-btn"
          onClick={() => exportNotesMd(deckId)}
        >
          Download .md
        </button>
      </header>
      <main>
        <p className="hint">
          Marp 형식 — 그대로 <code>marp notes.md -o notes.pdf</code>로 변환 가능합니다.
        </p>
        <pre id="content">{content}</pre>
      </main>
    </>
  );
}
