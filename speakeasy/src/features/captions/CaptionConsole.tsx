import { useEffect, useRef, useState } from "react";
import type { DeckRow, SlideRow } from "../../data/types";
import { createCaptionEngine, speechSupported } from "./engine";

type Props = { deck: DeckRow; slides: SlideRow[]; room: string };
type Engine = ReturnType<typeof createCaptionEngine>;
type CaptionWindow = Window & { __seCaptions?: { feed: (text: string, final: boolean) => void } };
type Dot = "wait" | "ok" | "bad" | undefined;
type Sent = { en: string; ko: string; mt: boolean; why: string };

const MAX_LOG = 30;
const dotState = (ok: boolean | null): Dot => (ok === null ? "wait" : ok ? "ok" : "bad");

/** Everything the console shows, driven by the caption engine's callbacks. */
function useCaptionConsole({ deck, slides, room }: Props) {
  const engineRef = useRef<Engine | null>(null);
  // The engine keeps the script and the current slide itself; this only makes the view redraw.
  const [, redraw] = useState(0);
  const [scriptStatus, setScriptStatus] = useState("No script loaded.");
  const [heard, setHeard] = useState({ text: "", final: false });
  const [sent, setSent] = useState<Sent | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const supported = speechSupported();
  const [mic, setMic] = useState({
    listening: false,
    status: supported ? "" : "Speech recognition isn't supported here — use desktop Chrome.",
  });
  const [mtStatus, setMtStatus] = useState("");
  const [syncDot, setSyncDot] = useState<Dot>();
  const [channelDot, setChannelDot] = useState<Dot>();

  useEffect(() => {
    const again = () => redraw((n) => n + 1);
    const engine = createCaptionEngine({
      deckId: deck.deck_id,
      slides,
      room,
      onScript: ({ covered, lines, missing, unmatched }) => {
        setScriptStatus(
          `${covered}/${slides.length} slides have lines · ${lines} lines` +
            (missing ? ` · ${missing} without English (machine-translated)` : "") +
            (unmatched.length ? ` · ⚠ no slide titled: ${unmatched.join(", ")}` : ""),
        );
        again();
      },
      onSlide: again,
      onSync: (state) => setSyncDot(dotState(state)),
      onHeard: (text, final) => setHeard({ text, final }),
      onSent: (payload, why) => {
        setSent({ ...payload, why });
        const time = new Date().toLocaleTimeString();
        setLog((items) =>
          [`${time}  ${payload.mt ? "[MT] " : ""}${payload.en}`, ...items].slice(0, MAX_LOG),
        );
        again();
      },
      onListening: (listening, status) => setMic({ listening, status }),
      onMtStatus: setMtStatus,
      onChannel: (ok) => setChannelDot(dotState(ok)),
    });
    engineRef.current = engine;
    (window as CaptionWindow).__seCaptions = { feed: engine.feed };
    again();
    return () => {
      engine.stop();
      engineRef.current = null;
      delete (window as CaptionWindow).__seCaptions;
    };
  }, [deck, room, slides]);

  const engine = engineRef.current;
  const index = engine?.current ?? 0;
  const slide = slides[index];
  return {
    supported,
    scriptStatus,
    heard,
    sent,
    log,
    mic,
    mtStatus,
    syncDot,
    channelDot,
    slideTitle: slide ? `${index + 1}. ${slide.title || slide.section_id}` : "—",
    // a script line is identified by its position in the slide's script (data-line)
    lines: (engine?.linesOf(index) ?? []).map((line, position) => ({
      ...line,
      index: position,
      id: `${position}-${line.ko}`,
      sent: engine?.lastKey === `${index}:${position}`,
    })),
    hasScript: engine?.hasScript ?? false,
    loadScript: (markdown: string) => engine?.loadScript(markdown),
    sendLine: (line: number) => engine?.sendManual(line),
    toggleMic: () => (engine?.listening ? engine.stop() : engine?.start()),
  };
}

export function CaptionConsole(props: Props) {
  const { deck, room } = props;
  const c = useCaptionConsole(props);
  return (
    <>
      <header>
        <h1>
          Live captions <span className="muted">ko → en</span>
        </h1>
        <span className="muted" id="deck-title">
          {deck.title || deck.deck_id}
        </span>
        <span className="muted">
          room <code id="room">{room}</code>
        </span>
        <span className="dot" id="sync-dot" data-state={c.syncDot}>
          slide sync
        </span>
        <span className="dot" id="channel-dot" data-state={c.channelDot}>
          caption channel
        </span>
      </header>
      <main>
        <div style={{ display: "grid", gap: 20, alignContent: "start" }}>
          <section>
            <h2>1 · Bilingual script</h2>
            <div className="row">
              <label className="file-btn">
                Load .md
                <input
                  id="script-file"
                  type="file"
                  accept=".md,.markdown,text/markdown"
                  onChange={async (event) => {
                    const input = event.currentTarget;
                    const file = input.files?.[0];
                    if (file) c.loadScript(await file.text());
                    input.value = "";
                  }}
                />
              </label>
              <span className="hint">
                Script lines, each followed by <code>&gt; English</code>. Saved in this browser.
              </span>
            </div>
            <div className="status" id="script-status">
              {c.scriptStatus}
            </div>
          </section>
          <section>
            <h2>2 · Captions</h2>
            <div className="row">
              <button
                id="mic"
                type="button"
                className={c.mic.listening ? "live" : undefined}
                disabled={!c.supported}
                onClick={c.toggleMic}
              >
                {c.mic.listening ? "■ Stop captions" : "🎤 Start captions"}
              </button>
              <span className="status" id="mic-status" style={{ margin: 0 }}>
                {c.mic.status}
              </span>
            </div>
            <div className="status" id="mt-status">
              {c.mtStatus}
            </div>
            <h2 style={{ marginTop: 16 }}>Heard</h2>
            <div id="heard" className={c.heard.final ? "final" : undefined}>
              {c.heard.text}
            </div>
            <h2 style={{ marginTop: 16 }}>Sent to audience</h2>
            <div id="sent">
              {c.sent && (
                <>
                  <div className={c.sent.mt ? "en mt" : "en"}>{c.sent.en}</div>
                  <div className="meta">
                    {c.sent.ko} · {c.sent.why}
                  </div>
                </>
              )}
            </div>
            <ul id="log">
              {c.log.map((entry, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: an append-only log of plain strings
                <li key={i}>{entry}</li>
              ))}
            </ul>
          </section>
        </div>
        <section>
          <h2>Current slide · click a line to send it</h2>
          <div id="slide-title">{c.slideTitle}</div>
          <ul id="lines">
            {c.lines.length ? (
              c.lines.map((line) => (
                // biome-ignore lint/a11y/useKeyWithClickEvents: preserved console markup
                // biome-ignore lint/a11y/noNoninteractiveElementInteractions: preserved console markup
                <li
                  key={line.id}
                  data-line={line.index}
                  className={line.sent ? "sent" : ""}
                  onClick={() => c.sendLine(line.index)}
                >
                  <span className="ko">{line.ko}</span>
                  <span className={line.en === null ? "en missing" : "en"}>
                    {line.en ?? "(no English — machine translation)"}
                  </span>
                </li>
              ))
            ) : (
              <li className="empty">
                {c.hasScript
                  ? "No script lines for this slide."
                  : "Load a bilingual script to start."}
              </li>
            )}
          </ul>
        </section>
      </main>
    </>
  );
}
