// Presenter view side panel of the present page. Shows the current slide's key
// message and script, the next slide, an elapsed timer and the live-caption
// controls. The slide frame reports each slide / step change with a "se:slide"
// postMessage (see runtime/present-runtime); the panel also reads the frame
// directly, so it keeps following if those messages don't arrive.
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getDeck } from "../../data/decks";
import { listByDeck as listNotes } from "../../data/notes";
import { listByDeck as listSlides } from "../../data/slides";
import type { NoteRow, SlideRow } from "../../data/types";
import { isSlideHiddenContent } from "../../lib/slide-visibility";
import { syncRoomFor } from "../../lib/sync-room";
import { createCaptionEngine } from "../captions/engine";
import { esc, renderScript } from "./script";

const FONT_KEY = "speakeasy:present:fontsize";
export const WIDTH_KEY = "speakeasy:present:panel-width";
export const HIDDEN_KEY = "speakeasy:present:panel-hidden";

export const store = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};

type Current = { index: number; section_id?: string | null; fragments: number[] };
type Engine = ReturnType<typeof createCaptionEngine>;
type Caption = { shown: boolean; en: string; mt: boolean; meta: string };

/** Current slide + shown fragments, read from the slide frame's DOM. */
function readFrame(frame: HTMLIFrameElement): Current | null {
  try {
    const w = frame.contentWindow as
      | (Window & { __seDeckController?: { slides?: HTMLElement[]; currentSlide?: number } })
      | null;
    const doc = w?.document;
    if (!w || !doc?.querySelector("[data-section-id]")) return null; // still loading
    const ctl = w.__seDeckController;
    const slides = ctl?.slides || [...doc.querySelectorAll<HTMLElement>("section.slide")];
    const index = Number.isInteger(ctl?.currentSlide)
      ? (ctl?.currentSlide as number)
      : slides.findIndex((s) => {
          const r = s.getBoundingClientRect();
          return r.bottom > r.height / 2 && r.top < r.height / 2;
        });
    const slide = slides[index];
    if (!slide) return null;
    const fragments = [...slide.querySelectorAll(".fragment")]
      .map((el, i) => (el.classList.contains("show") ? i : -1))
      .filter((i) => i >= 0);
    return { index, section_id: slide.dataset.sectionId, fragments };
  } catch {
    return null;
  }
}

const formatElapsed = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60));
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm.padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
};

type Props = {
  deckId: string;
  frameRef: RefObject<HTMLIFrameElement | null>;
  onHide: () => void;
  onWidth: (pct: number) => void;
};

export function PresenterPanel({ deckId, frameRef, onHide, onWidth }: Props) {
  const [fontSize, setFontSize] = useState(() => Number(store.get(FONT_KEY)) || 15);
  useEffect(() => store.set(FONT_KEY, String(fontSize)), [fontSize]);

  const startedAt = useRef(Date.now());
  const [elapsed, setElapsed] = useState("0:00");
  useEffect(() => {
    const tick = () => setElapsed(formatElapsed(Date.now() - startedAt.current));
    const id = window.setInterval(tick, 1000);
    tick();
    return () => window.clearInterval(id);
  }, []);

  const [data, setData] = useState<{
    slides: SlideRow[];
    allSlides: SlideRow[];
    notes: Map<string, NoteRow>;
    title: string | null;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([getDeck(deckId), listSlides(deckId), listNotes(deckId)]).then(
      ([deck, allSlides, notes]) => {
        if (cancelled) return;
        setData({
          allSlides,
          slides: allSlides.filter((s) => !isSlideHiddenContent(s.content)),
          notes: new Map(notes.map((n) => [n.section_id, n])),
          title: deck?.title ?? null,
        });
      },
      (err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  const [current, setCurrent] = useState<Current>({ index: 0, section_id: null, fragments: [] });
  const bodyRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  useEffect(() => {
    if (!data) return;
    let lastKey = "";
    let lastSlide: string | null | undefined = null;
    setCurrent({ index: 0, section_id: data.slides[0]?.section_id, fragments: [] });
    const follow = (state: Current) => {
      const key = `${state.section_id}|${(state.fragments || []).join(",")}`;
      if (key === lastKey) return;
      lastKey = key;
      const changed = state.section_id !== lastSlide;
      lastSlide = state.section_id;
      setCurrent(state);
      engineRef.current?.setSlide(state.section_id ?? undefined, state.index);
      if (changed && bodyRef.current) bodyRef.current.scrollTop = 0;
    };
    // The frame reports each change ("se:slide")…
    const onMessage = (e: MessageEvent) => {
      if (e.source === frameRef.current?.contentWindow && e.data?.type === "se:slide")
        follow(e.data);
    };
    window.addEventListener("message", onMessage);
    // …and the panel also reads the frame directly.
    const id = window.setInterval(() => {
      const frame = frameRef.current;
      const state = frame && readFrame(frame);
      if (state) follow(state);
    }, 300);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(id);
    };
  }, [data, frameRef]);

  const [cc, setCc] = useState({ ready: false, hasScript: false, listening: false });
  const ccRef = useRef(cc);
  ccRef.current = cc;
  const [caption, setCaption] = useState<Caption>({ shown: false, en: "", mt: false, meta: "" });
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!data) return;
    const note = (meta: string) => setCaption((c) => ({ ...c, shown: true, meta }));
    const engine = createCaptionEngine({
      deckId,
      slides: data.allSlides,
      room: new URLSearchParams(location.search).get("sync") || syncRoomFor(deckId),
      follow: false,
      onScript: ({ covered, lines }) => {
        note(`Captions script: ${lines} lines on ${covered} slides`);
        setCc((c) => ({ ...c, hasScript: true }));
      },
      onSent: (payload, why) =>
        setCaption({ shown: true, en: payload.en, mt: Boolean(payload.mt), meta: `CC · ${why}` }),
      onListening: (on, msg) => {
        note(msg);
        setCc((c) => ({ ...c, listening: on }));
      },
    });
    engineRef.current = engine;
    (window as unknown as { __seCaptions: unknown }).__seCaptions = { feed: engine.feed }; // testing without a microphone
    setCc((c) => ({ ...c, ready: true }));
    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [data, deckId]);

  const ccClick = (e: React.MouseEvent) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (!engine.hasScript || (e.shiftKey && !ccRef.current.listening))
      return fileRef.current?.click();
    if (ccRef.current.listening) engine.stop();
    else engine.start();
  };

  const view = useMemo(() => {
    if (!data) return null;
    let i = data.slides.findIndex((s) => s.section_id === current.section_id);
    if (i < 0 && Number.isInteger(current.index)) i = current.index;
    const slide = data.slides[i];
    const note = slide ? data.notes.get(slide.section_id) : null;
    const key = (note?.key_message || "").trim();
    const text = (note?.content || "").trim();
    const next = data.slides[i + 1];
    return {
      count: `${i + 1} / ${data.slides.length}`,
      title: slide?.title || "",
      key,
      script: text
        ? renderScript(text, current.fragments.length)
        : '<p class="pp-empty">No script for this slide.</p>',
      next: next ? `Next · <b>${esc(next.title || `Slide ${i + 2}`)}</b>` : "Last slide",
    };
  }, [data, current]);

  const ccState = cc.listening ? "live" : cc.hasScript ? "ready" : "none";
  const ccTitle = !cc.hasScript
    ? "Live captions: load a bilingual script (.md)"
    : cc.listening
      ? "Stop live captions"
      : "Start live captions (Shift-click: load another script)";

  const startResize = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      const frame = frameRef.current;
      const move = (ev: PointerEvent) => {
        const pct = ((window.innerWidth - ev.clientX) / window.innerWidth) * 100;
        const clamped = Math.min(70, Math.max(20, pct));
        store.set(WIDTH_KEY, clamped.toFixed(1));
        onWidth(clamped);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (frame) frame.style.pointerEvents = "";
      };
      if (frame) frame.style.pointerEvents = "none"; // keep receiving moves over the slide
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [frameRef, onWidth],
  );

  const bumpFont = (dir: number) => setFontSize((f) => Math.min(30, Math.max(11, f + dir * 1.5)));

  return (
    <aside id="__se_panel" data-deck-title={data?.title ?? undefined} style={{ fontSize }}>
      <div className="pp-resize" title="Drag to resize" onPointerDown={startResize} />
      <div className="pp-bar">
        <span className="pp-count">{view?.count ?? "– / –"}</span>
        <span className="pp-spacer" />
        <button
          type="button"
          className="pp-cc"
          hidden={!cc.ready}
          data-state={ccState}
          title={ccTitle}
          onClick={ccClick}
        >
          {cc.listening ? "● CC" : "CC"}
        </button>
        <input
          type="file"
          className="pp-cc-file"
          accept=".md,.markdown,text/markdown"
          hidden
          ref={fileRef}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) engineRef.current?.loadScript(await f.text());
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="pp-timer"
          title="Elapsed — click to reset"
          onClick={() => {
            startedAt.current = Date.now();
            setElapsed(formatElapsed(0));
          }}
        >
          {elapsed}
        </button>
        <button type="button" data-font="-1" title="Smaller text" onClick={() => bumpFont(-1)}>
          A−
        </button>
        <button type="button" data-font="1" title="Larger text" onClick={() => bumpFont(1)}>
          A+
        </button>
        <button type="button" className="pp-hide" title="Hide script" onClick={onHide}>
          ⟩
        </button>
      </div>
      <div className="pp-body" ref={bodyRef}>
        <div className="pp-title">{view?.title}</div>
        <div className="pp-key" hidden={!view?.key}>
          {view?.key}
        </div>
        {loadError ? (
          <div className="pp-script">
            <p className="pp-empty">Couldn't load the script: {loadError}</p>
          </div>
        ) : (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: renderScript escapes the notes
          <div className="pp-script" dangerouslySetInnerHTML={{ __html: view?.script ?? "" }} />
        )}
      </div>
      <div className="pp-caption" hidden={!caption.shown}>
        <div className={caption.mt ? "pp-cap-en mt" : "pp-cap-en"}>{caption.en}</div>
        <div className="pp-cap-meta">{caption.meta}</div>
      </div>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: the title is escaped */}
      <div className="pp-next" dangerouslySetInnerHTML={{ __html: view?.next ?? "" }} />
    </aside>
  );
}
