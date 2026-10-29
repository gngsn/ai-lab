// Runs inside the deck document of the view and share pages (loaded by the
// small module script the page adds to the deck). Bundled to /js/view-runtime.js.
// It hosts the deck, and on the audience page (share) draws the follow control
// into the letterbox page around the slide and follows the presenter over the
// ?sync=<room> channel.
import { hostDeck } from "/js/deck-host.js";
import { bindShortcutsHelp } from "../lib/shortcuts-help";

export type ViewOptions = {
  /** The sync room to follow; null on the plain view page. */
  followSync: string | null;
  helpCss: string;
};

// Audience page: live status + Stop / Follow toggle. It goes in the page
// around the letterboxed slide, not on the slide, so it never covers deck
// content and keeps its size on a phone.
const FOLLOW_CSS = `
#__se_follow {
  position: fixed; top: max(8px, env(safe-area-inset-top)); right: 10px;
  z-index: 10; display: flex; align-items: center; gap: 8px;
  padding: 3px 3px 3px 10px; border: 1px solid rgba(255,255,255,.14);
  border-radius: 999px; background: rgba(20,20,20,.8);
  font: 11px ui-monospace, monospace; letter-spacing: .04em; color: #888;
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
}
#__se_follow button {
  font: inherit; letter-spacing: inherit; color: #f0f0f0; cursor: pointer;
  background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.18);
  border-radius: 999px; padding: 5px 12px;
  display: inline-flex; align-items: center; white-space: nowrap;
  transition: background .2s ease;
}
#__se_follow button:hover { background: rgba(255,255,255,.18); }
/* Hover (or keyboard focus) slides the rest of the label open — "Follow"
   becomes "Follow the presenter". The pill is anchored right, so it grows
   leftward. Touch screens have no hover and keep the short label. */
#__se_follow button .more {
  display: inline-block; overflow: hidden; vertical-align: bottom;
  white-space: pre; /* keep the leading space an inline-block would drop */
  max-width: 0; opacity: 0; transform: translateX(-4px);
  transition: max-width .5s cubic-bezier(.2,.8,.2,1),
    opacity .3s ease, transform .5s cubic-bezier(.2,.8,.2,1);
}
#__se_follow button:hover .more,
#__se_follow button:focus-visible .more {
  max-width: 16em; opacity: 1; transform: none;
  transition-delay: 0s, .12s, 0s;
}
@media (prefers-reduced-motion: reduce) {
  #__se_follow button .more { transition: none; }
}
/* What Stop / Follow just did, shown briefly under the control. */
#__se_follow_hint {
  position: fixed; top: calc(max(8px, env(safe-area-inset-top)) + 42px);
  right: 10px; z-index: 10; max-width: min(280px, calc(100vw - 20px));
  padding: 7px 11px; border-radius: 8px; background: rgba(20,20,20,.88);
  border: 1px solid rgba(255,255,255,.14); color: #e8e8e8;
  font: 12px/1.45 system-ui, sans-serif; pointer-events: none;
  word-break: keep-all; /* Korean: wrap between words, not inside one */
  opacity: 0; transform: translateY(-4px);
  transition: opacity .2s ease, transform .2s ease;
}
#__se_follow_hint.show { opacity: 1; transform: none; }
`;

type SlidePayload = { section_id?: string; index?: number; fragments?: number[]; stepper?: number };

export async function startView({ followSync, helpCss }: ViewOptions) {
  const host = await hostDeck();
  if (host.mode === "speakeasy") {
    const overlay = document.getElementById("__se_overlay");
    if (overlay) overlay.hidden = false;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = helpCss;
    document.head.appendChild(link);
    bindShortcutsHelp("View (shared)", [
      { keys: ["↓", "→", "PgDn", "Space"], desc: "Next slide / advance fragment" },
      { keys: ["↑", "←", "PgUp"], desc: "Previous slide / hide last fragment" },
      { keys: ["Home", "End"], desc: "Jump to first / last slide" },
      { keys: ["?"], desc: "This help" },
    ]);
  }
  if (!followSync) return;

  const { createSlideSync } = await import("/js/sync.js");
  // Draw the control in the letterbox page around the slide (same origin);
  // without one (e.g. opened bare), in this document.
  let ui: Document = document;
  try {
    if (window.parent !== window && window.parent.document) ui = window.parent.document;
  } catch {}
  ui.getElementById("__se_follow")?.remove();
  const style = ui.createElement("style");
  style.textContent = FOLLOW_CSS;
  // Korean or English, from the browser / system language.
  const ko = /^ko(-|$)/i.test(navigator.languages?.[0] || navigator.language || "");
  const touch = matchMedia("(hover: none) and (pointer: coarse)").matches;
  // The status and button labels stay English; descriptions follow it.
  const labels = {
    live: "● Live",
    paused: "Paused",
    offline: "Offline",
    waiting: "Waiting…",
    // Short label, plus the rest revealed on hover.
    pause: "Pause",
    pauseMore: " · manual control",
    follow: "Follow",
    followMore: " the presenter",
  };
  const t = ko
    ? {
        ...labels,
        stopTitle: "발표자 따라가기를 멈추고 직접 넘겨 보기",
        followTitle: "발표자의 현재 슬라이드로 돌아가 따라가기",
        followingHint: "발표자를 따라가요. 발표에 맞춰 슬라이드가 넘어가요.",
        pausedHint: touch
          ? "일시정지했어요. < > 버튼으로 직접 넘겨 보세요. Follow를 누르면 다시 따라가요."
          : "일시정지했어요. ← → 키로 직접 넘겨 보세요. Follow를 누르면 다시 따라가요.",
      }
    : {
        ...labels,
        stopTitle: "Stop following the presenter and browse on your own",
        followTitle: "Jump back to the presenter's slide and follow along",
        followingHint: "Following the presenter — slides change along with the talk.",
        pausedHint: touch
          ? "Paused — browse at your own pace with the < > buttons. Tap Follow to catch up."
          : "Paused — browse at your own pace with the arrow keys. Click Follow to catch up.",
      };
  const box = ui.createElement("div");
  box.id = "__se_follow";
  box.innerHTML =
    '<span id="__se_status"></span>' +
    '<button id="__se_follow_toggle" type="button" aria-pressed="true">' +
    '<span class="lbl"></span><span class="more"></span></button>';
  box.prepend(style);
  ui.getElementById("__se_follow_hint")?.remove();
  const hint = ui.createElement("div");
  hint.id = "__se_follow_hint";
  hint.setAttribute("role", "status");
  ui.body.append(box, hint);
  import("/js/captions/audience.js")
    .then((m) => m.mountCaptions({ room: followSync, ui }))
    .catch(() => {});
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  const showHint = (text: string) => {
    hint.textContent = text;
    hint.classList.add("show");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove("show"), 2600);
  };
  const status = box.querySelector<HTMLElement>("#__se_status");
  const toggle = box.querySelector<HTMLButtonElement>("#__se_follow_toggle") as HTMLButtonElement;
  const toggleLbl = toggle.querySelector(".lbl") as HTMLElement;
  const toggleMore = toggle.querySelector(".more") as HTMLElement;
  const setStatus = (text: string, color: string) => {
    if (!status) return;
    status.textContent = text;
    status.style.color = color;
  };
  // Following: mirror every presenter update. Not following: browse on your
  // own; the latest update is kept so "Follow" jumps right back.
  let following = true;
  let latest: SlidePayload | null = null;
  let online = false;
  const showState = () => {
    if (!following) setStatus(t.paused, "#9a9a9c");
    else if (latest && online) setStatus(t.live, "#ff8d70");
    else if (latest) setStatus(t.offline, "#888");
    else setStatus(t.waiting, "#888");
    // The label shows on hover, so no native tooltip; the description stays
    // as the accessible name.
    toggleLbl.textContent = following ? t.pause : t.follow;
    toggleMore.textContent = following ? t.pauseMore : t.followMore;
    toggle.setAttribute("aria-label", following ? t.stopTitle : t.followTitle);
    toggle.setAttribute("aria-pressed", String(following));
  };
  // Jump to the presenter's slide: section_id first (robust to reordering),
  // index as fallback; then mirror step-by-step reveals on that slide.
  const apply = (payload: SlidePayload) => {
    const { section_id, index } = payload;
    let i = host.slides.findIndex((s) => s.dataset.sectionId === section_id);
    if (i < 0 && Number.isInteger(index)) i = index as number;
    if (i < 0) return;
    host.goTo(i);
    host.applyStepState(payload);
  };
  showState();
  const follow = (payload: SlidePayload = {}) => {
    latest = payload;
    online = true;
    if (following) apply(payload);
    showState();
  };
  toggle.addEventListener("click", () => {
    following = !following;
    if (following && latest) apply(latest);
    showState();
    showHint(following ? t.followingHint : t.pausedHint);
    // Hand focus back to the slides so arrow keys keep working.
    toggle.blur();
    window.focus();
  });
  const sync = createSlideSync(
    followSync,
    (payload) => follow((payload ?? undefined) as SlidePayload | undefined),
    (state) => {
      if (state === "SUBSCRIBED") {
        sync?.requestState(); // late joiner: ask for the current slide
      } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
        online = false;
        showState();
      }
    },
  );
}
