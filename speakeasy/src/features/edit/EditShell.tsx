import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { updateTitle } from "../../data/decks";
import type { DeckRow } from "../../data/types";
import { bindShortcutsHelp } from "../../lib/legacy-runtime";
import { syncRoomFor } from "../../lib/sync-room";
import { AssetLibrary } from "./AssetLibrary";
import { FrameModal } from "./FrameModal";
import { HistoryDrawer, useHistoryDrawer } from "./HistoryDrawer";
import { type EditSlide, useEditorModel } from "./model";
import { NotesPanel } from "./NotesPanel";
import { ShareModal, useShare } from "./ShareModal";
import { SlideList } from "./SlideList";
import { SvgModal } from "./SvgModal";
import { useCanvas } from "./useCanvas";
import { useHtmlEditor } from "./useHtmlEditor";

// Chrome shared with the editor features that arrive in later P4-7 steps.
export type EditChrome = {
  setStatus: (text: string, kind?: string) => void;
  toast: (message: string, kind?: string) => void;
};
const EditChromeContext = createContext<EditChrome | null>(null);
export const useEditChrome = () => {
  const chrome = useContext(EditChromeContext);
  if (!chrome) throw new Error("useEditChrome outside EditShell");
  return chrome;
};

type Props = {
  deck: DeckRow;
  deckId: string;
  slides: EditSlide[];
  notes: Map<string, string>;
  keyMessages: Map<string, string>;
};
type AsideId = "slide-list" | "props";
type Mode = "aspect-169" | "portrait" | "html" | "stretch";

const SLIDE_LIST_WIDTH_KEY = "slidesEditor.slideListWidth";
const SLIDE_LIST_WIDTH_MIN = 180;
const SLIDE_LIST_WIDTH_MAX = 520;
const PROPS_PANEL_WIDTH_KEY = "slidesEditor.propsPanelWidth";
const PROPS_PANEL_HEIGHT_KEY = "slidesEditor.propsPanelHeight";
const PROPS_PANEL_WIDTH_MIN = 220;
const PROPS_PANEL_WIDTH_MAX = 720;
const PROPS_PANEL_HEIGHT_MIN = 180;
const PROPS_PANEL_HEIGHT_MAX = 520;
const TRAINING_COLLAPSED_KEY = "speakeasy:edit:collapsed:training";
const asideKey = (id: string) => `speakeasy:edit:collapsed:${id}`;

function getStoredPx(key: string, fallback: number) {
  const parsed = Number.parseInt(localStorage.getItem(key) || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function setStoredPx(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}
function getCssPx(varName: string, fallback: number) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName);
  const parsed = Number.parseInt(raw || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeFlag(key: string, on: boolean) {
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {}
}

function applySlideListWidth(px: number, max = SLIDE_LIST_WIDTH_MAX) {
  const next = Math.min(max, Math.max(SLIDE_LIST_WIDTH_MIN, px));
  document.documentElement.style.setProperty("--slide-list-width", `${next}px`);
  setStoredPx(SLIDE_LIST_WIDTH_KEY, next);
  return next;
}
function applyPropsPanelWidth(px: number, max = PROPS_PANEL_WIDTH_MAX) {
  const next = Math.min(max, Math.max(PROPS_PANEL_WIDTH_MIN, px));
  document.documentElement.style.setProperty("--props-width", `${next}px`);
  setStoredPx(PROPS_PANEL_WIDTH_KEY, next);
  return next;
}
function applyPropsPanelHeight(px: number, max = PROPS_PANEL_HEIGHT_MAX) {
  const next = Math.min(max, Math.max(PROPS_PANEL_HEIGHT_MIN, px));
  document.documentElement.style.setProperty("--props-height", `${next}px`);
  const body = document.getElementById("body");
  if (body?.classList.contains("portrait-mode")) {
    body.style.gridTemplateRows = `minmax(0, 1fr) ${next}px`;
  }
  setStoredPx(PROPS_PANEL_HEIGHT_KEY, next);
  return next;
}

// Drag a resizer handle; `onPointer` receives the pointer position.
function bindResizer(
  handle: HTMLElement | null,
  cursor: () => string,
  onPointer: (clientX: number, clientY: number) => void,
) {
  if (!handle) return () => {};
  let dragging = false;
  let onMove: ((e: PointerEvent) => void) | null = null;
  let onUp: (() => void) | null = null;
  const finish = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (onMove) document.removeEventListener("pointermove", onMove);
    if (onUp) document.removeEventListener("pointerup", onUp);
    onMove = null;
    onUp = null;
  };
  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    dragging = true;
    handle.classList.add("dragging");
    document.body.style.cursor = cursor();
    document.body.style.userSelect = "none";
    handle.setPointerCapture?.(e.pointerId);
    onMove = (moveEvent) => {
      if (dragging) onPointer(moveEvent.clientX, moveEvent.clientY);
    };
    onUp = () => finish();
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp, { once: true });
  };
  handle.addEventListener("pointerdown", onDown);
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
  window.addEventListener("blur", finish);
  return () => {
    finish();
    handle.removeEventListener("pointerdown", onDown);
    handle.removeEventListener("pointerup", finish);
    handle.removeEventListener("pointercancel", finish);
    handle.removeEventListener("lostpointercapture", finish);
    window.removeEventListener("blur", finish);
  };
}

// Close open dropdown menus (More, Export, per-slide "…") when clicking
// anywhere outside them. A menu containing the click stays open, so nested
// menus (Export inside More) keep working and opening one closes the rest.
function closeDropdowns(except: EventTarget | null = null) {
  for (const drop of document.querySelectorAll<HTMLDetailsElement>("details.dropdown[open]")) {
    if (!except || !drop.contains(except as Node)) drop.open = false;
  }
}

export function EditShell({ deck, deckId, slides, notes, keyMessages }: Props) {
  const [status, setStatusState] = useState<{ text: string; kind: string }>({
    text: "—",
    kind: "",
  });
  const [toastState, setToastState] = useState({ text: "", cls: "" });
  const toastTimer = useRef<number>(0);
  const [collapsed, setCollapsedState] = useState<Record<AsideId, boolean>>(() => ({
    "slide-list": readFlag(asideKey("slide-list")),
    props: readFlag(asideKey("props")),
  }));
  const [trainingCollapsed, setTrainingCollapsedState] = useState(() =>
    readFlag(TRAINING_COLLAPSED_KEY),
  );
  const deckRef = useRef(deck);
  const bodyRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const listResizerRef = useRef<HTMLDivElement>(null);
  const propsResizerRef = useRef<HTMLDivElement>(null);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  const setStatus = useCallback((text: string, kind = "") => setStatusState({ text, kind }), []);
  const toast = useCallback((message: string, kind = "") => {
    setToastState({ text: message, cls: `show ${kind}` });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastState((t) => ({ ...t, cls: "" })), 2200);
  }, []);
  const chrome = useMemo(() => ({ setStatus, toast }), [setStatus, toast]);
  const model = useEditorModel({
    deckId,
    initialSlides: slides,
    initialNotes: notes,
    initialKeyMessages: keyMessages,
    canvasRef,
    chrome,
  });
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [frameOpen, setFrameOpen] = useState(false);
  const [svgOpen, setSvgOpen] = useState(false);
  const share = useShare(deckId, deckRef, chrome);
  const history = useHistoryDrawer({ deckId, deckRef, model, chrome });
  const [mode, setMode] = useState<Mode>("aspect-169");
  const [gridRows, setGridRows] = useState<string | undefined>();
  const canvas = useCanvas({ canvasRef, stageRef, deckRef, model, chrome });
  const htmlEditor = useHtmlEditor({ deckId, model, chrome });
  const formatRef = useRef(htmlEditor.format);
  formatRef.current = htmlEditor.format;

  // Switches the workspace between canvas presets and the raw <section> editor.
  // Pending HTML is saved before leaving html mode so nothing is lost.
  const changeMode = async (next: Mode) => {
    canvas.setFitEnabled(next !== "stretch");
    if (model.htmlModeRef.current && next !== "html") await htmlEditor.flush();
    // The editor needs its container visible before it measures itself.
    flushSync(() => {
      setMode(next);
      setGridRows(
        next === "portrait"
          ? `minmax(0, 1fr) ${getStoredPx(PROPS_PANEL_HEIGHT_KEY, 280)}px`
          : undefined,
      );
    });
    if (next === "html") {
      model.htmlModeRef.current = true;
      htmlEditor.ensure();
      htmlEditor.load();
      htmlEditor.format();
      // Focus after the next paint so display:block has actually taken effect.
      requestAnimationFrame(() => htmlEditor.focus());
    } else {
      model.htmlModeRef.current = false;
      if (model.currentRef.current) model.showSlide(model.currentRef.current);
    }
  };

  const setAsideCollapsed = useCallback((id: AsideId, value: boolean) => {
    setCollapsedState((prev) => ({ ...prev, [id]: value }));
    writeFlag(asideKey(id), value);
  }, []);
  const toggleAside = useCallback(
    (id: AsideId) => setAsideCollapsed(id, !collapsedRef.current[id]),
    [setAsideCollapsed],
  );
  const setTrainingCollapsed = (value: boolean) => {
    setTrainingCollapsedState(value);
    writeFlag(TRAINING_COLLAPSED_KEY, value);
  };

  // Arrow points the way the panel will move: left panel ‹ collapses, › expands;
  // the right panel mirrors that.
  const asideArrow = (id: AsideId) => (collapsed[id] === (id === "slide-list") ? "›" : "‹");
  const asideTitle = (id: AsideId) =>
    `${collapsed[id] ? "Expand" : "Collapse"} ${id === "slide-list" ? "slide list ([)" : "notes panel (])"}`;
  const bodyClass =
    [
      collapsed["slide-list"] && "slide-list-collapsed",
      collapsed.props && "props-collapsed",
      mode === "portrait" && "portrait-mode",
      mode === "html" && "html-mode",
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  const presentUrl = new URL("./present.html", location.href);
  presentUrl.searchParams.set("deck", deckId);
  // Broadcast on the deck's room so the Share link's audience follows along.
  presentUrl.searchParams.set("sync", syncRoomFor(deckId));
  if (model.navSectionId) presentUrl.searchParams.set("section", model.navSectionId);
  const presentHref = presentUrl.toString();

  // Panel sizes: restored (and written back clamped) on load, like the legacy page.
  useEffect(() => {
    applySlideListWidth(getStoredPx(SLIDE_LIST_WIDTH_KEY, 240));
    applyPropsPanelWidth(getStoredPx(PROPS_PANEL_WIDTH_KEY, 280));
    applyPropsPanelHeight(getStoredPx(PROPS_PANEL_HEIGHT_KEY, 280));
  }, []);

  useEffect(() => {
    document.title = `Edit · ${deck.title || deckId}`;
    if (titleRef.current) titleRef.current.textContent = deck.title || deckId;
  }, [deck, deckId]);

  useEffect(() => {
    const body = () => document.getElementById("body") as HTMLElement;
    const stopProps = bindResizer(
      propsResizerRef.current,
      () => (body().classList.contains("portrait-mode") ? "row-resize" : "col-resize"),
      (clientX, clientY) => {
        if (body().classList.contains("portrait-mode")) {
          const bodyRect = body().getBoundingClientRect();
          const max = Math.max(PROPS_PANEL_HEIGHT_MIN, window.innerHeight - 48 - 180);
          applyPropsPanelHeight(bodyRect.bottom - clientY, max);
        } else {
          const max = Math.max(PROPS_PANEL_WIDTH_MIN, window.innerWidth - 240 - 240);
          applyPropsPanelWidth(window.innerWidth - clientX, max);
        }
      },
    );
    const stopList = bindResizer(
      listResizerRef.current,
      () => "col-resize",
      (clientX) => {
        const bodyRect = body().getBoundingClientRect();
        const propsWidth = getCssPx("--props-width", getStoredPx(PROPS_PANEL_WIDTH_KEY, 280));
        const landscapeMax = Math.max(SLIDE_LIST_WIDTH_MIN, window.innerWidth - propsWidth - 240);
        const portraitMax = Math.max(SLIDE_LIST_WIDTH_MIN, window.innerWidth - 240);
        const max = body().classList.contains("portrait-mode") ? portraitMax : landscapeMax;
        applySlideListWidth(clientX - bodyRect.left, max);
      },
    );
    return () => {
      stopProps();
      stopList();
    };
  }, []);

  // Keyboard: [ and ] fold the side panels; H, I and Ctrl/Cmd+S press the
  // toolbar buttons that later steps wire up. Escape closes menus.
  useEffect(() => {
    void bindShortcutsHelp("Edit", [
      { keys: ["E"], desc: "Toggle edit mode (canvas)" },
      { keys: ["M"], desc: "Toggle raw HTML mode" },
      { keys: ["H"], desc: "Toggle history drawer" },
      { keys: ["I"], desc: "Open asset library (images, video, audio, files)" },
      { keys: ["["], desc: "Collapse / expand slide list" },
      { keys: ["]"], desc: "Collapse / expand notes panel" },
      { keys: ["⌘S", "Ctrl+S"], desc: "Save version (manual snapshot)" },
      { keys: ["?"], desc: "This help" },
      { keys: ["Click"], desc: "Select slide in list" },
      { keys: ["Drag"], desc: "Reorder slides in list" },
    ]);
    const click = (id: string) => document.getElementById(id)?.click();
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        document.body.classList.contains("html-mode") &&
        document.activeElement?.id === "html-editor" &&
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "f" || e.key === "F")
      ) {
        e.preventDefault();
        formatRef.current();
        return;
      }
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.getAttribute?.("contenteditable") === "true"
      )
        return;
      if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        click("history-toggle");
      } else if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        click("images-btn");
      } else if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        toggleAside(e.key === "[" ? "slide-list" : "props");
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        click("save-version");
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDropdowns();
    };
    const onPointerDown = (e: PointerEvent) => closeDropdowns(e.target);
    const onBlur = () => closeDropdowns();
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keydown", onEscape);
    // Capture-phase pointerdown runs before any handler can stop propagation.
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onBlur);
    // Presses inside the slide iframe never reach this document. It's
    // same-origin, so listen inside it directly (re-attached per slide load).
    const canvas = canvasRef.current;
    const onCanvasLoad = () => {
      try {
        canvas?.contentDocument?.addEventListener("pointerdown", () => closeDropdowns(), true);
      } catch {
        /* not same-origin (about:blank during switches) — ignore */
      }
    };
    canvas?.addEventListener("load", onCanvasLoad);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keydown", onEscape);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onBlur);
      canvas?.removeEventListener("load", onCanvasLoad);
    };
  }, [toggleAside]);

  // Deck title: click to rename. Enter or blur saves, Escape reverts; an empty
  // title is rejected and the previous one restored.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.contentEditable = "plaintext-only";
    el.spellcheck = false;
    el.title = "Click to rename this deck";
    el.setAttribute("role", "textbox");
    el.setAttribute("aria-label", "Deck title");
    let saving = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        el.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        el.textContent = deckRef.current.title || deckId;
        el.blur();
      }
      // Keep editor shortcuts (E, ?, arrows…) from firing while typing.
      e.stopPropagation();
    };
    const onBlur = async () => {
      const next = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      const prev = deckRef.current.title || deckId;
      if (saving || next === prev) {
        el.textContent = prev;
        return;
      }
      if (!next) {
        el.textContent = prev;
        chrome.toast("Deck title can't be empty", "err");
        return;
      }
      saving = true;
      chrome.setStatus("saving title…");
      try {
        await updateTitle(deckId, next);
        deckRef.current = { ...deckRef.current, title: next };
        el.textContent = next;
        document.title = `Edit · ${next}`;
        chrome.setStatus("saved", "ok");
        chrome.toast("Deck renamed", "ok");
      } catch (err) {
        el.textContent = prev;
        chrome.setStatus("rename failed", "err");
        chrome.toast(`Rename failed: ${(err as Error).message}`, "err");
      } finally {
        saving = false;
      }
    };
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("blur", onBlur);
    return () => {
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("blur", onBlur);
    };
  }, [deckId, chrome]);

  return (
    <EditChromeContext.Provider value={chrome}>
      <div id="app">
        <header id="toolbar">
          <a className="btn home" href="./index.html" title="Home">
            🏠
          </a>
          <span className="title" id="deck-title" ref={titleRef} />
          <select
            id="mode-select"
            className="btn"
            style={{ width: "auto", minWidth: 80 }}
            value={mode}
            onChange={(e) => void changeMode(e.target.value as Mode)}
          >
            <option value="aspect-169">16:9</option>
            <option value="portrait">portrait</option>
            <option value="html">html</option>
            <option value="stretch">stretch</option>
          </select>

          <span className="spacer"></span>
          <a className="btn" id="present-link" href={presentHref} target="_blank" rel="noreferrer">
            ▶ Present
          </a>
          <details className="dropdown" id="more-dropdown">
            <summary className="btn">⋮ More</summary>
            <div className="dropdown-menu">
              <button id="save-version" type="button">
                ★ Save version
              </button>
              <details
                className="dropdown"
                id="export-dropdown"
                style={{ position: "static", display: "block" }}
              >
                <summary className="btn" style={{ padding: 0 }}>
                  ⬇ Export
                </summary>
                <div
                  className="dropdown-menu"
                  style={{ position: "static", boxShadow: "none", minWidth: 0, marginTop: 10 }}
                >
                  <button type="button" data-export="html">
                    HTML
                  </button>
                  <button type="button" data-export="md">
                    Notes (.md)
                  </button>
                  <button type="button" data-export="md-copy">
                    Notes (Clipboard)
                  </button>
                  <button type="button" data-export="pdf">
                    PDF (browser print)
                  </button>
                  <a
                    id="export-notes-link"
                    href={`./notes.html?deck=${encodeURIComponent(deckId)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open notes view ↗
                  </a>
                </div>
              </details>
              <button
                id="history-toggle"
                type="button"
                className={history.open ? "active" : undefined}
                onClick={history.toggle}
              >
                ⏱ History
              </button>
              <button id="frame-edit" type="button" onClick={() => setFrameOpen(true)}>
                Frame…
              </button>
              <button id="share-btn" type="button" onClick={() => void share.openShare()}>
                🔗 Share
              </button>
              <button id="svg-btn" type="button" onClick={() => setSvgOpen(true)}>
                ✦ SVG
              </button>
              <button id="images-btn" type="button" onClick={() => setAssetsOpen(true)}>
                🖼 Assets
              </button>
            </div>
          </details>
          <span id="status" data-kind={status.kind}>
            {status.text}
          </span>
        </header>
        <main
          id="body"
          ref={bodyRef}
          className={bodyClass}
          style={gridRows ? { gridTemplateRows: gridRows } : undefined}
        >
          <aside id="slide-list">
            <div id="slide-list-resizer" aria-hidden="true" ref={listResizerRef} />
            <div id="slide-list-scroll">
              <SlideList
                model={model}
                asideToggle={
                  <button
                    className="aside-toggle"
                    type="button"
                    data-aside="slide-list"
                    aria-controls="slide-list"
                    aria-expanded={!collapsed["slide-list"]}
                    title={asideTitle("slide-list")}
                    onClick={() => toggleAside("slide-list")}
                  >
                    {asideArrow("slide-list")}
                  </button>
                }
              />
            </div>
          </aside>
          <div
            id="canvas-wrap"
            className={
              {
                "aspect-169": "aspect-169",
                portrait: "portrait-169",
                html: "html-mode",
                stretch: undefined,
              }[mode]
            }
          >
            <div id="canvas-preview-controls">
              <button
                id="canvas-preview-prev"
                className="canvas-preview-btn"
                type="button"
                title="Previous animation step"
                aria-label="Previous animation step"
                onClick={canvas.previewBack}
              >
                &lt;
              </button>
              <button
                id="canvas-preview-click"
                className="canvas-preview-btn"
                type="button"
                title="Next animation step"
                aria-label="Next animation step"
                onClick={canvas.previewNext}
              >
                &gt;
              </button>
            </div>
            <div id="canvas-stage" ref={stageRef}>
              <iframe id="canvas" ref={canvasRef} title="Slide canvas" src="about:blank" />
            </div>
            <pre id="html-highlight" aria-hidden="true" />
            <textarea
              id="html-editor"
              spellCheck="false"
              placeholder="<section ...>...</section>"
            ></textarea>
          </div>
          <aside id="props">
            <div id="props-resizer" aria-hidden="true" ref={propsResizerRef} />
            <NotesPanel
              deckId={deckId}
              model={model}
              chrome={chrome}
              asideToggle={
                <button
                  className="aside-toggle"
                  type="button"
                  data-aside="props"
                  aria-controls="props"
                  aria-expanded={!collapsed.props}
                  title={asideTitle("props")}
                  onClick={() => toggleAside("props")}
                >
                  {asideArrow("props")}
                </button>
              }
            />
            <div id="training-section" className={trainingCollapsed ? "collapsed" : undefined}>
              <button
                id="training-toggle"
                type="button"
                aria-controls="training-mount"
                aria-expanded={!trainingCollapsed}
                onClick={() => setTrainingCollapsed(!trainingCollapsed)}
              >
                <span className="chev">▾</span> Training
              </button>
              <div id="training-mount"></div>
            </div>
          </aside>
        </main>
      </div>

      <AssetLibrary
        deckId={deckId}
        canvasRef={canvasRef}
        chrome={chrome}
        open={assetsOpen}
        onClose={() => setAssetsOpen(false)}
      />

      <HistoryDrawer history={history} />

      <FrameModal
        deckId={deckId}
        deckRef={deckRef}
        chrome={chrome}
        open={frameOpen}
        onClose={() => setFrameOpen(false)}
        onSaved={() => {
          if (model.currentRef.current) model.showSlide(model.currentRef.current);
        }}
      />
      <SvgModal
        canvasRef={canvasRef}
        chrome={chrome}
        open={svgOpen}
        onClose={() => setSvgOpen(false)}
      />
      <ShareModal share={share} chrome={chrome} />

      <div id="toast" className={toastState.cls || undefined}>
        {toastState.text}
      </div>
    </EditChromeContext.Provider>
  );
}
