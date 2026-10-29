import { supabase } from "../../data/client";
import { alignToSlides, parseBilingualMd } from "../../lib/captions/bilingual";
import { createMatcher, type Match, type ScriptLine } from "../../lib/captions/matcher";

type Slide = { section_id: string; title: string | null };
type Payload = { en: string; ko: string; mt: boolean };
type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type RecognitionCtor = new () => Recognition;
type Callbacks = {
  onScript?: (state: {
    covered: number;
    lines: number;
    missing: number;
    unmatched: (string | null)[];
  }) => void;
  onSlide?: () => void;
  onSync?: (ok: boolean | null) => void;
  onHeard?: (text: string, final: boolean) => void;
  onSent?: (payload: Payload, why: string) => void;
  onListening?: (on: boolean, message: string) => void;
  onMtStatus?: (text: string) => void;
  onChannel?: (ok: boolean) => void;
};

const SCRIPT_KEY = (id: string) => `speakeasy:captions:script:${id}`;
const ACCEPT = 0.4;
const EARLY = 0.55;
const runtime = window as Window & {
  SpeechRecognition?: RecognitionCtor;
  webkitSpeechRecognition?: RecognitionCtor;
};
export const speechSupported = () =>
  Boolean(runtime.SpeechRecognition || runtime.webkitSpeechRecognition);

export function createCaptionEngine({
  deckId,
  slides,
  room,
  follow = true,
  ...on
}: {
  deckId: string;
  slides: Slide[];
  room: string;
  /** Follow the presenter over the sync room (the caption console does; the presenter panel is told the slide instead). */
  follow?: boolean;
} & Callbacks) {
  const indexBySection = new Map(slides.map((slide, index) => [slide.section_id, index]));
  let script: { title: string | null; lines: ScriptLine[] }[] = [];
  let matcher = createMatcher([]);
  let current = 0;
  let lastKey: string | null = null;
  let translator: { translate(text: string): Promise<string> } | null = null;
  let listening = false;
  let recognition: Recognition | null = null;
  const captions = supabase.channel(`speakeasy-captions-${room}`, {
    config: { broadcast: { self: false } },
  });
  captions.on("broadcast", { event: "caption" }, ({ payload }) => void payload);
  captions.subscribe((state) => on.onChannel?.(state === "SUBSCRIBED"));
  if (follow) {
    const sync = supabase.channel(`speakeasy-sync-${room}`);
    sync.on("broadcast", { event: "slide" }, ({ payload }) =>
      setSlide(payload.section_id, payload.index),
    );
    sync.subscribe((state) => {
      if (state === "SUBSCRIBED")
        void sync.send({ type: "broadcast", event: "hello", payload: {} });
      on.onSync?.(state === "SUBSCRIBED" ? null : false);
    });
  }

  function loadScript(md: string, { save = true } = {}) {
    const { aligned, unmatched } = alignToSlides(parseBilingualMd(md), slides);
    script = aligned;
    matcher = createMatcher(script);
    if (save) {
      try {
        localStorage.setItem(SCRIPT_KEY(deckId), md);
      } catch {}
    }
    on.onScript?.({
      covered: script.filter((item) => item.lines.length).length,
      lines: script.reduce((n, item) => n + item.lines.length, 0),
      missing: script.reduce(
        (n, item) => n + item.lines.filter((line) => line.en === null).length,
        0,
      ),
      unmatched,
    });
  }
  queueMicrotask(() => {
    try {
      const saved = localStorage.getItem(SCRIPT_KEY(deckId));
      if (saved) loadScript(saved, { save: false });
    } catch {}
  });

  function setSlide(sectionId?: string, index?: number) {
    let next = indexBySection.get(sectionId ?? "");
    if (next === undefined && Number.isInteger(index)) next = index;
    if (next === undefined || next === current) return;
    current = next;
    on.onSlide?.();
  }
  function send(payload: Payload, why: string) {
    void captions.send({ type: "broadcast", event: "caption", payload });
    on.onSent?.(payload, why);
  }
  async function translate(text: string): Promise<string | null> {
    if (!translator) return null;
    try {
      return await translator.translate(text);
    } catch {
      return null;
    }
  }
  async function sendLine(match: Match, force = false) {
    const key = `${match.slide}:${match.line}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    let en = match.en;
    const mt = en === null;
    if (en === null) {
      en = await translate(match.ko);
      if (!en) return;
    }
    send({ en, ko: match.ko, mt }, `line ${match.line + 1} · ${match.score.toFixed(2)}`);
  }
  function feed(text: string, final: boolean) {
    on.onHeard?.(text, final);
    if (!script.length) return;
    const match = matcher.match(text, current);
    if (match && match.score >= (final ? ACCEPT : EARLY)) {
      matcher.accept(match);
      void sendLine(match);
    } else if (final && text.trim().length > 3) {
      void translate(text).then((en) => {
        if (en) {
          lastKey = null;
          send({ en, ko: text, mt: true }, `off script · ${match ? match.score.toFixed(2) : "–"}`);
        }
      });
    }
  }
  async function prepareTranslator() {
    type TranslatorApi = {
      availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
      create(options: {
        sourceLanguage: string;
        targetLanguage: string;
        monitor?: (monitor: EventTarget) => void;
      }): Promise<{ translate(text: string): Promise<string> }>;
    };
    const api = (globalThis as typeof globalThis & { Translator?: TranslatorApi }).Translator;
    const say = (text: string) => on.onMtStatus?.(text);
    if (!api) {
      say("Off-script fallback: unavailable (needs desktop Chrome 138+)");
      return;
    }
    try {
      const options = { sourceLanguage: "ko", targetLanguage: "en" };
      if ((await api.availability(options)) === "unavailable") {
        say("Off-script fallback: unavailable on this device");
        return;
      }
      say("Off-script fallback: preparing…");
      translator = await api.create({
        ...options,
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            const loaded = (event as Event & { loaded: number }).loaded;
            say(`Off-script fallback: downloading model ${Math.round(loaded * 100)}%`);
          });
        },
      });
      say("Off-script fallback: Chrome translator ready");
    } catch (error) {
      say(`Off-script fallback: ${(error as Error).message}`);
    }
  }
  function start() {
    if (listening) return;
    const SR = runtime.SpeechRecognition || runtime.webkitSpeechRecognition;
    if (!SR) return on.onListening?.(false, "Speech recognition needs desktop Chrome.");
    if (!script.length) return on.onListening?.(false, "Load a bilingual script first.");
    listening = true;
    on.onListening?.(true, "Listening (ko-KR)…");
    if (!translator) void prepareTranslator();
    recognition = new SR();
    recognition.lang = "ko-KR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) feed(result[0].transcript, true);
        else interim += result[0].transcript;
      }
      if (interim) feed(interim, false);
    };
    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed")
        stop(`Mic blocked: ${event.error}`);
      else on.onListening?.(true, `Mic error: ${event.error}`);
    };
    recognition.onend = () => {
      if (listening) setTimeout(() => listening && recognition?.start(), 250);
    };
    recognition.start();
  }
  function stop(message = "Stopped") {
    listening = false;
    recognition?.stop();
    on.onListening?.(false, message);
  }
  return {
    feed,
    loadScript,
    setSlide,
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
    get lastKey() {
      return lastKey;
    },
    linesOf: (index: number) => script[index]?.lines || [],
    sendManual(index: number) {
      const line = script[current]?.lines[index];
      if (!line) return;
      const match = { slide: current, line: index, ...line, score: 1 } as Match;
      matcher.accept(match);
      void sendLine(match, true);
    },
  };
}
