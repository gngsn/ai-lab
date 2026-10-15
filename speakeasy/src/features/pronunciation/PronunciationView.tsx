import { useCallback, useEffect, useRef, useState } from "react";
import type { DeckRow, NoteRow, SlideRow } from "../../data/types";
import type { PronunciationRuntime, TrainingPanel } from "../../lib/legacy-runtime";

export type Loaded = { deck: DeckRow; slides: SlideRow[]; notes: NoteRow[] };
type Props = {
  deckId: string;
  runtime: PronunciationRuntime;
  loaded: Loaded | { error: string };
};

const TRN_MIN = 240;
const TRN_MAX = 560;

function setCssVar(name: string, px: number) {
  document.documentElement.style.setProperty(name, `${px}px`);
}

function makeColResizer(
  handle: HTMLElement | null,
  {
    getWidth,
    setWidth,
    minW,
    maxW,
  }: {
    getWidth: (clientX: number) => number;
    setWidth: (w: number) => void;
    minW: number;
    maxW: number;
  },
) {
  if (!handle) return () => {};
  let dragging = false;
  let onMove: ((e: PointerEvent) => void) | null = null;
  let onUp: (() => void) | null = null;

  function finish() {
    if (!dragging || !handle) return;
    dragging = false;
    handle.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (onMove) document.removeEventListener("pointermove", onMove);
    if (onUp) document.removeEventListener("pointerup", onUp);
    onMove = onUp = null;
  }
  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    dragging = true;
    handle.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    handle.setPointerCapture?.(e.pointerId);
    onMove = (ev) => {
      if (dragging) setWidth(Math.min(maxW, Math.max(minW, getWidth(ev.clientX))));
    };
    onUp = () => finish();
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp, { once: true });
  };
  handle.addEventListener("pointerdown", onDown);
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
  window.addEventListener("blur", finish);
  return () => {
    finish();
    handle.removeEventListener("pointerdown", onDown);
    handle.removeEventListener("pointerup", finish);
    handle.removeEventListener("pointercancel", finish);
    handle.removeEventListener("lostpointercapture", finish);
    window.removeEventListener("blur", finish);
  };
}

export function PronunciationView({ deckId, runtime, loaded }: Props) {
  const data = "error" in loaded ? null : loaded;
  const slides = data?.slides;
  const deck = data?.deck;
  const [notesMap] = useState(
    () => new Map((data?.notes ?? []).map((n) => [n.section_id, n.content])),
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speedLabel, setSpeedLabel] = useState("1.0×");
  const [scores, setScores] = useState<Record<number, { score: number; cls: string }>>({});
  const [exp, setExp] = useState({ busy: false, pct: 0, text: "" });
  const panel = useRef<TrainingPanel | null>(null);
  const live = useRef({ slides, currentIndex, speed: 1.0 });
  live.current = { ...live.current, slides, currentIndex };
  const mountRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<HTMLSelectElement>(null);
  const trnResizerRef = useRef<HTMLDivElement>(null);

  const titleOf = (i: number) => slides?.[i]?.title || `Slide ${i + 1}`;

  // The slide preview (edit-frame.html) asks for its deck + slide; answer from
  // memory so switching slides doesn't refetch them from Supabase.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const m = e.data;
      if (m?.type !== "edit-frame:request-data" || !deck || !slides) return;
      const slide = slides.find((s) => s.section_id === m.sectionId);
      if (!slide) return;
      (e.source as Window | null)?.postMessage(
        { type: "edit-frame:data", id: m.id, deck, slide },
        "*",
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [deck, slides]);

  useEffect(() => {
    if (!deck) return;
    document.title = `Pronunciation · ${deck.title || deckId}`;
  }, [deck, deckId]);

  // Mount the shared training panel, the slide fit and the resizers.
  useEffect(() => {
    if (!data || !mountRef.current) return;
    if (iframeRef.current && stageRef.current) {
      // Render the preview at the fixed slide size and scale it as a whole.
      runtime.fitSlideFrame(iframeRef.current, stageRef.current);
    }
    const created = runtime.createTrainingPanel(mountRef.current, {
      deckId,
      getSection: () => {
        const { slides: list, currentIndex: index } = live.current;
        const slide = list?.[index];
        if (!slide) return { sectionId: null, title: "", text: "" };
        return {
          sectionId: slide.section_id,
          title: slide.title || `Slide ${index + 1}`,
          text: notesMap.get(slide.section_id) || "",
        };
      },
      onScore: (sectionId, score, cls) => {
        const index = (live.current.slides ?? []).findIndex((s) => s.section_id === sectionId);
        if (index < 0) return;
        setScores((prev) => ({ ...prev, [index]: { score, cls } }));
      },
    });
    panel.current = created;
    if (engineRef.current) engineRef.current.value = created.getEngine();
    // Hand the first section over once the panel exists.
    const first = data.slides[0];
    if (first) {
      created.setSection({
        sectionId: first.section_id,
        title: first.title || "Slide 1",
        text: notesMap.get(first.section_id) || "",
      });
    }
    // Left resizer (#sec-resizer) is dead in the legacy page too: the section
    // list used to wipe it. Only the right one works, and only it is wired.
    const stopRight = makeColResizer(trnResizerRef.current, {
      getWidth: (clientX) => window.innerWidth - clientX,
      setWidth: (w) => setCssVar("--training-width", w),
      minW: TRN_MIN,
      maxW: TRN_MAX,
    });
    // Pull every slide's images/video/audio into the browser cache now, so
    // later slides show without waiting on the network.
    const title = document.title;
    runtime
      .warmDeckAssets(data.deck, data.slides, {
        onProgress: ({ done, total, bytes }) => {
          document.title =
            done < total ? `(${done}/${total} · ${runtime.formatBytes(bytes)}) ${title}` : title;
        },
      })
      .catch(() => {});
    return () => {
      stopRight();
      created.destroy();
      panel.current = null;
    };
  }, [data, deckId, runtime, notesMap]);

  const selectSection = useCallback(
    (index: number) => {
      setCurrentIndex(index);
      live.current.currentIndex = index;
      const slide = live.current.slides?.[index];
      if (!slide) return;
      // Hand the current section to the training panel (resets feedback,
      // restores latest take + recording, re-binds scoring).
      panel.current?.setSection({
        sectionId: slide.section_id,
        title: slide.title || `Slide ${index + 1}`,
        text: notesMap.get(slide.section_id) || "",
      });
    },
    [notesMap],
  );

  async function onExport() {
    if (!slides || !panel.current) return;
    const current = panel.current;
    setExp({ busy: true, pct: 0, text: "" });
    const sil = runtime.silenceWav(1.5);
    const blobs: Blob[] = [];
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i] as SlideRow;
      const cleanText = runtime.cleanForSpeech(notesMap.get(slide.section_id) || "");
      if (!cleanText) continue;
      setExp({
        busy: true,
        pct: Math.round((i / slides.length) * 100),
        text: `${i + 1}/${slides.length}…`,
      });
      try {
        const { buf, mime } = await current.synthesize(
          slide.section_id,
          slide.title || `Slide ${i + 1}`,
          notesMap.get(slide.section_id) || "",
        );
        blobs.push(new Blob([buf], { type: mime || "audio/mpeg" }));
        if (i < slides.length - 1) blobs.push(sil);
      } catch (err) {
        setExp({ busy: false, pct: 0, text: `Error: ${(err as Error).message}` });
        return;
      }
      setExp({
        busy: true,
        pct: Math.round(((i + 1) / slides.length) * 100),
        text: `${i + 1}/${slides.length}…`,
      });
    }
    setExp((prev) => ({ ...prev, text: "Merging…" }));
    let text: string;
    try {
      const merged = await runtime.mergeBlobs(blobs);
      const url = URL.createObjectURL(merged);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${deckId}-${live.current.speed}x.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      text = "✓ Done";
    } catch (err) {
      text = `Merge error: ${(err as Error).message}`;
    }
    setExp((prev) => ({ busy: false, pct: prev.pct, text }));
  }

  const slide = slides?.[currentIndex];
  const rawNotes = slide ? notesMap.get(slide.section_id) || "" : "";
  const cleanText = slide ? runtime.cleanForSpeech(rawNotes) : "";
  const q = encodeURIComponent(deckId);
  return (
    <div id="app">
      <header id="toolbar">
        <a className="btn home" href="./index.html" title="Home">
          🏠
        </a>
        <span className="title" id="deck-title">
          {deck ? deck.title || deckId : "…"}
        </span>
        <span className="spacer" />
        <div className="speed-wrap">
          <span>Speed</span>
          <input
            type="range"
            id="speed-slider"
            min="0.7"
            max="1.5"
            step="0.05"
            defaultValue="1.0"
            onInput={(e) => {
              const value = Number.parseFloat((e.target as HTMLInputElement).value);
              live.current.speed = value;
              setSpeedLabel(`${value.toFixed(2).replace(/\.?0+$/, "")}×`);
              panel.current?.setSpeed(value);
            }}
          />
          <span id="speed-label">{speedLabel}</span>
        </div>
        <select
          id="tts-engine"
          title="TTS Engine"
          ref={engineRef}
          onChange={(e) => panel.current?.setEngine(e.target.value)}
        >
          <option value="kokoro">🏠 Local (Kokoro)</option>
          <option value="openai">☁️ OpenAI</option>
          <option value="elevenlabs">🎤 ElevenLabs</option>
        </select>
        <button
          type="button"
          className="btn primary"
          id="export-btn"
          disabled={exp.busy}
          onClick={() => void onExport()}
        >
          ⬇ Export
        </button>
        <div id="export-progress" style={{ display: exp.busy ? "block" : "none" }}>
          <div id="export-progress-bar" style={{ width: `${exp.pct}%` }} />
        </div>
        <span id="export-status">{exp.text}</span>
        <a className="btn" id="notes-link" href={`./notes.html?deck=${q}`}>
          📝 Notes
        </a>
      </header>

      <main id="main-grid">
        {!data ? (
          <p style={{ color: "var(--se-bad, #b42318)", padding: "2rem", fontFamily: "monospace" }}>
            {(loaded as { error: string }).error}
          </p>
        ) : (
          <>
            <aside id="section-list">
              {data.slides.map((s, i) => (
                // biome-ignore lint/a11y/useKeyWithClickEvents: preserved legacy markup
                // biome-ignore lint/a11y/noStaticElementInteractions: preserved legacy markup
                <div
                  key={s.section_id}
                  className={`sec-item${i === currentIndex ? " active" : ""}`}
                  data-i={i}
                  onClick={() => selectSection(i)}
                >
                  <span className="num">{i + 1}</span>
                  <span className="label">{s.title || `Slide ${i + 1}`}</span>
                  <span
                    className={scores[i] ? `sec-score show ${scores[i].cls}` : "sec-score"}
                    id={`sec-score-${i}`}
                  >
                    {scores[i] ? `${scores[i].score}%` : ""}
                  </span>
                </div>
              ))}
            </aside>
            <section id="script-pane">
              <div id="script-heading">
                <span className="slide-title" id="script-title">
                  {titleOf(currentIndex)}
                </span>
                <span className="slide-num" id="script-num">
                  {`#${currentIndex + 1} / ${data.slides.length}`}
                </span>
              </div>
              <div id="slide-preview-wrap">
                <div id="slide-stage" ref={stageRef}>
                  <iframe
                    id="slide-iframe"
                    ref={iframeRef}
                    title="Slide preview"
                    sandbox="allow-scripts allow-same-origin"
                    src={
                      slide
                        ? `./edit-frame.html?deck=${q}&section=${encodeURIComponent(slide.section_id)}`
                        : undefined
                    }
                  />
                </div>
              </div>
              <div id="script-body" className={cleanText ? undefined : "empty"}>
                {cleanText || "(no notes for this slide)"}
              </div>
            </section>
            <section id="training-panel">
              <div
                id="trn-resizer"
                className="col-resizer"
                aria-hidden="true"
                ref={trnResizerRef}
              />
              <div id="training-mount" ref={mountRef} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
