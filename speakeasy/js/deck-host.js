// Runs a deck inside present.html / view.html.
//
// Decks that bring their own slide controller (a global `SlidePresentation`
// class started on DOMContentLoaded, like the v5 deck format) are shown
// exactly as their plain HTML: Speakeasy adds no layout CSS, no header /
// footer, no second controller — so nothing double-steps and nothing looks
// different. Speakeasy only listens (the deck's "slidechange" events and
// fragment class changes) to drive sync, the script view and share.html.
//
// Decks without a controller (plain <section>s) get Speakeasy's runtime,
// its scroll layout CSS and the data-hl / data-hr / data-page chrome.
//
// Either way the caller gets the same small interface:
//   { mode: "deck" | "speakeasy", slides, index(), goTo(i),
//     getStepState(), applyStepState(state), onChange(cb) }
import { SlidePresentation } from "./slide-runtime.js";

// Must run before the deck's DOMContentLoaded handlers, i.e. at module top
// level. Wraps the deck's global class (via global-scope eval: our imported
// SlidePresentation shadows the name in this module) to capture the
// instance the deck creates.
try {
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
  new Promise((resolve) => {
    // The deck's own DOMContentLoaded handlers were registered while its
    // script was parsed — before ours — so by the time this runs (plus a
    // tick) the deck has created its controller.
    const done = () => setTimeout(resolve, 0);
    if (document.readyState === "complete") done();
    else document.addEventListener("DOMContentLoaded", done, { once: true });
  });

function fragmentState(slide) {
  return [...(slide?.querySelectorAll(".fragment") || [])]
    .map((el, i) => (el.classList.contains("show") ? i : -1))
    .filter((i) => i >= 0);
}

function applyFragments(slide, fragments = []) {
  if (!slide) return;
  slide.classList.add("visible");
  const shown = new Set(fragments);
  slide
    .querySelectorAll(".fragment")
    .forEach((el, i) => el.classList.toggle("show", shown.has(i)));
}

// Host over the deck's own controller: it owns input and rendering.
function deckHost(ctl) {
  const slides = Array.isArray(ctl.slides)
    ? ctl.slides
    : [...document.querySelectorAll(".slide")];
  const index = () => (Number.isInteger(ctl.currentSlide) ? ctl.currentSlide : 0);
  const listeners = new Set();
  let applying = false;
  let queued = false;
  const emit = () => {
    if (applying || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const i = index();
      const detail = {
        index: i,
        section_id: slides[i]?.dataset?.sectionId || null,
        total: slides.length,
        fragments: fragmentState(slides[i]),
        stepper: -1,
      };
      listeners.forEach((cb) => cb(detail));
    });
  };
  document.addEventListener("slidechange", emit);
  // Fragment reveals don't fire slidechange; watch their class changes.
  const watcher = new MutationObserver(emit);
  slides.forEach((slide) =>
    slide
      .querySelectorAll(".fragment")
      .forEach((el) => watcher.observe(el, { attributeFilter: ["class"] })),
  );
  return {
    mode: "deck",
    slides,
    index,
    goTo(i) {
      if (i < 0 || i >= slides.length || i === index()) return;
      if (ctl._syncSkip !== undefined) ctl._syncSkip = true; // deck's own sync
      ctl.goTo(i);
    },
    getStepState: () => ({ fragments: fragmentState(slides[index()]), stepper: -1 }),
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
  document.querySelectorAll(".slide").forEach((slide) => {
    const { hl, hr, page } = slide.dataset;
    if ((hl || hr) && !slide.querySelector(":scope > .slide-header")) {
      const header = document.createElement("div");
      header.className = "slide-header reveal";
      header.innerHTML =
        '<div class="left"><span class="spike"></span>' +
        (hl || "") +
        "</div><div>" +
        (hr || "") +
        "</div>";
      slide.prepend(header);
    }
    if (page && !slide.querySelector(":scope > .slide-footer")) {
      const footer = document.createElement("div");
      footer.className = "slide-footer";
      footer.innerHTML =
        '<span class="slide-page">' + page.replace("/", " / ") + "</span>";
      slide.append(footer);
    }
  });
}

function speakeasyHost() {
  // Turn on the scroll layout CSS the page injected disabled.
  const fallback = document.getElementById("__se_fallback");
  if (fallback) fallback.media = "all";
  decorateSlides();
  const listeners = new Set();
  const runtime = new SlidePresentation({
    onSlideChange: (detail) => listeners.forEach((cb) => cb(detail)),
  });
  return {
    mode: "speakeasy",
    runtime,
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
export async function hostDeck() {
  await afterDeckSetup();
  const ctl = window.__seDeckController;
  if (ctl && typeof ctl.goTo === "function") return deckHost(ctl);
  return speakeasyHost();
}
