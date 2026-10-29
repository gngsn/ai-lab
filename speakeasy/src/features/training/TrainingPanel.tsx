import { forwardRef, useImperativeHandle } from "react";
import { engineTag, fmtTime } from "./text";
import { type TrainingOptions, useTraining } from "./useTraining";

export type TrainingHandle = {
  /** The take for a section's notes (generated once, then reused) — for the deck export. */
  synthesize: (
    sectionId: string,
    title: string,
    text: string,
  ) => Promise<{ buf: ArrayBuffer; mime: string }>;
};

const SCORE_COLOR = { great: "var(--green)", ok: "var(--yellow)", poor: "var(--red)" } as const;
const SCORE_WORDS = { great: "Great job!", ok: "Keep practicing", poor: "Needs work" } as const;
const HIDDEN = { display: "none" } as const;

/**
 * The shared pronunciation training panel: Generate / Upload speech, Record and score, and the
 * take histories. The markup (ids, classes, the doubled #action-row / #stt-status) is what
 * training-panel.css and the page layouts style.
 */
export const TrainingPanel = forwardRef<TrainingHandle, TrainingOptions>(
  function TrainingPanel(props, ref) {
    const t = useTraining(props);
    useImperativeHandle(ref, () => ({ synthesize: t.synthesize }), [t.synthesize]);
    const statusClass = t.status.cls ? `stt-status ${t.status.cls}` : "stt-status";
    const fb = t.feedback;
    const color = fb ? SCORE_COLOR[fb.cls] : undefined;
    const ttsCount = t.tts.versions.length;
    const recCount = t.rec.versions.length;

    return (
      <div className="training-panel">
        <div id="action-row">
          <button
            type="button"
            className="btn"
            id="listen-btn"
            disabled={t.listen.busy}
            onClick={t.listen.run}
          >
            {t.listen.label}
          </button>
          <span id="stt-status" className={statusClass}>
            {t.status.text}
          </span>
          <button
            type="button"
            className="btn"
            id="save-btn"
            title="Upload the current take to Supabase (shared)"
            disabled={t.upload.busy}
            onClick={t.upload.run}
          >
            {t.upload.label}
          </button>
        </div>
        <div id="audio-row">
          {/* biome-ignore lint/a11y/useMediaCaption: a pronunciation model has no captions */}
          <audio
            id="section-audio"
            className={t.tts.src ? "show" : undefined}
            src={t.tts.src ?? undefined}
            controls
            ref={t.audioRef}
          />
          <select
            id="history-select"
            className="history-select"
            title="Saved takes (history)"
            style={ttsCount ? undefined : HIDDEN}
            value={t.tts.active ?? ""}
            onChange={(e) => t.onPickTake(Number(e.target.value))}
          >
            {t.tts.versions.map((v, i) => (
              <option key={v.ts} value={v.ts}>
                {`v${ttsCount - i} · ${fmtTime(v.ts)} · ${engineTag(v.engine)}`}
              </option>
            ))}
          </select>
        </div>
        <div id="action-row">
          <button
            type="button"
            className={t.recording ? "btn recording" : "btn"}
            id="record-btn"
            onClick={t.onRecordClick}
          >
            {t.recording ? "⏹ Stop" : "🎙 Record"}
          </button>
          <button
            type="button"
            className="btn ok"
            id="retry-btn"
            style={fb ? { display: "inline-flex" } : HIDDEN}
            onClick={t.onRetry}
          >
            ↺ Retry
          </button>
          <span id="stt-status" className="stt-status" />
        </div>
        <div id="rec-row">
          <div className="rec-head">
            <span className="rec-label">🎙 Your recording</span>
            <button
              type="button"
              className="btn"
              id="rec-save-btn"
              title="Save recordings to a folder (pick ~/.cleartalk once)"
              disabled={t.folder.busy}
              onClick={t.folder.run}
            >
              {t.folder.label}
            </button>
          </div>
          {/* biome-ignore lint/a11y/useMediaCaption: the user's own recording has no captions */}
          <audio
            id="rec-audio"
            className={t.rec.src ? "show" : undefined}
            src={t.rec.src ?? undefined}
            controls
            ref={t.recAudioRef}
          />
          <select
            id="rec-history-select"
            className="history-select"
            title="Saved recordings"
            style={recCount ? undefined : HIDDEN}
            value={t.rec.active ?? ""}
            onChange={(e) => t.onPickRecording(Number(e.target.value))}
          >
            {t.rec.versions.map((v, i) => (
              <option key={v.ts} value={v.ts}>
                {`take ${recCount - i} · ${fmtTime(v.ts)}`}
              </option>
            ))}
          </select>
        </div>
        <div id="feedback-area">
          <div id="feedback-hint" style={{ display: fb ? "none" : "block" }}>
            Press <kbd>▶ Listen</kbd> to hear a native-speaker model,
            <br />
            then <kbd>🎙 Record</kbd> and speak the script.
            <br />
            Your pronunciation will be scored word-by-word.
          </div>
          <div className="fb-block" id="fb-diff" style={{ display: fb ? "block" : "none" }}>
            <div className="fb-label">Word comparison</div>
            <div className="diff-text" id="diff-text">
              {fb?.diff.map(({ word, status }, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a diff is positional and never reordered
                <span key={i} className={status}>
                  {word}
                  {i < fb.diff.length - 1 ? " " : ""}
                </span>
              ))}
            </div>
          </div>
          <div className="fb-block" id="fb-score" style={{ display: fb ? "block" : "none" }}>
            <div className="fb-label">Score</div>
            <div id="score-display">
              <span id="score-big" style={{ color }}>
                {fb ? `${fb.score}%` : "—"}
              </span>
              <span id="score-meta">
                <span id="score-desc" style={{ color }}>
                  {fb ? SCORE_WORDS[fb.cls] : ""}
                </span>
              </span>
            </div>
          </div>
          <div className="fb-block" id="fb-transcript" style={{ display: fb ? "block" : "none" }}>
            <div className="fb-label">Transcript</div>
            <div id="transcript-raw">
              {fb ? (
                <>
                  Heard: <strong>{fb.transcript}</strong>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  },
);
