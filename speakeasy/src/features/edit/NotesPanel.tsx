import { useCallback, useEffect, useRef, useState } from "react";
import { upsertKeyMessage, upsert as upsertNote } from "../../data/notes";
import { parseNotesMd } from "../../lib/import-html";
import type { EditorModel } from "./model";

type Chrome = {
  setStatus: (text: string, kind?: string) => void;
  toast: (message: string, kind?: string) => void;
};

const NOTES_FONT_SIZE_KEY = "slidesEditor.notesFontSize";
const NOTES_FONT_SIZE_MIN = 11;
const NOTES_FONT_SIZE_MAX = 20;
const SAVE_DEBOUNCE_MS = 800;

// Auto-save is persisted in localStorage; there is no toolbar control for it any more.
const autoSave = () => localStorage.getItem("slidesEditor.autoSave") !== "false";
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function readNotesFontSize() {
  const parsed = Number.parseInt(localStorage.getItem(NOTES_FONT_SIZE_KEY) || "", 10);
  return Number.isFinite(parsed)
    ? Math.min(NOTES_FONT_SIZE_MAX, Math.max(NOTES_FONT_SIZE_MIN, parsed))
    : 14;
}
function applyNotesFontSize(size: number) {
  const next = Math.min(NOTES_FONT_SIZE_MAX, Math.max(NOTES_FONT_SIZE_MIN, size));
  document.documentElement.style.setProperty("--notes-font-size", `${next}px`);
  try {
    localStorage.setItem(NOTES_FONT_SIZE_KEY, String(next));
  } catch {}
  return next;
}

// The notes and key-message fields for the current slide, with debounced saves.
// (The legacy page also carried "Listen" (ElevenLabs) code for these notes, but
// its buttons are not in the page, so it never ran and is not ported.)
export function NotesPanel({
  deckId,
  model,
  chrome,
  asideToggle,
}: {
  deckId: string;
  model: EditorModel;
  chrome: Chrome;
  asideToggle: React.ReactNode;
}) {
  const { currentSectionId } = model;
  const [notesText, setNotesText] = useState("");
  const [keyText, setKeyText] = useState("");
  // Bumped when the caches change under the current slide (key-message import).
  const [reload, setReload] = useState(0);
  const notesPending = useRef<{ sid: string | null; content: string } | null>(null);
  const keyPending = useRef<{ sid: string | null; content: string } | null>(null);
  const notesTimer = useRef(0);
  const keyTimer = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ model, chrome });
  latest.current = { model, chrome };

  // Notes/key message come from the in-memory cache — no network round-trip.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs read on purpose
  useEffect(() => {
    setNotesText(currentSectionId ? (model.notesRef.current.get(currentSectionId) ?? "") : "");
    setKeyText(currentSectionId ? (model.keyMessagesRef.current.get(currentSectionId) ?? "") : "");
  }, [currentSectionId, reload]);

  const flushKeyMessageSave = useCallback(async () => {
    if (!keyPending.current) return;
    window.clearTimeout(keyTimer.current);
    keyTimer.current = 0;
    const { sid, content } = keyPending.current;
    keyPending.current = null;
    const { model: m, chrome: c } = latest.current;
    try {
      await upsertKeyMessage(deckId, sid as string, content);
      m.keyMessagesRef.current.set(sid as string, content);
      c.setStatus(`key message saved · ${new Date().toLocaleTimeString()}`, "ok");
    } catch (err) {
      c.setStatus("key message save failed", "err");
      c.toast(`Key message save failed: ${messageOf(err)}`, "err");
    }
  }, [deckId]);

  const flushNotesSave = useCallback(async () => {
    await flushKeyMessageSave(); // every notes flush point covers it too
    if (!notesPending.current) return;
    window.clearTimeout(notesTimer.current);
    notesTimer.current = 0;
    const { sid, content } = notesPending.current;
    notesPending.current = null;
    const { model: m, chrome: c } = latest.current;
    try {
      await upsertNote(deckId, sid as string, content);
      m.notesRef.current.set(sid as string, content); // keep cache current
      c.setStatus(`notes saved · ${new Date().toLocaleTimeString()}`, "ok");
    } catch (err) {
      c.setStatus("notes save failed", "err");
      c.toast(`Notes save failed: ${messageOf(err)}`, "err");
    }
  }, [deckId, flushKeyMessageSave]);

  useEffect(() => {
    const unregister = model.registerFlusher(flushNotesSave);
    const onBeforeUnload = () => {
      if (notesPending.current || keyPending.current) void flushNotesSave();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      unregister();
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [model.registerFlusher, flushNotesSave]);

  // Notes font size (a CSS variable on <html>), restored on load.
  const [, setFontSize] = useState(() => readNotesFontSize());
  useEffect(() => {
    applyNotesFontSize(readNotesFontSize());
  }, []);

  const onNotesChange = (value: string) => {
    setNotesText(value);
    notesPending.current = { sid: model.currentRef.current, content: value };
    window.clearTimeout(notesTimer.current);
    if (autoSave()) {
      chrome.setStatus("notes: saving…");
      notesTimer.current = window.setTimeout(() => void flushNotesSave(), SAVE_DEBOUNCE_MS);
    } else {
      chrome.setStatus("notes: unsaved", "warn");
    }
  };
  const onKeyChange = (value: string) => {
    setKeyText(value);
    keyPending.current = { sid: model.currentRef.current, content: value };
    window.clearTimeout(keyTimer.current);
    if (autoSave()) {
      chrome.setStatus("key message: saving…");
      keyTimer.current = window.setTimeout(() => void flushKeyMessageSave(), SAVE_DEBOUNCE_MS);
    } else {
      chrome.setStatus("key message: unsaved", "warn");
    }
  };

  // Import key messages for every slide from a Markdown file, in the same
  // format as the script (`---` between slides, optional `## title`), matched
  // by slide order. Slides past the end of the file get an empty message.
  const importKeyMessages = async (file: File) => {
    const items = parseNotesMd(await file.text());
    if (!items.length) {
      chrome.toast(`No key messages found in ${file.name}`, "err");
      return;
    }
    const slides = model.slidesRef.current;
    const filled = slides.filter((s) => model.keyMessagesRef.current.get(s.section_id)?.trim());
    if (
      filled.length &&
      !confirm(
        `${file.name}: ${items.length} key message(s) for ${slides.length} slide(s).\n` +
          `Replace the ${filled.length} existing key message(s)?`,
      )
    )
      return;
    keyPending.current = null; // the import supersedes an unsaved edit
    window.clearTimeout(keyTimer.current);
    chrome.setStatus("key messages: importing…");
    try {
      const ordered = [...slides].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      for (const [i, slide] of ordered.entries()) {
        const text = items[i]?.body ?? "";
        await upsertKeyMessage(deckId, slide.section_id, text);
        model.keyMessagesRef.current.set(slide.section_id, text);
      }
      setReload((n) => n + 1);
      chrome.setStatus(`key messages imported · ${new Date().toLocaleTimeString()}`, "ok");
      chrome.toast(
        `Imported ${Math.min(items.length, ordered.length)} key message(s)${
          items.length !== ordered.length
            ? ` (file has ${items.length}, deck has ${ordered.length} slides)`
            : ""
        }`,
        "ok",
      );
    } catch (err) {
      chrome.setStatus("key message import failed", "err");
      chrome.toast(`Key message import failed: ${messageOf(err)}`, "err");
    }
  };

  return (
    <>
      <div className="notes-header">
        {asideToggle}
        <h3>Notes</h3>
        <div className="notes-controls">
          <button
            className="btn notes-size-btn"
            id="notes-size-down"
            type="button"
            aria-label="Decrease notes font size"
            onClick={() => setFontSize(applyNotesFontSize(readNotesFontSize() - 1))}
          >
            -
          </button>
          <button
            className="btn notes-size-btn"
            id="notes-size-up"
            type="button"
            aria-label="Increase notes font size"
            onClick={() => setFontSize(applyNotesFontSize(readNotesFontSize() + 1))}
          >
            +
          </button>
        </div>
      </div>
      <div className="field notes-only">
        <textarea
          id="notes-textarea"
          rows={14}
          placeholder="이 슬라이드의 발표 노트 (Markdown). 800ms 후 자동 저장."
          spellCheck="false"
          disabled={!currentSectionId}
          style={{ fontFamily: '"IBM Plex Sans KR", sans-serif', lineHeight: 1.6 }}
          value={notesText}
          onChange={(e) => onNotesChange(e.target.value)}
        />
      </div>
      <div className="field key-message">
        <div className="key-message-head">
          <label htmlFor="key-message-textarea">Key message</label>
          <button
            className="btn"
            id="key-message-import"
            type="button"
            title="Import key messages for all slides from a Markdown file (same format as the script)"
            onClick={() => fileRef.current?.click()}
          >
            Import .md
          </button>
          <input
            id="key-message-import-file"
            type="file"
            accept=".md,.markdown,text/markdown"
            hidden
            ref={fileRef}
            onChange={async (e) => {
              const input = e.currentTarget;
              const file = input.files?.[0];
              input.value = "";
              if (file) await importKeyMessages(file);
            }}
          />
        </div>
        <textarea
          id="key-message-textarea"
          rows={3}
          placeholder="이 슬라이드에서 꼭 전할 한 문장. 800ms 후 자동 저장."
          spellCheck="false"
          disabled={!currentSectionId}
          value={keyText}
          onChange={(e) => onKeyChange(e.target.value)}
        />
      </div>
    </>
  );
}
