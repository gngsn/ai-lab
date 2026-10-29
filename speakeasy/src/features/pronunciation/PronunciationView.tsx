import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeckRow, NoteRow, SlideRow } from "../../data/types";
import { formatBytes, warmDeckAssets } from "../../lib/preload-assets";
import { fitSlideFrame } from "../../lib/slide-fit";
import { defaultTtsEngine } from "../training/config";
import { type TrainingHandle, TrainingPanel } from "../training/TrainingPanel";
import { cleanForSpeech } from "../training/text";
import { mergeBlobs, silenceWav } from "../training/wav";

export type Loaded = { deck: DeckRow; slides: SlideRow[]; notes: NoteRow[] };
type Props = {
  deckId: string;
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

export function PronunciationView({ deckId, loaded }: Props) {
  const data = "error" in loaded ? null : loaded;
  const slides = data?.slides;
  const deck = data?.deck;
  const [notesMap] = useState(
    () => new Map((data?.notes ?? []).map((n) => [n.section_id, n.content])),
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speed, setSpeed] = useState(1.0);
  const [speedLabel, setSpeedLabel] = useState("1.0×");
  const [scores, setScores] = useState<Record<number, { score: number; cls: string }>>({});
  const [exp, setExp] = useState({ busy: false, pct: 0, text: "" });
  const panel = useRef<TrainingHandle>(null);
  const [engine, setEngine] = useState<string>(defaultTtsEngine);
  const live = useRef({ slides, currentIndex });
  live.current = { ...live.current, slides, currentIndex };
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!data) return;
    if (iframeRef.current && stageRef.current) {
      fitSlideFrame(iframeRef.current, stageRef.current);
    }
    // The left resizer (#sec-resizer) is not wired: the section list replaces it. Only the
    // right one works.
    const stopRight = makeColResizer(trnResizerRef.current, {
      getWidth: (clientX) => window.innerWidth - clientX,
      setWidth: (w) => setCssVar("--training-width", w),
      minW: TRN_MIN,
      maxW: TRN_MAX,
    });
    // Pull every slide's images/video/audio into the browser cache now, so
    // later slides show without waiting on the network.
    const title = document.title;
    warmDeckAssets(data.deck, data.slides, {
      onProgress: ({ done, total, bytes }) => {
        document.title =
          done < total ? `(${done}/${total} · ${formatBytes(bytes)}) ${title}` : title;
      },
    }).catch(() => {});
    return () => {
      stopRight();
    };
  }, [data]);

  // The panel follows the selected slide (feedback reset, latest take and recording restored).
  const trainingSection = useMemo(() => {
    const slide = slides?.[currentIndex];
    if (!slide) return { sectionId: null, title: "", text: "" };
    return {
      sectionId: slide.section_id,
      title: slide.title || `Slide ${currentIndex + 1}`,
      text: notesMap.get(slide.section_id) || "",
    };
  }, [slides, currentIndex, notesMap]);

  const onScore = useCallback((sectionId: string, score: number, cls: string) => {
    const index = (live.current.slides ?? []).findIndex((s) => s.section_id === sectionId);
    if (index < 0) return;
    setScores((prev) => ({ ...prev, [index]: { score, cls } }));
  }, []);

  const selectSection = useCallback((index: number) => {
    setCurrentIndex(index);
    live.current.currentIndex = index;
  }, []);

  async function onExport() {
    const current = panel.current;
    if (!slides || !current) return;
    setExp({ busy: true, pct: 0, text: "" });
    const sil = silenceWav(1.5);
    const blobs: Blob[] = [];
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i] as SlideRow;
      const cleanText = cleanForSpeech(notesMap.get(slide.section_id) || "");
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
      const merged = await mergeBlobs(blobs);
      const url = URL.createObjectURL(merged);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${deckId}-${speed}x.wav`;
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
  const cleanText = slide ? cleanForSpeech(rawNotes) : "";
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
              setSpeed(value);
              setSpeedLabel(`${value.toFixed(2).replace(/\.?0+$/, "")}×`);
            }}
          />
          <span id="speed-label">{speedLabel}</span>
        </div>
        <select
          id="tts-engine"
          title="TTS Engine"
          value={engine}
          onChange={(e) => setEngine(e.target.value)}
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
                // biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only control by design
                // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only control by design
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
              <div id="training-mount">
                <TrainingPanel
                  ref={panel}
                  deckId={deckId}
                  section={trainingSection}
                  speed={speed}
                  engine={engine}
                  onScore={onScore}
                />
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
