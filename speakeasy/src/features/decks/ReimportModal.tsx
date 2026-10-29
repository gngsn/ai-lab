import { useEffect } from "react";
import type { PartName } from "./import-deck";
import type { useReimport } from "./useReimport";

type Reimport = ReturnType<typeof useReimport>;

const PARTS: { name: PartName; title: string; chooser: string; accept: string }[] = [
  { name: "slides", title: "Slides", chooser: "Choose HTML", accept: ".html,.htm,text/html" },
  {
    name: "script",
    title: "Script",
    chooser: "Choose Markdown",
    accept: ".md,.markdown,text/markdown",
  },
  {
    name: "keys",
    title: "Key messages",
    chooser: "Choose Markdown",
    accept: ".md,.markdown,text/markdown",
  },
];

function PartRow({ part, reimport }: { part: (typeof PARTS)[number]; reimport: Reimport }) {
  const { name } = part;
  const state = reimport.states[name];
  const text = state.text || "Keep current";
  return (
    <div className="reimport-part" data-part={name} data-state={state.kind || undefined}>
      <span className="part-name">{part.title}</span>
      <div className="part-body">
        <div className="part-pick">
          <label className="md-btn md-secondary">
            {part.chooser}
            <input
              type="file"
              accept={part.accept}
              ref={reimport.fileInputRef(name)}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) reimport.chooseFile(name, file);
              }}
            />
          </label>
          <input
            className="part-url"
            type="url"
            placeholder="or paste a GitHub URL"
            autoComplete="off"
            value={reimport.urls[name]}
            onChange={(e) => reimport.setUrl(name, e.target.value)}
            onBlur={(e) => reimport.commitUrl(name, e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && reimport.commitUrl(name, e.currentTarget.value)}
          />
        </div>
        <div className="part-state">
          <span title={text}>{text}</span>
          {(state.kind === "ready" || state.kind === "error") && (
            <button
              type="button"
              className="md-btn md-text part-clear"
              onClick={() => reimport.resetPart(name)}
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReimportModal({ reimport }: { reimport: Reimport }) {
  const open = reimport.deck !== null;
  const { close } = reimport;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop closes the modal on a click outside it
    // biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop closes the modal on a click outside it; Escape is handled on the document
    <div
      className={open ? "modal-bg show" : "modal-bg"}
      id="reimport-modal-bg"
      aria-hidden={!open}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="reimport-title">
        <p className="modal-eyebrow">Re-import</p>
        <h2 id="reimport-title">{reimport.deck?.title}</h2>
        <p className="reimport-note">
          Replace any of the parts below; the rest stay as they are. Replaced slides and script are
          saved to History first.
        </p>
        {PARTS.map((part) => (
          <PartRow key={part.name} part={part} reimport={reimport} />
        ))}
        <p id="reimport-error" className="bad" hidden={!reimport.error}>
          {reimport.error}
        </p>
        <div className="actions">
          <button
            className="md-btn md-secondary"
            id="reimport-cancel"
            type="button"
            disabled={reimport.running}
            onClick={close}
          >
            Cancel
          </button>
          <button
            className="md-btn md-primary"
            id="reimport-run"
            type="button"
            disabled={!reimport.canRun}
            onClick={() => void reimport.run()}
          >
            {reimport.runLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
