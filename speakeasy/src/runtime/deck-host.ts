// Runs a deck inside the present and view pages. Bundled to /js/deck-host.js,
// the URL stored decks and the page bootstraps load it from.
//
// Decks that bring their own slide controller (a global `SlidePresentation`
// class started on DOMContentLoaded) are shown
// exactly as their plain HTML: Speakeasy adds no layout CSS, no header /
// footer, no second controller — so nothing double-steps and nothing looks
// different. Speakeasy only listens (the deck's "slidechange" events and
// fragment class changes) to drive sync, the script view and the share page.
//
// Decks without a controller (plain <section>s) get Speakeasy's runtime,
// its scroll layout CSS and the data-hl / data-hr / data-page chrome.
//
// Either way the caller gets the same small interface (see DeckHost).
import { SlidePresentation } from "./slide-runtime";
import type { DeckHost, SlideChangeDetail, StepState } from "./types";

// What a deck's own controller is expected to look like.
type DeckController = {
  slides?: HTMLElement[];
  currentSlide?: number;
  goTo(i: number): void;
  _syncSkip?: boolean;
};
type DeckWindow = Window & { __seDeckController?: DeckController };

// Must run before the deck's DOMContentLoaded handlers, i.e. at module top
// level. Wraps the deck's global class (via global-scope eval: it has to
// reassign the deck's own global binding) to capture the instance the deck
// creates.
try {
  // biome-ignore lint/security/noGlobalEval: a deck's `class SlidePresentation` is a global lexical binding, not a window property; only global-scope code can reassign it
  (0, eval)(
    "if (typeof SlidePresentation === 'function') {" +
      " SlidePresentation = class extends SlidePresentation {" +
      "  constructor(...args) { super(...args); window.__seDeckController = this; }" +
      " };" +
      "}",
  );
} catch (err) {
  console.warn("[deck-host] controller hook:", err);
}

const afterDeckSetup = () =>
  new Promise<void>((resolve) => {
    // The deck's own DOMContentLoaded handlers were registered while its
    // script was parsed — before ours — so by the time this runs (plus a
    // tick) the deck has created its controller.
    const done = () => setTimeout(resolve, 0);
    if (document.readyState === "complete") done();
    else document.addEventListener("DOMContentLoaded", done, { once: true });
  });

function fragmentState(slide: HTMLElement | undefined): number[] {
  return [...(slide?.querySelectorAll(".fragment") || [])]
    .map((el, i) => (el.classList.contains("show") ? i : -1))
    .filter((i) => i >= 0);
}

function applyFragments(slide: HTMLElement | undefined, fragments: number[] = []) {
  if (!slide) return;
  slide.classList.add("visible");
  const shown = new Set(fragments);
  slide
    .querySelectorAll(".fragment")
    .forEach((el, i) => void el.classList.toggle("show", shown.has(i)));
}

// Phones can't hold what these decks ask the GPU for: <main> (every slide
// stacked, ~30000px tall) is a will-change layer that slides on a 0.6s
// transition, and flipping quickly kills the tab (iOS Safari: "A problem
// repeatedly occurred"). On touch screens: move <main> without a transition
// and only render the current slide and its neighbours. Neighbours stay
// rendered so a slide's reveal transitions still play when it arrives.
const PHONE = "(hover: none) and (pointer: coarse)";
function lightenForPhones(slides: HTMLElement[], index: () => number) {
  if (!window.matchMedia?.(PHONE).matches) return;
  const style = document.createElement("style");
  style.id = "__se_phone";
  style.textContent = `
    main { transition: none !important; will-change: auto !important; }
    .slide:not([data-se-near]) {
      content-visibility: hidden !important;
      visibility: hidden !important;
    }`;
  document.head.appendChild(style);
  const mark = () => {
    const i = index();
    slides.forEach((slide, k) => {
      slide.toggleAttribute("data-se-near", Math.abs(k - i) <= 1);
    });
  };
  mark();
  document.addEventListener("slidechange", mark);
}

// Host over the deck's own controller: it owns input and rendering.
function deckHost(ctl: DeckController): DeckHost {
  const slides = Array.isArray(ctl.slides)
    ? ctl.slides
    : [...document.querySelectorAll<HTMLElement>(".slide")];
  const index = () => (Number.isInteger(ctl.currentSlide) ? (ctl.currentSlide as number) : 0);
  const listeners = new Set<(detail: SlideChangeDetail) => void>();
  let applying = false;
  let queued = false;
  const emit = () => {
    if (applying || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const i = index();
      const detail: SlideChangeDetail = {
        index: i,
        section_id: slides[i]?.dataset?.sectionId || null,
        total: slides.length,
        fragments: fragmentState(slides[i]),
        stepper: -1,
      };
      for (const cb of listeners) cb(detail);
    });
  };
  document.addEventListener("slidechange", emit);
  lightenForPhones(slides, index);
  // Fragment reveals don't fire slidechange; watch their class changes.
  const watcher = new MutationObserver(emit);
  for (const slide of slides) {
    for (const el of slide.querySelectorAll(".fragment")) {
      watcher.observe(el, { attributeFilter: ["class"] });
    }
  }
  return {
    mode: "deck",
    slides,
    index,
    goTo(i) {
      if (i < 0 || i >= slides.length || i === index()) return;
      if (ctl._syncSkip !== undefined) ctl._syncSkip = true; // deck's own sync
      ctl.goTo(i);
    },
    getStepState: (): StepState => ({ fragments: fragmentState(slides[index()]), stepper: -1 }),
    applyStepState({ fragments = [] } = {}) {
      applying = true;
      try {
        applyFragments(slides[index()], fragments);
      } finally {
        applying = false;
      }
    },
    onChange(cb) {
      listeners.add(cb);
    },
  };
}

// Slide chrome Speakeasy adds for plain decks: header from data-hl/data-hr
// (class "reveal", so it animates in) and a page footer from data-page.
function decorateSlides() {
  for (const slide of document.querySelectorAll<HTMLElement>(".slide")) {
    const { hl, hr, page } = slide.dataset;
    if ((hl || hr) && !slide.querySelector(":scope > .slide-header")) {
      const header = document.createElement("div");
      header.className = "slide-header reveal";
      header.dataset.seGenerated = "slide-header";
      header.innerHTML = `<div class="left"><span class="spike"></span>${hl || ""}</div><div>${hr || ""}</div>`;
      slide.prepend(header);
    }
    if (page && !slide.querySelector(":scope > .slide-footer")) {
      const footer = document.createElement("div");
      footer.className = "slide-footer";
      footer.dataset.seGenerated = "slide-footer";
      footer.innerHTML = `<span class="slide-page">${page.replace("/", " / ")}</span>`;
      slide.append(footer);
    }
  }
}

function speakeasyHost(): DeckHost {
  // Turn on the scroll layout CSS the page injected disabled.
  const fallback = document.getElementById("__se_fallback") as HTMLStyleElement | null;
  if (fallback) fallback.media = "all";
  decorateSlides();
  const listeners = new Set<(detail: SlideChangeDetail) => void>();
  const runtime = new SlidePresentation({
    onSlideChange: (detail) => {
      for (const cb of listeners) cb(detail);
    },
  });
  return {
    mode: "speakeasy",
    slides: runtime.slides,
    index: () => runtime.currentSlide,
    goTo: (i) => runtime.goTo(i),
    getStepState: () => runtime.getStepState(),
    applyStepState: (state) => runtime.applyStepState(state),
    onChange(cb) {
      listeners.add(cb);
      // Report the current slide right away, like the runtime did at start.
      cb({
        index: runtime.currentSlide,
        section_id: runtime.slides[runtime.currentSlide]?.dataset.sectionId || null,
        total: runtime.slides.length,
        ...runtime.getStepState(),
      });
    },
  };
}

/** Resolves once the deck is set up, with the host interface above. */
export async function hostDeck(): Promise<DeckHost> {
  await afterDeckSetup();
  const ctl = (window as DeckWindow).__seDeckController;
  if (ctl && typeof ctl.goTo === "function") return deckHost(ctl);
  return speakeasyHost();
}
