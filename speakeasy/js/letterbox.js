// Makes present.html / view.html look identical on any screen.
//
// As a top-level page this script hosts the same URL in an iframe rendered at
// the fixed slide size (1280×720, see js/slide-fit.js) and scales that iframe
// to fit the window, letterboxed — so fonts, images and spacing all scale
// together instead of reflowing. Inside that iframe — or in ?print=1 mode,
// which needs the plain document — it just loads the page's real bootstrap
// module (data-boot).
(() => {
  const script = document.currentScript;
  const params = new URLSearchParams(location.search);
  const hosting = window.self === window.top && params.get("print") !== "1";

  if (!hosting) {
    const boot = document.createElement("script");
    boot.type = "module";
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
  `;
  document.head.appendChild(style);

  const frame = document.createElement("iframe");
  frame.id = "__se_letterbox";
  frame.title = "Slides";
  frame.src = location.href;

  const fit = () => {
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;
    const scale = Math.min(w / SLIDE_W, h / SLIDE_H);
    const x = (w - SLIDE_W * scale) / 2;
    const y = (h - SLIDE_H * scale) / 2;
    frame.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  };
  window.addEventListener("resize", fit);

  const start = () => {
    document.body.replaceChildren(frame);
    fit();
    frame.addEventListener("load", () => {
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
    frame.contentWindow.focus();
  });
})();
