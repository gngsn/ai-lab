// Live captions — presenter console (captions.html).
//
// Listens to the speaker (browser speech recognition, Korean), finds the
// script line being said on the current slide (matcher.js) and sends that
// line's reviewed English to the audience (channel.js). Off-script speech
// falls back to Chrome's on-device Translator API when it's available.
// The current slide comes from the deck's live sync room (present.html).
import { createSlideSync } from "../sync.js";
import { alignToSlides, parseBilingualMd } from "./bilingual.js";
import { openCaptionChannel } from "./channel.js";
import { createMatcher } from "./matcher.js";

const ACCEPT = 0.4; // a finished phrase at least this close → that line
const EARLY = 0.55; // an unfinished phrase this close → send it already
const SCRIPT_KEY = (deckId) => `speakeasy:captions:script:${deckId}`;

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

export function mountCaptionConsole({ deck, slides, room }) {
  const $ = (id) => document.getElementById(id);
  const indexBySection = new Map(slides.map((s, i) => [s.section_id, i]));
  let script = []; // one { title, lines } per slide in `slides` (alignToSlides)
  let matcher = createMatcher([]);
  let current = 0; // slide index (in `slides`)
  let lastKey = null; // "slide:line" of the last caption sent
  let translator = null;
  let listening = false;
  let recognition = null;

  // ── Script ──────────────────────────────────────────────────────────
  function useScript(md, { save = true } = {}) {
    const { aligned, unmatched } = alignToSlides(parseBilingualMd(md), slides);
    script = aligned;
    matcher = createMatcher(script);
    if (save) {
      try {
        localStorage.setItem(SCRIPT_KEY(deck.deck_id), md);
      } catch {}
    }
    const lines = script.reduce((n, s) => n + s.lines.length, 0);
    const missing = script.reduce(
      (n, s) => n + s.lines.filter((l) => l.en === null).length,
      0,
    );
    const covered = script.filter((s) => s.lines.length).length;
    const mismatch = unmatched.length
      ? ` · ⚠ no slide titled: ${unmatched.join(", ")}`
      : "";
    $("script-status").textContent =
      `${covered}/${slides.length} slides have lines · ${lines} lines` +
      (missing ? ` · ${missing} without English (machine-translated)` : "") +
      mismatch;
    renderSlide();
  }
  $("script-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (file) useScript(await file.text());
    e.target.value = "";
  });
  try {
    const saved = localStorage.getItem(SCRIPT_KEY(deck.deck_id));
    if (saved) useScript(saved, { save: false });
  } catch {}

  // ── Current slide (followed from present.html) ──────────────────────
  function renderSlide() {
    const s = slides[current];
    $("slide-title").textContent = s
      ? `${current + 1}. ${s.title || s.section_id}`
      : "—";
    const lines = script[current]?.lines || [];
    $("lines").innerHTML = lines.length
      ? lines
          .map(
            (l, i) =>
              `<li data-line="${i}" class="${lastKey === `${current}:${i}` ? "sent" : ""}">` +
              `<span class="ko">${esc(l.ko)}</span>` +
              `<span class="en ${l.en === null ? "missing" : ""}">${esc(l.en ?? "(no English — machine translation)")}</span></li>`,
          )
          .join("")
      : `<li class="empty">${script.length ? "No script lines for this slide." : "Load a bilingual script to start."}</li>`;
  }
  // Click a line to send it now (presenter override).
  $("lines").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-line]");
    if (!li) return;
    const line = Number(li.dataset.line);
    const m = { slide: current, line, ...script[current].lines[line], score: 1 };
    matcher.accept(m);
    sendLine(m, { force: true });
  });
  const slideSync = createSlideSync(
    room,
    ({ section_id, index } = {}) => {
      let i = indexBySection.get(section_id);
      if (i === undefined && Number.isInteger(index)) i = index;
      if (i === undefined || i === current) return;
      current = i;
      renderSlide();
      setDot("sync-dot", true);
    },
    (state) => {
      if (state === "SUBSCRIBED") slideSync?.requestState();
      setDot("sync-dot", state === "SUBSCRIBED" ? null : false);
    },
  );
  const channel = openCaptionChannel(room, {
    onStatus: (state) => setDot("channel-dot", state === "SUBSCRIBED"),
  });
  function setDot(id, ok) {
    const el = $(id);
    if (el) el.dataset.state = ok === null ? "wait" : ok ? "ok" : "bad";
  }

  // ── Sending ─────────────────────────────────────────────────────────
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
    renderSlide();
  }
  function send(payload, why) {
    channel?.send(payload);
    $("sent").innerHTML =
      `<div class="en ${payload.mt ? "mt" : ""}">${esc(payload.en)}</div>` +
      `<div class="meta">${esc(payload.ko)} · ${esc(why)}</div>`;
    const li = document.createElement("li");
    li.textContent = `${new Date().toLocaleTimeString()}  ${payload.mt ? "[MT] " : ""}${payload.en}`;
    $("log").prepend(li);
    while ($("log").children.length > 30) $("log").lastChild.remove();
  }

  function onTranscript(text, isFinal) {
    $("heard").textContent = text;
    $("heard").classList.toggle("final", isFinal);
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
  // Exposed for testing without a microphone.
  window.__seCaptions = { feed: onTranscript };

  // ── Machine translation fallback (Chrome's on-device Translator API) ─
  async function prepareTranslator() {
    const el = $("mt-status");
    if (!("Translator" in self)) {
      el.textContent = "Off-script fallback: unavailable (needs desktop Chrome 138+)";
      return;
    }
    try {
      const opts = { sourceLanguage: "ko", targetLanguage: "en" };
      const availability = await Translator.availability(opts);
      if (availability === "unavailable") {
        el.textContent = "Off-script fallback: unavailable on this device";
        return;
      }
      el.textContent = "Off-script fallback: preparing…";
      translator = await Translator.create({
        ...opts,
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => {
            el.textContent = `Off-script fallback: downloading model ${Math.round(e.loaded * 100)}%`;
          });
        },
      });
      el.textContent = "Off-script fallback: Chrome translator ready";
    } catch (err) {
      el.textContent = `Off-script fallback: ${err.message}`;
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
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $("mic").disabled = true;
    $("mic-status").textContent =
      "Speech recognition isn't supported here — use desktop Chrome.";
  }
  function startRecognition() {
    recognition = new SR();
    recognition.lang = "ko-KR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) onTranscript(r[0].transcript, true);
        else interim += r[0].transcript;
      }
      if (interim) onTranscript(interim, false);
    };
    recognition.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      $("mic-status").textContent = `Mic error: ${e.error}`;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setListening(false);
      }
    };
    // Chrome ends a session after silence or ~a minute: keep it going.
    recognition.onend = () => {
      if (listening) setTimeout(() => listening && recognition.start(), 250);
    };
    recognition.start();
  }
  function setListening(on) {
    listening = on;
    $("mic").textContent = on ? "■ Stop captions" : "🎤 Start captions";
    $("mic").classList.toggle("live", on);
    $("mic-status").textContent = on ? "Listening (ko-KR)…" : "Stopped";
    if (!on) recognition?.stop();
  }
  $("mic").addEventListener("click", () => {
    if (listening) return setListening(false);
    if (!script.length) {
      $("mic-status").textContent = "Load a bilingual script first.";
      return;
    }
    setListening(true);
    if (!translator) prepareTranslator(); // needs this click (user activation)
    startRecognition();
  });

  // ── Header ──────────────────────────────────────────────────────────
  $("deck-title").textContent = deck.title || deck.deck_id;
  $("room").textContent = room;
  renderSlide();
}
