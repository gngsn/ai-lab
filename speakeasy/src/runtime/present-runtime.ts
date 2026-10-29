// Runs inside the deck document of the presenter page (loaded by the small
// module script the page adds to the deck). Bundled to /js/present-runtime.js.
// It hosts the deck, broadcasts every slide / step change to the sync room and
// to the presenter panel around the frame, and for plain decks ("speakeasy"
// mode) drives the overlay: counter, progress bar, slide dots, sync badge and
// the audience link.

import { hostDeck } from "/js/deck-host.js";
import { createSlideSync } from "/js/sync.js";
import { bindShortcutsHelp } from "../lib/shortcuts-help";

export type PresentOptions = {
  initialIndex: number;
  /** share.html link for the audience; null without a share token or sync room. */
  audienceUrl: string | null;
  helpCss: string;
};

type Payload = {
  section_id: string | null;
  index: number;
  fragments: number[];
  stepper: number;
};

export async function startPresent({ initialIndex, audienceUrl, helpCss }: PresentOptions) {
  const syncId = new URLSearchParams(location.search).get("sync");

  // "deck" mode: the deck runs its own controller and is shown exactly as its
  // plain HTML; Speakeasy only listens. "speakeasy" mode: plain decks get
  // Speakeasy's runtime plus the overlay below. See deck-host.
  const host = await hostDeck();

  // Live sync (script / share follow this), in both modes. The last state is
  // re-sent when a follower joins mid-talk and says hello.
  let lastPayload: Payload | null = null;
  let sync: ReturnType<typeof createSlideSync> = null;
  if (syncId) {
    sync = createSlideSync(syncId, undefined, undefined, {
      onHello: () => lastPayload && sync?.broadcast(lastPayload),
    });
  }
  // The presenter panel around this frame follows the current slide through
  // these messages.
  const tellPanel = (payload: Payload) => {
    if (window.parent !== window) {
      window.parent.postMessage({ type: "se:slide", ...payload }, location.origin);
    }
  };
  host.onChange(({ index, section_id, fragments, stepper }) => {
    lastPayload = { section_id, index, fragments, stepper };
    sync?.broadcast(lastPayload);
    tellPanel(lastPayload);
  });

  if (host.mode === "speakeasy") {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = helpCss;
    document.head.appendChild(link);
    bindShortcutsHelp("Present", [
      { keys: ["↓", "→", "PgDn", "Space"], desc: "Next slide / advance fragment" },
      { keys: ["↑", "←", "PgUp"], desc: "Previous slide / hide last fragment" },
      { keys: ["Home"], desc: "Jump to first slide" },
      { keys: ["End"], desc: "Jump to last slide" },
      { keys: ["?"], desc: "This help" },
    ]);

    const byId = (id: string) => document.getElementById(id) as HTMLElement;
    byId("__se_overlay").hidden = false;
    const counter = byId("__se_counter");
    const syncBadge = byId("__se_sync");
    const progress = byId("__se_progress");
    const navDots = byId("__se_navdots");

    const setNavDotsVisible = (visible: boolean) => {
      navDots.style.opacity = visible ? "1" : "0";
      navDots.style.pointerEvents = visible ? "auto" : "none";
      navDots.style.transform = visible
        ? "translateY(-50%) translateX(0)"
        : "translateY(-50%) translateX(8px)";
    };
    document.addEventListener("mousemove", (e) => {
      setNavDotsVisible(e.clientX > window.innerWidth * 0.62);
    });
    document.addEventListener("pointerdown", (e) => {
      setNavDotsVisible(e.clientX > window.innerWidth * 0.62);
    });
    setNavDotsVisible(false);

    const dotStyle = document.createElement("style");
    dotStyle.textContent =
      "#__se_navdots button { width: 11px; height: 11px; border-radius: 999px;" +
      " border: 1px solid rgba(255,255,255,.28); background: rgba(255,255,255,.18);" +
      " padding: 0; margin: 0; cursor: pointer; opacity: .8;" +
      " transition: transform .15s ease, background .15s ease, border-color .15s ease, opacity .15s ease; }" +
      "#__se_navdots button:hover { transform: scale(1.18); opacity: 1; border-color: #ff8d70; }" +
      "#__se_navdots button.active { background: #ff8d70; border-color: #ff8d70; opacity: 1; }";
    document.head.appendChild(dotStyle);

    host.slides.forEach((slide, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", `Slide ${index + 1}: ${slide.dataset.title || ""}`);
      btn.title = slide.dataset.title || `Slide ${index + 1}`;
      btn.addEventListener("click", () => host.goTo(index));
      navDots.appendChild(btn);
    });

    if (syncId && syncBadge) {
      syncBadge.style.display = "block";
      syncBadge.textContent = `● sync: ${syncId}`;
      syncBadge.onclick = () => void navigator.clipboard?.writeText(syncId);
    }
    // Audience link: share follows this presentation live. Needs the deck's
    // share token (enable sharing in the editor) and a sync room.
    const audienceEl = document.getElementById("__se_audience");
    if (audienceUrl && audienceEl) {
      audienceEl.style.display = "block";
      audienceEl.textContent = "🔗 copy audience link";
      audienceEl.onclick = async () => {
        try {
          await navigator.clipboard.writeText(audienceUrl);
          audienceEl.textContent = "✓ audience link copied";
        } catch {
          prompt("Audience link", audienceUrl);
        }
        setTimeout(() => {
          audienceEl.textContent = "🔗 copy audience link";
        }, 2000);
      };
    }

    host.onChange(({ index, total }) => {
      counter.textContent = `${index + 1} / ${total}`;
      progress.style.width = `${((index + 1) / Math.max(1, total)) * 100}%`;
      Array.from(navDots.children).forEach((btn, i) => {
        btn.classList.toggle("active", i === index);
        btn.setAttribute("aria-current", i === index ? "true" : "false");
      });
    });
  }

  if (initialIndex > 0) host.goTo(initialIndex);
  lastPayload ||= {
    section_id: host.slides[host.index()]?.dataset.sectionId || null,
    index: host.index(),
    ...host.getStepState(),
  };
  tellPanel(lastPayload);
}
