import { type RefObject, useEffect, useRef, useState } from "react";
import { updateFrameHtml } from "../../data/decks";
import type { DeckRow } from "../../data/types";
import type { EditChrome } from "./EditShell";
import {
  createEmptyFrameDraft,
  FRAME_PART_INFO,
  type FrameDraft,
  type FramePart,
  parseFrameDraft,
  serializeFrameDraft,
} from "./frame-draft";

const PARTS: { part: FramePart; label: string; note: string }[] = [
  { part: "html", label: "HTML", note: "문서 구조, head, body, layout" },
  { part: "css", label: "CSS", note: "<style> 블록 전체" },
  { part: "js", label: "JS", note: "inline <script> 블록 전체" },
];
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Props = {
  deckId: string;
  deckRef: RefObject<DeckRow>;
  chrome: EditChrome;
  open: boolean;
  onClose: () => void;
  /** Called after a save so the canvas re-renders with the new frame. */
  onSaved: () => void;
};

// The frame_html editor: the deck's page shell split into HTML / CSS / JS.
export function FrameModal({ deckId, deckRef, chrome, open, onClose, onSaved }: Props) {
  const { toast } = chrome;
  const [part, setPart] = useState<FramePart>("html");
  const [text, setText] = useState("");
  const draft = useRef<FrameDraft | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  // Opening starts from the saved frame, on the HTML part.
  useEffect(() => {
    if (!open) return;
    draft.current = parseFrameDraft(deckRef.current.frame_html);
    setPart("html");
    setText(draft.current.html);
  }, [open, deckRef]);

  const choosePart = (next: FramePart) => {
    if (!draft.current) draft.current = createEmptyFrameDraft();
    draft.current[part] = text;
    setPart(next);
    setText(draft.current[next] || "");
    textarea.current?.focus();
  };

  const save = async () => {
    if (!draft.current) draft.current = parseFrameDraft(deckRef.current.frame_html);
    draft.current[part] = text;
    const { html, insertedPlaceholder } = serializeFrameDraft(draft.current);
    if (insertedPlaceholder) toast("Inserted <!-- slides --> placeholder", "ok");
    try {
      await updateFrameHtml(deckId, html);
      deckRef.current = { ...deckRef.current, frame_html: html };
      onClose();
      onSaved(); // re-render with the new frame
      toast("Frame saved", "ok");
    } catch (err) {
      toast(`Frame save failed: ${messageOf(err)}`, "err");
    }
  };

  const info = FRAME_PART_INFO[part];
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop closes the modal on a click outside it, as before
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc handling was never part of this modal
    <div
      className={`modal-bg${open ? " show" : ""}`}
      id="frame-modal-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <h2>Edit frame_html</h2>
        <p>
          HTML / CSS / JS를 분리해 편집합니다. <code>&lt;!-- slides --&gt;</code> placeholder는 HTML
          저장 시 자동 보정됩니다.
        </p>
        <div id="frame-modal-body">
          <aside id="frame-sidebar" aria-label="Frame sections">
            {PARTS.map((item) => (
              <button
                key={item.part}
                className={`btn frame-part-btn${item.part === part ? " active" : ""}`}
                type="button"
                data-frame-part={item.part}
                onClick={() => choosePart(item.part)}
              >
                {item.label}
                <small>{item.note}</small>
              </button>
            ))}
          </aside>
          <section id="frame-editor-panel">
            <div id="frame-editor-meta">
              <div id="frame-editor-label">{info.label}</div>
              <div id="frame-editor-help">{info.help}</div>
            </div>
            <textarea
              id="frame-textarea"
              ref={textarea}
              spellCheck={false}
              value={text}
              onChange={(e) => {
                if (!draft.current) draft.current = createEmptyFrameDraft();
                draft.current[part] = e.target.value;
                setText(e.target.value);
              }}
            />
          </section>
        </div>
        <div className="actions">
          <button type="button" className="btn" id="frame-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn active" id="frame-save" onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
