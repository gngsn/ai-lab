import { useCallback, useEffect, useRef, useState } from "react";
import { getOne as getNote, upsert as upsertNote } from "../../data/notes";
import type { DeckRow } from "../../data/types";
import { bindShortcutsHelp, type HistoryUIInstance, loadHistoryUi } from "../../lib/legacy-runtime";
import { markdownToHtml } from "../../lib/markdown-lite";
import { syncRoomFor } from "../../lib/sync-room";
import { saveVersionPrompt } from "../history/save-version";

export type Section = { section_id: string; order: number; title: string; body: string };
type Props = { deck: DeckRow; deckId: string; sections: Section[] };

const SAVE_DEBOUNCE_MS = 800;

export function ScriptEditView({ deck, deckId, sections: initialSections }: Props) {
  // Mutable on purpose: a saved note updates its section's body (the legacy "snapshot").
  const sections = useRef(initialSections).current;
  const [currentSid, setCurrentSid] = useState<string | null>(sections[0]?.section_id || null);
  const [text, setText] = useState(sections[0]?.body || "");
  const [status, setStatus] = useState<{ text: string; kind: string }>({ text: "—", kind: "" });
  const currentRef = useRef(currentSid);
  const pending = useRef<{ sid: string | null; content: string } | null>(null);
  const saveTimer = useRef<number>(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const historyToggleRef = useRef<HTMLButtonElement>(null);
  const previewToggleRef = useRef<HTMLButtonElement>(null);
  const saveVersionRef = useRef<HTMLButtonElement>(null);
  const historyUi = useRef<HistoryUIInstance | null>(null);

  const show = useCallback(
    (statusText: string, kind = "") => setStatus({ text: statusText, kind }),
    [],
  );

  const renderEditor = useCallback(
    (sid: string | null) => {
      setText(sections.find((s) => s.section_id === sid)?.body || "");
    },
    [sections],
  );

  async function flushSave() {
    if (!pending.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = 0;
    const { sid, content } = pending.current;
    pending.current = null;
    try {
      await upsertNote(deckId, sid as string, content);
      const sec = sections.find((s) => s.section_id === sid);
      if (sec) sec.body = content;
      show(`saved · ${new Date().toLocaleTimeString()}`, "ok");
    } catch (err) {
      show("save failed", "err");
      console.error("[notes-save]", err);
    }
  }

  async function select(sid: string) {
    if (sid === currentRef.current) return;
    await flushSave(); // never lose the in-progress edit
    currentRef.current = sid;
    setCurrentSid(sid);
    renderEditor(sid);
  }

  async function saveVersion() {
    try {
      await flushSave(); // capture in-progress notes into the snapshot
      const ts = await saveVersionPrompt(deckId);
      if (ts === null) return;
      show("version saved", "ok");
      if (drawerRef.current?.classList.contains("open")) void historyUi.current?.refresh();
    } catch (err) {
      show("save version failed", "err");
      console.error(err);
    }
  }
  const latest = useRef({ saveVersion, flushSave });
  latest.current = { saveVersion, flushSave };

  const toggleHistory = () => {
    const open = drawerRef.current?.classList.toggle("open") ?? false;
    historyToggleRef.current?.classList.toggle("active", open);
    // The module may still be loading on a very early click; its handler runs first.
    if (open) void loadHistoryUi().then(() => historyUi.current?.refresh());
  };
  const toggleHistoryRef = useRef(toggleHistory);
  toggleHistoryRef.current = toggleHistory;

  useEffect(() => {
    document.title = deck?.title ? `Notes · ${deck.title}` : "Notes";
    // Default: preview visible on desktop, hidden on small screens
    if (window.matchMedia("(max-width: 900px)").matches) {
      document.body.classList.add("hide-preview");
    } else {
      previewToggleRef.current?.classList.add("active");
    }
  }, [deck]);

  useEffect(() => {
    let cancelled = false;
    void loadHistoryUi().then(({ HistoryUI }) => {
      if (cancelled || !panelRef.current) return;
      historyUi.current = new HistoryUI({
        deckId,
        panelEl: panelRef.current,
        currentSectionGetter: () => currentRef.current,
        onRestored: async ({ section_id, source }) => {
          // Refresh local snapshot for the restored section
          if (source === "notes") {
            try {
              const note = await getNote(deckId, section_id);
              const sec = sections.find((s) => s.section_id === section_id);
              if (sec) sec.body = note?.content || "";
            } catch (e) {
              console.warn(e);
            }
          }
          if (section_id === currentRef.current) renderEditor(section_id);
          show("restored", "ok");
        },
      });
    });
    void bindShortcutsHelp("Notes (script-edit)", [
      { keys: ["⌘S", "Ctrl+S"], desc: "Save version (manual snapshot)" },
      { keys: ["H"], desc: "Toggle history drawer" },
      { keys: ["Click section"], desc: "Switch (auto-saves pending edit)" },
      { keys: ["?"], desc: "This help" },
    ]);
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const isSave = (e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S");
      if (tag === "TEXTAREA" || tag === "INPUT") {
        if (isSave) {
          e.preventDefault();
          saveVersionRef.current?.click();
        }
        return;
      }
      if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        historyToggleRef.current?.click();
      } else if (isSave) {
        e.preventDefault();
        saveVersionRef.current?.click();
      }
    };
    // Best-effort flush on tab close / refresh.
    const onBeforeUnload = () => {
      if (pending.current) void latest.current.flushSave();
    };
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      cancelled = true;
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [deckId, sections, show, renderEditor]);

  const q = encodeURIComponent(deckId);
  const sec = sections.find((s) => s.section_id === currentSid);
  return (
    <>
      <div id="app">
        <header id="toolbar">
          <span className="title" id="deck-title">
            {deck?.title || deckId}
          </span>
          <span className="spacer" />
          <a className="btn home" href="./index.html" title="Home">
            ⌂ Home
          </a>
          <a
            className="btn"
            id="slides-link"
            href={`./edit.html?deck=${q}`}
            target="_blank"
            rel="noreferrer"
          >
            ✎ Slides
          </a>
          <a className="btn" id="read-link" href={`./script.html?deck=${q}`}>
            ↩ Read
          </a>
          <a
            className="btn"
            id="present-link"
            href={`./present.html?deck=${q}&sync=${encodeURIComponent(syncRoomFor(deckId))}`}
            target="_blank"
            rel="noreferrer"
          >
            ▶ Present
          </a>
          <button
            type="button"
            className="btn"
            id="preview-toggle"
            ref={previewToggleRef}
            onClick={() => {
              document.body.classList.toggle("hide-preview");
              previewToggleRef.current?.classList.toggle(
                "active",
                !document.body.classList.contains("hide-preview"),
              );
            }}
          >
            Preview
          </button>
          <button
            type="button"
            className="btn"
            id="save-version"
            ref={saveVersionRef}
            title="Save version (⌘S)"
            onClick={() => void saveVersion()}
          >
            ★ Save
          </button>
          <button
            type="button"
            className="btn"
            id="history-toggle"
            ref={historyToggleRef}
            title="History (H)"
            onClick={toggleHistory}
          >
            ⏱ History
          </button>
          <span id="status" data-kind={status.kind}>
            {status.text}
          </span>
        </header>
        <main id="editor-grid">
          <aside id="edit-sections">
            {sections.map((s, i) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: preserved legacy markup
              // biome-ignore lint/a11y/noStaticElementInteractions: preserved legacy markup
              <div
                key={s.section_id}
                className={`edit-sec ${s.section_id === currentSid ? "active" : ""}`}
                data-section-id={s.section_id}
                onClick={() => void select(s.section_id)}
              >
                <span className="o">{i + 1}</span>
                <span className="t">{s.title || s.section_id}</span>
              </div>
            ))}
          </aside>
          <section id="edit-pane">
            <div id="edit-heading">{sec?.title || currentSid || "—"}</div>
            <textarea
              id="edit-textarea"
              spellCheck={false}
              placeholder="노트를 입력하세요. Markdown 지원."
              value={text}
              disabled={!sec}
              onChange={(e) => {
                const v = e.target.value;
                setText(v);
                pending.current = { sid: currentRef.current, content: v };
                show("saving…");
                window.clearTimeout(saveTimer.current);
                saveTimer.current = window.setTimeout(() => void flushSave(), SAVE_DEBOUNCE_MS);
              }}
            />
          </section>
          <section
            id="edit-preview"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: markdownToHtml escapes its input
            dangerouslySetInnerHTML={{
              __html: text ? markdownToHtml(text) : '<p style="opacity:.4">(빈 노트)</p>',
            }}
          />
        </main>
      </div>
      <aside className="hist-drawer" id="hist-drawer" ref={drawerRef}>
        <div id="history-panel" ref={panelRef} />
      </aside>
    </>
  );
}
