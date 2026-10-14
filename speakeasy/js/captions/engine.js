// Live captions — the engine behind every caption control (no UI).
//
// Listens to the speaker (browser speech recognition, Korean), finds the
// script line being said on the current slide (matcher.js) and sends that
// line's reviewed English to the audience (channel.js). Off-script speech
// falls back to Chrome's on-device Translator API when it's available.
// The caller says which slide is current (setSlide) and draws its own UI
// from the callbacks. Used by captions.html (console.js) and the presenter
// panel (js/presenter-panel.js).
import { alignToSlides, parseBilingualMd } from "./bilingual.js";
import { openCaptionChannel } from "./channel.js";
import { createMatcher } from "./matcher.js";

const ACCEPT = 0.4; // a finished phrase at least this close → that line
const EARLY = 0.55; // an unfinished phrase this close → send it already
const SCRIPT_KEY = (deckId) => `speakeasy:captions:script:${deckId}`;

export const speechSupported = () =>
  Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

/**
 * slides: every slide of the deck in order ({ section_id, title }).
 * Callbacks (all optional):
 *   onScript(info)         script loaded: { covered, lines, missing, unmatched }
 *   onSlide(index)         current slide changed
 *   onHeard(text, final)   speech recognized so far
 *   onSent(payload, why)   a caption went out: { en, ko, mt }
 *   onListening(on, msg)   started / stopped (msg: why, e.g. a mic error)
 *   onMtStatus(text)       state of the off-script translator
 *   onChannel(ok)          caption channel connected or not
 */
export function createCaptionEngine({ deckId, slides, room, ...on }) {
  const indexBySection = new Map(slides.map((s, i) => [s.section_id, i]));
  let script = []; // one { title, lines } per slide (alignToSlides)
  let matcher = createMatcher([]);
  let current = 0;
  let lastKey = null; // "slide:line" of the last caption sent
  let translator = null;
  let listening = false;
  let recognition = null;

  const channel = openCaptionChannel(room, {
    onStatus: (state) => on.onChannel?.(state === "SUBSCRIBED"),
  });

  // ── Script ──────────────────────────────────────────────────────────
  function loadScript(md, { save = true } = {}) {
    const { aligned, unmatched } = alignToSlides(parseBilingualMd(md), slides);
    script = aligned;
    matcher = createMatcher(script);
    if (save) {
      try {
        localStorage.setItem(SCRIPT_KEY(deckId), md);
      } catch {}
    }
    on.onScript?.({
      covered: script.filter((s) => s.lines.length).length,
      lines: script.reduce((n, s) => n + s.lines.length, 0),
      missing: script.reduce((n, s) => n + s.lines.filter((l) => l.en === null).length, 0),
      unmatched,
    });
  }
  // The script saved in this browser, once the caller has its engine.
  queueMicrotask(() => {
    try {
      const saved = localStorage.getItem(SCRIPT_KEY(deckId));
      if (saved) loadScript(saved, { save: false });
    } catch {}
  });

  /** Follow the presenter: by section_id, else by index. */
  function setSlide(sectionId, index) {
    let i = indexBySection.get(sectionId);
    if (i === undefined && Number.isInteger(index)) i = index;
    if (i === undefined || i === current) return;
    current = i;
    on.onSlide?.(current);
  }

  // ── Sending ─────────────────────────────────────────────────────────
  function send(payload, why) {
    channel?.send(payload);
    on.onSent?.(payload, why);
  }
  async function sendLine(m, { force = false } = {}) {
    const key = `${m.slide}:${m.line}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    let en = m.en;
    let mt = false;
    if (en === null) {
      en = await translate(m.ko); // reviewed English missing for this line
      mt = true;
      if (!en) return;
    }
    send({ en, ko: m.ko, mt }, `line ${m.line + 1} · ${m.score.toFixed(2)}`);
  }
  /** Send a line of the current slide by hand (presenter override). */
  function sendManual(line) {
    const l = script[current]?.lines[line];
    if (!l) return;
    const m = { slide: current, line, ...l, score: 1 };
    matcher.accept(m);
    sendLine(m, { force: true });
  }

  function feed(text, isFinal) {
    on.onHeard?.(text, isFinal);
    if (!script.length) return;
    const m = matcher.match(text, current);
    if (m && m.score >= (isFinal ? ACCEPT : EARLY)) {
      matcher.accept(m);
      sendLine(m);
    } else if (isFinal && text.trim().length > 3) {
      // Off script: translate what was heard, if Chrome can.
      translate(text).then((en) => {
        if (en) {
          lastKey = null;
          send({ en, ko: text, mt: true }, `off script · ${m ? m.score.toFixed(2) : "–"}`);
        }
      });
    }
  }

  // ── Machine translation fallback (Chrome's on-device Translator API) ─
  async function prepareTranslator() {
    const say = (t) => on.onMtStatus?.(t);
    if (!("Translator" in self)) {
      say("Off-script fallback: unavailable (needs desktop Chrome 138+)");
      return;
    }
    try {
      const opts = { sourceLanguage: "ko", targetLanguage: "en" };
      if ((await Translator.availability(opts)) === "unavailable") {
        say("Off-script fallback: unavailable on this device");
        return;
      }
      say("Off-script fallback: preparing…");
      translator = await Translator.create({
        ...opts,
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => {
            say(`Off-script fallback: downloading model ${Math.round(e.loaded * 100)}%`);
          });
        },
      });
      say("Off-script fallback: Chrome translator ready");
    } catch (err) {
      say(`Off-script fallback: ${err.message}`);
    }
  }
  async function translate(text) {
    if (!translator) return null;
    try {
      return await translator.translate(text);
    } catch {
      return null;
    }
  }

  // ── Speech recognition ──────────────────────────────────────────────
  function start() {
    if (listening) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return on.onListening?.(false, "Speech recognition needs desktop Chrome.");
    if (!script.length) return on.onListening?.(false, "Load a bilingual script first.");
    listening = true;
    on.onListening?.(true, "Listening (ko-KR)…");
    if (!translator) prepareTranslator(); // needs this click (user activation)
    recognition = new SR();
    recognition.lang = "ko-KR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) feed(r[0].transcript, true);
        else interim += r[0].transcript;
      }
      if (interim) feed(interim, false);
    };
    recognition.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        stop(`Mic blocked: ${e.error}`);
      } else {
        on.onListening?.(true, `Mic error: ${e.error}`);
      }
    };
    // Chrome ends a session after silence or ~a minute: keep it going.
    recognition.onend = () => {
      if (listening) setTimeout(() => listening && recognition.start(), 250);
    };
    recognition.start();
  }
  function stop(msg = "Stopped") {
    listening = false;
    recognition?.stop();
    on.onListening?.(false, msg);
  }

  return {
    loadScript,
    setSlide,
    sendManual,
    feed, // also handy for testing without a microphone
    start,
    stop,
    get listening() {
      return listening;
    },
    get hasScript() {
      return script.length > 0;
    },
    get current() {
      return current;
    },
    linesOf: (i) => script[i]?.lines || [],
    get lastKey() {
      return lastKey;
    },
  };
}
