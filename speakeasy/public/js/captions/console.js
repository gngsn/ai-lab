// Live captions — presenter console (captions.html): the full UI around the
// caption engine (engine.js). The current slide comes from the deck's live
// sync room (present.html).
import { createSlideSync } from "../sync.js";
import { createCaptionEngine, speechSupported } from "./engine.js";

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

export function mountCaptionConsole({ deck, slides, room }) {
  const $ = (id) => document.getElementById(id);
  const setDot = (id, ok) => {
    const el = $(id);
    if (el) el.dataset.state = ok === null ? "wait" : ok ? "ok" : "bad";
  };

  const engine = createCaptionEngine({
    deckId: deck.deck_id,
    slides,
    room,
    onScript: ({ covered, lines, missing, unmatched }) => {
      $("script-status").textContent =
        `${covered}/${slides.length} slides have lines · ${lines} lines` +
        (missing ? ` · ${missing} without English (machine-translated)` : "") +
        (unmatched.length ? ` · ⚠ no slide titled: ${unmatched.join(", ")}` : "");
      renderSlide();
    },
    onSlide: () => {
      renderSlide();
      setDot("sync-dot", true);
    },
    onHeard: (text, final) => {
      $("heard").textContent = text;
      $("heard").classList.toggle("final", final);
    },
    onSent: (payload, why) => {
      $("sent").innerHTML =
        `<div class="en ${payload.mt ? "mt" : ""}">${esc(payload.en)}</div>` +
        `<div class="meta">${esc(payload.ko)} · ${esc(why)}</div>`;
      const li = document.createElement("li");
      li.textContent = `${new Date().toLocaleTimeString()}  ${payload.mt ? "[MT] " : ""}${payload.en}`;
      $("log").prepend(li);
      while ($("log").children.length > 30) $("log").lastChild.remove();
      renderSlide();
    },
    onListening: (on, msg) => {
      $("mic").textContent = on ? "■ Stop captions" : "🎤 Start captions";
      $("mic").classList.toggle("live", on);
      $("mic-status").textContent = msg;
    },
    onMtStatus: (text) => ($("mt-status").textContent = text),
    onChannel: (ok) => setDot("channel-dot", ok),
  });
  // Exposed for testing without a microphone.
  window.__seCaptions = { feed: engine.feed };

  function renderSlide() {
    const i = engine.current;
    const s = slides[i];
    $("slide-title").textContent = s ? `${i + 1}. ${s.title || s.section_id}` : "—";
    const lines = engine.linesOf(i);
    $("lines").innerHTML = lines.length
      ? lines
          .map(
            (l, n) =>
              `<li data-line="${n}" class="${engine.lastKey === `${i}:${n}` ? "sent" : ""}">` +
              `<span class="ko">${esc(l.ko)}</span>` +
              `<span class="en ${l.en === null ? "missing" : ""}">${esc(l.en ?? "(no English — machine translation)")}</span></li>`,
          )
          .join("")
      : `<li class="empty">${engine.hasScript ? "No script lines for this slide." : "Load a bilingual script to start."}</li>`;
  }

  $("script-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (file) engine.loadScript(await file.text());
    e.target.value = "";
  });
  // Click a line to send it now (presenter override).
  $("lines").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-line]");
    if (li) engine.sendManual(Number(li.dataset.line));
  });
  $("mic").addEventListener("click", () =>
    engine.listening ? engine.stop() : engine.start(),
  );
  if (!speechSupported()) {
    $("mic").disabled = true;
    $("mic-status").textContent =
      "Speech recognition isn't supported here — use desktop Chrome.";
  }

  const slideSync = createSlideSync(
    room,
    ({ section_id, index } = {}) => engine.setSlide(section_id, index),
    (state) => {
      if (state === "SUBSCRIBED") slideSync?.requestState();
      setDot("sync-dot", state === "SUBSCRIBED" ? null : false);
    },
  );

  $("deck-title").textContent = deck.title || deck.deck_id;
  $("room").textContent = room;
  renderSlide();
}
