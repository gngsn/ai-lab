// Presenter view side panel for present.html (mounted by js/letterbox.js via
// data-panel). Shows the current slide's key message and script, the next
// slide, and an elapsed timer. The slide frame reports each slide / step
// change with a "se:slide" postMessage (js/present-bootstrap.js).
import { getDeck } from "./repo/deck-repo.js";
import { listByDeck as listNotes } from "./repo/notes-repo.js";
import { listByDeck as listSlides } from "./repo/slide-repo.js";
import { isSlideHiddenContent } from "./slide-visibility.js";
import { syncRoomFor } from "./sync-room.js";

const FONT_KEY = "speakeasy:present:fontsize";
const WIDTH_KEY = "speakeasy:present:panel-width";
const HIDDEN_KEY = "speakeasy:present:panel-hidden";

const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

// A click cue in the script: "(클릭)", "(click)", "(클릭 — …)".
const CLICK_CUE = /^\((클릭|click)(?![a-z])/i;

/** Script text → HTML: paragraphs, **bold**, `code`, dimmed cues / memos.
 *  Click cues are numbered so they can follow the slide's fragments. */
function renderScript(text) {
  let cue = 0;
  return String(text || "")
    .trim()
    .split(/\n\s*\n/)
    .map((para) => {
      const lines = para.split("\n").map((raw) => {
        const line = raw.trim();
        const html = esc(line)
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/`([^`]+)`/g, "<code>$1</code>");
        if (/^\(.*\)$/.test(line)) {
          const n = CLICK_CUE.test(line) ? ` data-cue="${cue++}"` : "";
          return `<span class="cue"${n}>${html}</span>`;
        }
        if (/^\/\*.*\*\/$/.test(line)) return `<span class="memo">${html}</span>`;
        return html;
      });
      return `<p>${lines.join("<br>")}</p>`;
    })
    .join("");
}

const CSS = `
#__se_panel {
  --pp-bg: #151516; --pp-fg: #ececec; --pp-muted: #8d8d92; --pp-rule: #2a2a2d;
  --pp-accent: #ff8d70;
  position: relative; display: flex; flex-direction: column;
  background: var(--pp-bg); color: var(--pp-fg);
  border-left: 1px solid var(--pp-rule);
  font: 15px/1.6 "Pretendard", "IBM Plex Sans KR", system-ui, sans-serif;
}
#__se_presenter.panel-hidden #__se_panel { border: 0; }
.pp-resize {
  position: absolute; left: -4px; top: 0; bottom: 0; width: 8px;
  cursor: col-resize; z-index: 2;
}
.pp-bar {
  display: flex; align-items: center; gap: 8px; padding: 10px 14px;
  border-bottom: 1px solid var(--pp-rule); flex: 0 0 auto;
  font: 12px ui-monospace, monospace; color: var(--pp-muted);
}
.pp-bar .pp-count { color: var(--pp-fg); font-weight: 600; }
.pp-bar .pp-spacer { flex: 1; }
.pp-bar button {
  font: inherit; color: var(--pp-fg); background: transparent; cursor: pointer;
  border: 1px solid var(--pp-rule); border-radius: 6px; padding: 3px 8px;
}
.pp-bar button:hover { border-color: var(--pp-muted); }
.pp-timer { font-variant-numeric: tabular-nums; }
.pp-body { flex: 1 1 auto; overflow-y: auto; padding: 16px 18px 24px; }
.pp-title { font-size: .8em; color: var(--pp-muted); letter-spacing: .04em; margin-bottom: 10px; }
.pp-key {
  border-left: 3px solid var(--pp-accent); padding: 6px 10px; margin: 0 0 16px;
  background: rgba(255,141,112,.08); white-space: pre-wrap;
}
.pp-key::before {
  content: "KEY MESSAGE"; display: block; font: 10px ui-monospace, monospace;
  letter-spacing: .08em; color: var(--pp-accent); margin-bottom: 2px;
}
.pp-script p { margin: 0 0 .9em; }
.pp-script .cue { color: var(--pp-muted); font-size: .85em; }
.pp-script .cue.done { opacity: .45; }
.pp-script .cue.next { color: var(--pp-accent); font-weight: 600; }
.pp-script .memo { color: var(--pp-muted); font-size: .8em; opacity: .7; }
.pp-script code { font-size: .9em; }
.pp-empty { color: var(--pp-muted); font-style: italic; }
.pp-bar .pp-cc[data-state="ready"] { color: var(--pp-fg); }
.pp-bar .pp-cc[data-state="live"] { color: #fff; background: #d14b3a; border-color: #d14b3a; }
.pp-bar .pp-cc[data-state="none"] { color: var(--pp-muted); }
.pp-caption {
  flex: 0 0 auto; padding: 8px 14px; border-top: 1px solid var(--pp-rule);
  font-size: 13px; line-height: 1.45;
}
.pp-caption .pp-cap-en { color: var(--pp-fg); }
.pp-caption .pp-cap-en.mt { font-style: italic; color: var(--pp-muted); }
.pp-caption .pp-cap-meta { font: 11px ui-monospace, monospace; color: var(--pp-muted); margin-top: 2px; }
.pp-next {
  flex: 0 0 auto; padding: 10px 14px; border-top: 1px solid var(--pp-rule);
  font-size: 13px; color: var(--pp-muted);
}
.pp-next b { color: var(--pp-fg); font-weight: 500; }
.pp-show {
  position: absolute; top: 10px; right: 10px; z-index: 5; display: none;
  font: 12px ui-monospace, monospace; color: #f0f0f0; cursor: pointer;
  background: rgba(20,20,20,.8); border: 1px solid rgba(255,255,255,.18);
  border-radius: 6px; padding: 5px 10px;
}
#__se_presenter.panel-hidden .pp-show { display: block; }
`;

/** Current slide + shown fragments, read from the slide frame's DOM. */
function readFrame(frame) {
  try {
    const w = frame.contentWindow;
    const doc = w?.document;
    if (!doc?.querySelector("[data-section-id]")) return null; // still loading
    const ctl = w.__seDeckController;
    const slides = ctl?.slides || [...doc.querySelectorAll("section.slide")];
    const index = Number.isInteger(ctl?.currentSlide)
      ? ctl.currentSlide
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

export async function mountPresenterPanel({ panel, frame, layout, fit }) {
  const params = new URLSearchParams(location.search);
  const deckId =
    params.get("deck") || location.pathname.match(/\/present\/([^/?]+)/)?.[1];
  if (!deckId) return;

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  panel.innerHTML = `
    <div class="pp-resize" title="Drag to resize"></div>
    <div class="pp-bar">
      <span class="pp-count">– / –</span>
      <span class="pp-spacer"></span>
      <button type="button" class="pp-cc" hidden>CC</button>
      <input type="file" class="pp-cc-file" accept=".md,.markdown,text/markdown" hidden />
      <button type="button" class="pp-timer" title="Elapsed — click to reset">0:00</button>
      <button type="button" data-font="-1" title="Smaller text">A−</button>
      <button type="button" data-font="1" title="Larger text">A+</button>
      <button type="button" class="pp-hide" title="Hide script">⟩</button>
    </div>
    <div class="pp-body">
      <div class="pp-title"></div>
      <div class="pp-key" hidden></div>
      <div class="pp-script"></div>
    </div>
    <div class="pp-caption" hidden>
      <div class="pp-cap-en"></div>
      <div class="pp-cap-meta"></div>
    </div>
    <div class="pp-next"></div>`;
  const $ = (sel) => panel.querySelector(sel);
  const showBtn = document.createElement("button");
  showBtn.type = "button";
  showBtn.className = "pp-show";
  showBtn.textContent = "⟨ Script";
  layout.querySelector("#__se_stage").append(showBtn);

  // ── Panel size / visibility / font ───────────────────────────────────
  const setHidden = (hidden) => {
    layout.classList.toggle("panel-hidden", hidden);
    store.set(HIDDEN_KEY, hidden ? "1" : "0");
    fit();
  };
  $(".pp-hide").addEventListener("click", () => setHidden(true));
  showBtn.addEventListener("click", () => setHidden(false));
  setHidden(store.get(HIDDEN_KEY) === "1");

  const width = Number(store.get(WIDTH_KEY));
  if (width > 15 && width < 80) layout.style.setProperty("--se-panel-w", `${width}%`);
  $(".pp-resize").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const move = (ev) => {
      const pct = ((window.innerWidth - ev.clientX) / window.innerWidth) * 100;
      const clamped = Math.min(70, Math.max(20, pct));
      layout.style.setProperty("--se-panel-w", `${clamped}%`);
      store.set(WIDTH_KEY, clamped.toFixed(1));
      fit();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      frame.style.pointerEvents = "";
    };
    frame.style.pointerEvents = "none"; // keep receiving moves over the slide
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  let fontSize = Number(store.get(FONT_KEY)) || 15;
  const applyFont = () => {
    panel.style.fontSize = `${fontSize}px`;
    store.set(FONT_KEY, String(fontSize));
  };
  panel.querySelectorAll("[data-font]").forEach((btn) =>
    btn.addEventListener("click", () => {
      fontSize = Math.min(30, Math.max(11, fontSize + Number(btn.dataset.font) * 1.5));
      applyFont();
    }),
  );
  applyFont();

  // ── Timer ────────────────────────────────────────────────────────────
  let startedAt = Date.now();
  const tick = () => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    const h = Math.floor(s / 3600);
    const mm = String(Math.floor((s % 3600) / 60));
    const ss = String(s % 60).padStart(2, "0");
    $(".pp-timer").textContent = h ? `${h}:${mm.padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
  };
  $(".pp-timer").addEventListener("click", () => {
    startedAt = Date.now();
    tick();
  });
  setInterval(tick, 1000);
  tick();

  // ── Script data ──────────────────────────────────────────────────────
  let slides = [];
  let allSlides = [];
  const notesById = new Map();
  try {
    let deck, notes;
    [deck, allSlides, notes] = await Promise.all([
      getDeck(deckId),
      listSlides(deckId),
      listNotes(deckId),
    ]);
    slides = allSlides.filter((s) => !isSlideHiddenContent(s.content));
    for (const n of notes) notesById.set(n.section_id, n);
    if (deck?.title) panel.dataset.deckTitle = deck.title;
  } catch (err) {
    $(".pp-script").innerHTML = `<p class="pp-empty">Couldn't load the script: ${esc(err.message)}</p>`;
    return;
  }

  let current = { index: 0, section_id: slides[0]?.section_id, fragments: [] };
  function render() {
    let i = slides.findIndex((s) => s.section_id === current.section_id);
    if (i < 0 && Number.isInteger(current.index)) i = current.index;
    const slide = slides[i];
    const note = slide ? notesById.get(slide.section_id) : null;
    $(".pp-count").textContent = `${i + 1} / ${slides.length}`;
    $(".pp-title").textContent = slide?.title || "";
    const key = (note?.key_message || "").trim();
    $(".pp-key").hidden = !key;
    $(".pp-key").textContent = key;
    const text = (note?.content || "").trim();
    $(".pp-script").innerHTML = text
      ? renderScript(text)
      : '<p class="pp-empty">No script for this slide.</p>';
    // Click cues follow the slide's fragments: passed ones dim, the next one
    // is highlighted.
    const shown = (current.fragments || []).length;
    panel.querySelectorAll(".cue[data-cue]").forEach((el) => {
      const n = Number(el.dataset.cue);
      el.classList.toggle("done", n < shown);
      el.classList.toggle("next", n === shown);
    });
    const next = slides[i + 1];
    $(".pp-next").innerHTML = next
      ? `Next · <b>${esc(next.title || `Slide ${i + 2}`)}</b>`
      : "Last slide";
  }
  const captions = await mountCaptions({ panel, deckId, slides: allSlides });
  let lastSlide = null;
  let lastKey = "";
  const follow = (state) => {
    const key = `${state.section_id}|${(state.fragments || []).join(",")}`;
    if (key === lastKey) return;
    lastKey = key;
    const changed = state.section_id !== lastSlide;
    lastSlide = state.section_id;
    current = state;
    captions?.setSlide(state.section_id, state.index);
    render();
    if (changed) $(".pp-body").scrollTop = 0;
  };
  // The frame reports each change ("se:slide", js/present-bootstrap.js)…
  window.addEventListener("message", (e) => {
    if (e.source === frame.contentWindow && e.data?.type === "se:slide") follow(e.data);
  });
  // …and the panel also reads the frame directly, so it keeps following even
  // if those messages don't arrive (e.g. a cached older bootstrap).
  setInterval(() => {
    const state = readFrame(frame);
    if (state) follow(state);
  }, 300);
  render();
}

// Live captions (optional, js/captions/): a CC button that loads the
// bilingual script and starts / stops listening, plus the last caption sent.
// Returns the engine, or null when the captions feature isn't there.
async function mountCaptions({ panel, deckId, slides }) {
  let mod;
  try {
    mod = await import("./captions/engine.js");
  } catch {
    return null; // feature removed — the panel works without it
  }
  const $ = (sel) => panel.querySelector(sel);
  const btn = $(".pp-cc");
  const file = $(".pp-cc-file");
  const strip = $(".pp-caption");
  const note = (text) => {
    strip.hidden = false;
    $(".pp-cap-meta").textContent = text;
  };
  let listening = false;
  const show = () => {
    btn.dataset.state = listening ? "live" : engine.hasScript ? "ready" : "none";
    btn.textContent = listening ? "● CC" : "CC";
    btn.title = !engine.hasScript
      ? "Live captions: load a bilingual script (.md)"
      : listening
        ? "Stop live captions"
        : "Start live captions (Shift-click: load another script)";
  };
  const params = new URLSearchParams(location.search);
  const engine = mod.createCaptionEngine({
    deckId,
    slides,
    room: params.get("sync") || syncRoomFor(deckId),
    onScript: ({ covered, lines }) => {
      note(`Captions script: ${lines} lines on ${covered} slides`);
      show();
    },
    onSent: (payload, why) => {
      strip.hidden = false;
      $(".pp-cap-en").textContent = payload.en;
      $(".pp-cap-en").classList.toggle("mt", Boolean(payload.mt));
      $(".pp-cap-meta").textContent = `CC · ${why}`;
    },
    onListening: (on, msg) => {
      listening = on;
      note(msg);
      show();
    },
  });
  window.__seCaptions = { feed: engine.feed }; // testing without a microphone
  btn.hidden = false;
  btn.addEventListener("click", (e) => {
    if (!engine.hasScript || (e.shiftKey && !listening)) return file.click();
    listening ? engine.stop() : engine.start();
  });
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (f) engine.loadScript(await f.text());
    file.value = "";
  });
  show();
  return engine;
}
