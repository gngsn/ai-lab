import { useEffect } from "react";
import type { DeckRow, SlideRow } from "../../data/types";
import { createCaptionEngine, speechSupported } from "./engine";

type Props = { deck: DeckRow; slides: SlideRow[]; room: string };
type CaptionWindow = Window & { __seCaptions?: { feed: (text: string, final: boolean) => void } };
const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};
const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"]/g, (character) => HTML_ESCAPES[character] ?? character);

export function CaptionConsole({ deck, slides, room }: Props) {
  useEffect(() => {
    const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
    const setDot = (id: string, ok: boolean | null) => {
      const el = byId(id);
      el.dataset.state = ok === null ? "wait" : ok ? "ok" : "bad";
    };
    const engine = createCaptionEngine({
      deckId: deck.deck_id,
      slides,
      room,
      onScript: ({ covered, lines, missing, unmatched }) => {
        byId("script-status").textContent =
          `${covered}/${slides.length} slides have lines · ${lines} lines` +
          (missing ? ` · ${missing} without English (machine-translated)` : "") +
          (unmatched.length ? ` · ⚠ no slide titled: ${unmatched.join(", ")}` : "");
        renderSlide();
      },
      onSlide: renderSlide,
      onSync: (state) => setDot("sync-dot", state),
      onHeard: (text, final) => {
        byId("heard").textContent = text;
        byId("heard").classList.toggle("final", final);
      },
      onSent: (payload, why) => {
        byId("sent").innerHTML =
          `<div class="en ${payload.mt ? "mt" : ""}">${escapeHtml(payload.en)}</div><div class="meta">${escapeHtml(payload.ko)} · ${escapeHtml(why)}</div>`;
        const item = document.createElement("li");
        item.textContent = `${new Date().toLocaleTimeString()}  ${payload.mt ? "[MT] " : ""}${payload.en}`;
        byId("log").prepend(item);
        while (byId("log").children.length > 30) byId("log").lastChild?.remove();
        renderSlide();
      },
      onListening: (on, message) => {
        byId<HTMLButtonElement>("mic").textContent = on ? "■ Stop captions" : "🎤 Start captions";
        byId("mic").classList.toggle("live", on);
        byId("mic-status").textContent = message;
      },
      onMtStatus: (text) => {
        byId("mt-status").textContent = text;
      },
      onChannel: (ok) => setDot("channel-dot", ok),
    });
    (window as CaptionWindow).__seCaptions = { feed: engine.feed };

    function renderSlide() {
      const index = engine.current;
      const slide = slides[index];
      byId("slide-title").textContent = slide
        ? `${index + 1}. ${slide.title || slide.section_id}`
        : "—";
      const lines = engine.linesOf(index);
      byId("lines").innerHTML = lines.length
        ? lines
            .map(
              (line, lineIndex) =>
                `<li data-line="${lineIndex}" class="${engine.lastKey === `${index}:${lineIndex}` ? "sent" : ""}"><span class="ko">${escapeHtml(line.ko)}</span><span class="en ${line.en === null ? "missing" : ""}">${escapeHtml(line.en ?? "(no English — machine translation)")}</span></li>`,
            )
            .join("")
        : `<li class="empty">${engine.hasScript ? "No script lines for this slide." : "Load a bilingual script to start."}</li>`;
    }

    byId<HTMLInputElement>("script-file").addEventListener("change", async (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const file = input.files?.[0];
      if (file) engine.loadScript(await file.text());
      input.value = "";
    });
    byId("lines").addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const line = target.closest<HTMLLIElement>("li[data-line]");
      if (line) engine.sendManual(Number(line.dataset.line));
    });
    byId("mic").addEventListener("click", () =>
      engine.listening ? engine.stop() : engine.start(),
    );
    if (!speechSupported()) {
      byId<HTMLButtonElement>("mic").disabled = true;
      byId("mic-status").textContent =
        "Speech recognition isn't supported here — use desktop Chrome.";
    }
    byId("deck-title").textContent = deck.title || deck.deck_id;
    byId("room").textContent = room;
    renderSlide();
    return () => {
      engine.stop();
      delete (window as CaptionWindow).__seCaptions;
    };
  }, [deck, room, slides]);

  return (
    <>
      <header>
        <h1>
          Live captions <span className="muted">ko → en</span>
        </h1>
        <span className="muted" id="deck-title" />
        <span className="muted">
          room <code id="room" />
        </span>
        <span className="dot" id="sync-dot">
          slide sync
        </span>
        <span className="dot" id="channel-dot">
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
                <input id="script-file" type="file" accept=".md,.markdown,text/markdown" />
              </label>
              <span className="hint">
                Script lines, each followed by <code>&gt; English</code>. Saved in this browser.
              </span>
            </div>
            <div className="status" id="script-status">
              No script loaded.
            </div>
          </section>
          <section>
            <h2>2 · Captions</h2>
            <div className="row">
              <button id="mic" type="button">
                🎤 Start captions
              </button>
              <span className="status" id="mic-status" style={{ margin: 0 }} />
            </div>
            <div className="status" id="mt-status" />
            <h2 style={{ marginTop: 16 }}>Heard</h2>
            <div id="heard" />
            <h2 style={{ marginTop: 16 }}>Sent to audience</h2>
            <div id="sent" />
            <ul id="log" />
          </section>
        </div>
        <section>
          <h2>Current slide · click a line to send it</h2>
          <div id="slide-title">—</div>
          <ul id="lines" />
        </section>
      </main>
    </>
  );
}
