// @ts-check
// Makes present.html / view.html look identical on any screen.
//
// As a top-level page this script hosts the same URL in an iframe rendered at
// the fixed slide size (1280×720, see js/slide-fit.js) and scales that iframe
// to fit the window, letterboxed — so fonts, images and spacing all scale
// together instead of reflowing. Inside that iframe — or in ?print=1 mode,
// which needs the plain document — it just loads the page's real bootstrap
// module (data-boot).
//
// With data-panel (present.html), the slide shares the window with a side
// panel: the slide is letterboxed into the left stage and data-panel names
// a module whose mountPresenterPanel({ panel, frame }) fills the right.
(() => {
  const script = document.currentScript;
  const params = new URLSearchParams(location.search);
  const hosting = window.self === window.top && params.get("print") !== "1";
// @ts-expect-error — preserve this legacy runtime behavior without changing executable code.
  const panelSrc = script.dataset.panel;

  if (!hosting) {
    const boot = document.createElement("script");
    boot.type = "module";
// @ts-expect-error — preserve this legacy runtime behavior without changing executable code.
    boot.src = script.dataset.boot;
    document.head.appendChild(boot);
    return;
  }

  // Same design size as SLIDE_W/SLIDE_H in js/slide-fit.js.
  const SLIDE_W = 1280;
  const SLIDE_H = 720;

  const style = document.createElement("style");
  style.textContent = `
    html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }
    #__se_letterbox {
      position: fixed;
      left: 0;
      top: 0;
      width: ${SLIDE_W}px;
      height: ${SLIDE_H}px;
      border: 0;
      display: block;
      background: #000;
      transform-origin: 0 0;
    }
    /* < > step buttons for touch screens (no arrow keys there). */
    #__se_stepnav {
      position: fixed; left: 50%; transform: translateX(-50%);
      bottom: max(14px, env(safe-area-inset-bottom)); z-index: 10;
      display: none; gap: 10px;
    }
    @media (hover: none) and (pointer: coarse) {
      #__se_stepnav { display: flex; }
    }
    #__se_stepnav button {
      width: 52px; height: 44px; border-radius: 999px; cursor: pointer;
      border: 1px solid rgba(255,255,255,.18); background: rgba(20,20,20,.8);
      color: #f0f0f0; font: 20px ui-monospace, monospace; line-height: 1;
      touch-action: manipulation; /* no double-tap zoom on quick taps */
      -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
    }
    #__se_stepnav button:active { background: rgba(255,255,255,.2); }
    /* Presenter layout (data-panel): slide stage | side panel. */
    #__se_presenter {
      position: fixed; inset: 0; display: grid;
      grid-template-columns: minmax(0, 1fr) var(--se-panel-w, 38%);
    }
    #__se_presenter.panel-hidden { grid-template-columns: minmax(0, 1fr) 0; }
    #__se_stage { position: relative; overflow: hidden; min-width: 0; }
    #__se_stage #__se_letterbox { position: absolute; }
    #__se_panel { min-width: 0; overflow: hidden; }
    @media (max-width: 760px), (orientation: portrait) {
      #__se_presenter {
        grid-template-columns: 1fr;
        grid-template-rows: minmax(0, 45%) minmax(0, 1fr);
      }
      #__se_presenter.panel-hidden { grid-template-rows: 1fr 0; }
    }
  `;
  document.head.appendChild(style);

  const frame = document.createElement("iframe");
  frame.id = "__se_letterbox";
  frame.title = "Slides";
  frame.src = location.href;

  // The area the slide is fitted into: the window, or the presenter stage.
  const stage = panelSrc ? document.createElement("div") : null;
  const fit = () => {
    const w = stage ? stage.clientWidth : document.documentElement.clientWidth;
    const h = stage ? stage.clientHeight : document.documentElement.clientHeight;
    const scale = Math.min(w / SLIDE_W, h / SLIDE_H);
    const x = (w - SLIDE_W * scale) / 2;
    const y = (h - SLIDE_H * scale) / 2;
    frame.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  };
  window.addEventListener("resize", fit);

  // Step like the arrow keys: the deck (its own controller or Speakeasy's
  // runtime) already handles them.
// @ts-expect-error — preserve this legacy runtime behavior without changing executable code.
  const press = (key) => {
    frame.contentDocument?.dispatchEvent(
      new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }),
    );
    frame.contentWindow?.focus();
  };
  const stepNav = document.createElement("div");
  stepNav.id = "__se_stepnav";
  const ko = /^ko(-|$)/i.test(navigator.languages?.[0] || navigator.language || "");
  stepNav.innerHTML =
    `<button type="button" aria-label="${ko ? "이전" : "Previous"}">&lt;</button>` +
    `<button type="button" aria-label="${ko ? "다음" : "Next"}">&gt;</button>`;
  const [prevBtn, nextBtn] = stepNav.querySelectorAll("button");
  prevBtn.addEventListener("click", () => press("ArrowLeft"));
  nextBtn.addEventListener("click", () => press("ArrowRight"));

  const start = () => {
    if (stage) {
      const layout = document.createElement("div");
      layout.id = "__se_presenter";
      stage.id = "__se_stage";
      const panel = document.createElement("aside");
      panel.id = "__se_panel";
      stage.append(frame);
      layout.append(stage, panel);
      document.body.replaceChildren(layout, stepNav);
      new ResizeObserver(fit).observe(stage);
// @ts-expect-error — preserve this legacy runtime behavior without changing executable code.
      import(new URL(panelSrc, location.href).href)
        .then((m) => m.mountPresenterPanel({ panel, frame, layout, fit }))
        .catch((err) => console.warn("[letterbox] panel:", err));
    } else {
      document.body.replaceChildren(frame, stepNav);
    }
    fit();
    frame.addEventListener("load", () => {
// @ts-expect-error — preserve this legacy runtime behavior without changing executable code.
      frame.contentWindow.focus();
      // Mirror the deck's title (set by the bootstrap) onto the tab.
      const sync = () => {
        const t = frame.contentDocument?.title;
        if (t && t !== document.title) document.title = t;
      };
      sync();
      setInterval(sync, 1000);
    });
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);

  // Clicks on the letterbox bars would steal focus from the slides; hand it
  // back, and forward any keys that still land here so navigation works.
  document.addEventListener("pointerdown", () => frame.contentWindow?.focus());
  document.addEventListener("keydown", (e) => {
    const doc = frame.contentDocument;
    if (!doc || e.metaKey || e.ctrlKey || e.altKey) return; // browser shortcuts
    e.preventDefault();
    doc.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: e.key,
        code: e.code,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        bubbles: true,
        cancelable: true,
      }),
    );
// @ts-expect-error — preserve this legacy runtime behavior without changing executable code.
    frame.contentWindow.focus();
  });
})();
