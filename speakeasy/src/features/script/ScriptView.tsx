import { useCallback, useEffect, useRef, useState } from "react";
import type { DeckRow } from "../../data/types";
import { createSlideSync } from "../../lib/legacy-runtime";

export type Section = { section_id: string; order: number; title: string; body: string };
type Props = { deck: DeckRow; sections: Section[]; syncId: string | null; deckId: string };

const FONT_KEY = "speakeasy:notes:fontsize";
const LEGACY_FONT_KEY = "slides-editor:notes:fontsize"; // pre-rename name

// Keep the reader's font size across the rename.
try {
  const legacy = localStorage.getItem(LEGACY_FONT_KEY);
  if (legacy !== null) {
    if (localStorage.getItem(FONT_KEY) === null) localStorage.setItem(FONT_KEY, legacy);
    localStorage.removeItem(LEGACY_FONT_KEY);
  }
} catch {}

export function ScriptView({ deck, sections, syncId, deckId }: Props) {
  const [current, setCurrent] = useState(0);
  const [fontSize, setFontSize] = useState(() =>
    Number.parseFloat(localStorage.getItem(FONT_KEY) || "1.15"),
  );
  const [manual, setManualState] = useState(false);
  const [noHighlight, setNoHighlight] = useState(false);
  // The legacy page re-rendered (and re-scrolled) on every step, even a no-op one.
  const [renders, setRenders] = useState(0);
  const manualRef = useRef(false);
  const currentRef = useRef(0);
  const scriptRef = useRef<HTMLDivElement>(null);

  const setManual = useCallback((value: boolean) => {
    manualRef.current = value;
    setManualState(value);
  }, []);
  const goTo = useCallback((index: number) => {
    currentRef.current = index;
    setCurrent(index);
    setRenders((n) => n + 1);
  }, []);
  const step = useCallback(
    (delta: 1 | -1) => {
      setManual(true);
      const next = currentRef.current + delta;
      goTo(next >= 0 && next < sections.length ? next : currentRef.current);
    },
    [goTo, setManual, sections.length],
  );

  useEffect(() => {
    document.title = deck?.title ? `Script · ${deck.title}` : "Script";
    // Best-effort: keep mobile screen awake while presenting from it.
    if ("wakeLock" in navigator) navigator.wakeLock.request("screen").catch(() => {});
  }, [deck]);

  useEffect(() => {
    try {
      localStorage.setItem(FONT_KEY, String(fontSize));
    } catch {}
  }, [fontSize]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every render, like the legacy page
  useEffect(() => {
    scriptRef.current
      ?.querySelector(".sec.active")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [renders]);

  useEffect(() => {
    if (!syncId) return;
    const indexById = new Map(sections.map((s, i) => [s.section_id, i]));
    let closed = false;
    let sync: { close: () => unknown } | null = null;
    void createSlideSync(syncId, (payload) => {
      if (manualRef.current) return;
      const fromId =
        payload?.section_id && indexById.has(payload.section_id)
          ? (indexById.get(payload.section_id) ?? null)
          : null;
      const i = fromId ?? payload?.index ?? null;
      if (i != null && i !== currentRef.current && i >= 0 && i < sections.length) goTo(i);
    }).then((created) => {
      if (closed) created?.close();
      else sync = created;
    });
    return () => {
      closed = true;
      sync?.close();
    };
  }, [syncId, sections, goTo]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // OS autorepeat would otherwise jump multiple sections per key hold.
      if (e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      switch (e.key) {
        case "ArrowDown":
        case "ArrowRight":
        case "PageDown":
        case "j":
          e.preventDefault();
          step(1);
          break;
        case "ArrowUp":
        case "ArrowLeft":
        case "PageUp":
        case "k":
          e.preventDefault();
          step(-1);
          break;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [step]);

  const q = encodeURIComponent(deckId);
  const pct = sections.length > 1 ? (current / (sections.length - 1)) * 100 : 100;
  return (
    <>
      <div id="progress" style={{ width: `${pct}%` }} />
      <header id="header">
        <a className="btn home" href="./index.html" title="Home">
          ⌂ Home
        </a>
        <button
          type="button"
          className="btn btn-nav"
          id="prevSlide"
          title="이전 장표 (← / k)"
          onClick={() => step(-1)}
        >
          ◀
        </button>
        <button
          type="button"
          className="btn btn-nav"
          id="nextSlide"
          title="다음 장표 (→ / j)"
          onClick={() => step(1)}
        >
          ▶
        </button>
        <span id="slide-counter">{`${current + 1} / ${sections.length}`}</span>
        <div className="sep" />
        <button
          type="button"
          className="btn"
          id="decreaseFont"
          title="글자 작게"
          onClick={() => setFontSize((f) => Math.max(f - 0.1, 0.7))}
        >
          A−
        </button>
        <button
          type="button"
          className="btn"
          id="increaseFont"
          title="글자 크게"
          onClick={() => setFontSize((f) => Math.min(f + 0.1, 2.5))}
        >
          A+
        </button>
        <div className="sep" />
        <button
          type="button"
          className={`btn${noHighlight ? " btn-on" : ""}`}
          id="toggleHL"
          title="하이라이트 on/off"
          onClick={() => setNoHighlight((v) => !v)}
        >
          HL
        </button>
        <a
          className="btn"
          id="editNotesLink"
          href={`./script-edit.html?deck=${q}`}
          title="노트 편집 (script-edit.html)"
        >
          ✎ Notes
        </a>
        <a
          className="btn"
          id="marpLink"
          href={`./notes.html?deck=${q}`}
          title="Marp(.md) 조회"
          target="_blank"
          rel="noreferrer"
        >
          View as Marp
        </a>
        <div className="spacer" />
        {/* biome-ignore lint/a11y/noStaticElementInteractions: preserved legacy markup */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: preserved legacy markup */}
        <div
          id="sync-badge"
          className={syncId ? "live" : undefined}
          title="클릭하여 수동/자동 전환"
          style={manual ? { opacity: "0.5" } : undefined}
          onClick={() => setManual(!manualRef.current)}
        >
          <span className="sync-dot" />
          <span id="sync-label">{syncId ?? "sync off"}</span>
          <span id="mode-label" style={{ marginLeft: 4, fontSize: 10, opacity: 0.5 }}>
            {manual ? "· 수동" : ""}
          </span>
        </div>
      </header>
      <div id="error-banner" />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: preserved legacy markup */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: preserved legacy markup */}
      <div
        id="script"
        ref={scriptRef}
        className={noHighlight ? "no-hl" : undefined}
        onClick={(e) => {
          const sec = (e.target as HTMLElement).closest<HTMLElement>(".sec");
          if (!sec) return;
          const idx = Number.parseInt(sec.dataset.idx ?? "", 10);
          if (!Number.isNaN(idx) && idx !== currentRef.current) {
            setManual(true);
            goTo(idx);
          }
        }}
      >
        {sections.map((s, i) => {
          const cls = i === current ? "active" : Math.abs(i - current) === 1 ? "adj" : "";
          const body = (s.body || "").trim();
          return (
            <div
              key={s.section_id}
              className={`sec ${cls}`}
              data-idx={i}
              data-section-id={s.section_id}
            >
              <div className="sec-label">{s.title || `장표 ${i + 1}`}</div>
              <div className="sec-body" style={{ fontSize: `${fontSize}rem` }}>
                {body ? (
                  body.split("\n").map((line, n) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static text lines
                    <span key={n}>
                      {n > 0 && <br />}
                      {line}
                    </span>
                  ))
                ) : (
                  <span style={{ opacity: 0.4 }}>(빈 노트)</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
