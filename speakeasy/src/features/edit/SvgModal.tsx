import { type RefObject, useEffect, useRef, useState } from "react";
import type { EditChrome } from "./EditShell";
import { SVG_SHAPES } from "./svg-shapes";

const SVG_SOURCE_SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="8" y="8" width="84" height="84" rx="18" fill="#5db8a6"/>
  <path d="M28 54 L43 69 L72 34" fill="none" stroke="#ffffff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

type Parsed = { ok: true; svg: Element } | { ok: false; message: string };

function parseSvgSource(raw: string): Parsed {
  const text = raw.trim();
  if (!text) return { ok: false, message: "SVG 코드를 입력해주세요." };
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (doc.querySelector("parsererror")) {
    return { ok: false, message: "SVG 문법이 올바르지 않습니다." };
  }
  const svg = doc.documentElement;
  if (!svg || svg.tagName.toLowerCase() !== "svg") {
    return { ok: false, message: "루트 엘리먼트는 <svg> 여야 합니다." };
  }
  return { ok: true, svg };
}

const withSample = (current: string) => (current.trim() ? current : SVG_SOURCE_SAMPLE);

const WRAP_STYLE = "display:inline-block;line-height:0;vertical-align:middle;";

type Props = {
  canvasRef: RefObject<HTMLIFrameElement | null>;
  chrome: EditChrome;
  open: boolean;
  onClose: () => void;
};

// The "Insert SVG" dialog: a grid of shapes, or your own SVG source. The
// chosen SVG is posted to the slide editor in the canvas (`edit:insert-svg`).
export function SvgModal({ canvasRef, chrome, open, onClose }: Props) {
  const { toast } = chrome;
  const [tab, setTab] = useState<"shapes" | "custom">("shapes");
  const [fill, setFill] = useState("#5db8a6");
  const [stroke, setStroke] = useState("#ffffff");
  const [strokeW, setStrokeW] = useState("0");
  const [size, setSize] = useState("120");
  const [code, setCode] = useState("");
  const codeRef = useRef<HTMLTextAreaElement>(null);

  // The source box starts with a sample the first time it is shown empty.
  useEffect(() => {
    if (open) setCode(withSample);
  }, [open]);

  const sw = Number(strokeW) || 0;
  const parsed = parseSvgSource(code);

  const post = (html: string) => {
    canvasRef.current?.contentWindow?.postMessage({ type: "edit:insert-svg", html }, "*");
    onClose();
    toast("SVG inserted", "ok");
  };
  const insertShape = (render: (f: string, s: string, sw: number) => string) => {
    const px = Math.max(20, Number(size) || 120);
    post(
      `<span contenteditable="false" style="${WRAP_STYLE}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${px}" height="${px}">${render(fill, stroke, sw)}</svg></span>`,
    );
  };
  const insertCustom = () => {
    const result = parseSvgSource(code);
    if (!result.ok) {
      toast(result.message, "err");
      return;
    }
    post(`<span contenteditable="false" style="${WRAP_STYLE}">${result.svg.outerHTML}</span>`);
  };
  const chooseTab = (next: "shapes" | "custom") => {
    setTab(next);
    if (next === "custom") {
      setCode(withSample);
      queueMicrotask(() => codeRef.current?.focus());
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop closes the modal on a click outside it
    // biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop closes the modal; Esc is not handled
    <div
      className={`modal-bg${open ? " show" : ""}`}
      id="svg-modal-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        style={{ width: "min(920px, 94vw)", height: "min(78vh, 760px)", gap: 10 }}
      >
        <h2>Insert SVG</h2>
        <div className="svg-tabs">
          <button
            className={`svg-tab${tab === "shapes" ? " active" : ""}`}
            data-tab="shapes"
            type="button"
            onClick={() => chooseTab("shapes")}
          >
            Shapes
          </button>
          <button
            className={`svg-tab${tab === "custom" ? " active" : ""}`}
            data-tab="custom"
            type="button"
            onClick={() => chooseTab("custom")}
          >
            Custom SVG
          </button>
        </div>
        <div id="svg-tab-shapes" style={{ display: tab === "shapes" ? "" : "none" }}>
          <div className="svg-controls">
            <label>
              Fill{" "}
              <input
                type="color"
                id="svg-fill"
                value={fill}
                onChange={(e) => setFill(e.target.value)}
              />
            </label>
            <label>
              Stroke{" "}
              <input
                type="color"
                id="svg-stroke"
                value={stroke}
                onChange={(e) => setStroke(e.target.value)}
              />
            </label>
            <label>
              Stroke px{" "}
              <input
                type="number"
                id="svg-stroke-w"
                value={strokeW}
                min="0"
                max="20"
                step="1"
                style={{ width: 50 }}
                onChange={(e) => setStrokeW(e.target.value)}
              />
            </label>
            <label>
              Size px{" "}
              <input
                type="number"
                id="svg-size"
                value={size}
                min="20"
                max="500"
                step="10"
                style={{ width: 62 }}
                onChange={(e) => setSize(e.target.value)}
              />
            </label>
          </div>
          <div className="svg-shape-grid" id="svg-shape-grid">
            {SVG_SHAPES.map((shape) => (
              <button
                key={shape.id}
                className="svg-shape-btn"
                data-shape={shape.id}
                type="button"
                onClick={() => insertShape(shape.render)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 100 100"
                  width="58"
                  height="58"
                  aria-hidden="true"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: the markup comes from the static shape table above
                  dangerouslySetInnerHTML={{ __html: shape.render(fill, stroke, sw) }}
                />
                <span>{shape.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div id="svg-tab-custom" style={{ display: tab === "custom" ? "" : "none" }}>
          <div className="svg-source-layout">
            <div className="svg-source-editor">
              <label htmlFor="svg-custom-code">SVG source</label>
              <textarea
                id="svg-custom-code"
                ref={codeRef}
                spellCheck={false}
                placeholder={
                  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <!-- your SVG here -->\n</svg>'
                }
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <div className="svg-source-preview">
              <label htmlFor="svg-custom-preview">Preview</label>
              <div
                className="svg-source-canvas"
                id="svg-custom-preview"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: previews the user's own SVG
                dangerouslySetInnerHTML={{ __html: parsed.ok ? parsed.svg.outerHTML : "" }}
              />
              <div
                className="svg-source-status"
                id="svg-custom-status"
                data-kind={parsed.ok ? "ok" : "err"}
              >
                {parsed.ok
                  ? `OK · ${parsed.svg.getAttribute("viewBox") || "no viewBox"}`
                  : parsed.message}
              </div>
            </div>
          </div>
          <div className="actions" style={{ justifyContent: "flex-end" }}>
            <button className="btn" id="svg-custom-insert" type="button" onClick={insertCustom}>
              Insert
            </button>
          </div>
        </div>
        <div className="actions">
          <span style={{ flex: 1 }} />
          <button className="btn" id="svg-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
