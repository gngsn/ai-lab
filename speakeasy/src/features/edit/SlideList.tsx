import { type DragEvent, useEffect, useRef, useState } from "react";
import { isSlideHiddenContent } from "../../lib/slide-visibility";
import type { EditorModel } from "./model";

function HiddenSlideIcon() {
  return (
    <svg
      aria-hidden="true"
      className="svg-icon"
      style={{
        width: "1em",
        height: "1em",
        verticalAlign: "middle",
        fill: "currentColor",
        color: "var(--text-mid)",
        overflow: "hidden",
        flex: "0 0 auto",
      }}
      viewBox="0 0 1024 1024"
      version="1.1"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M900.266667 379.733333c-12.8-8.533333-34.133333-8.533333-42.666667 8.533334-136.533333 187.733333-396.8 226.133333-584.533333 93.866666-42.666667-29.866667-76.8-64-102.4-106.666666-8.533333-12.8-29.866667-17.066667-42.666667-8.533334-12.8 8.533333-17.066667 29.866667-8.533333 42.666667 29.866667 46.933333 72.533333 85.333333 115.2 119.466667 17.066667 12.8 38.4 25.6 55.466666 34.133333l-81.066666 81.066667c-12.8 12.8-12.8 34.133333 0 46.933333 4.266667 4.266667 12.8 8.533333 21.333333 8.533333s17.066667-4.266667 21.333333-8.533333L345.6 597.333333l4.266667-4.266666c42.666667 17.066667 85.333333 25.6 128 29.866666v119.466667c0 17.066667 12.8 34.133333 34.133333 34.133333s34.133333-12.8 34.133333-34.133333v-123.733333c38.4-4.266667 72.533333-8.533333 110.933334-17.066667 0 0 0 4.266667 4.266666 4.266667l93.866667 93.866666c4.266667 4.266667 12.8 8.533333 21.333333 8.533334s17.066667-4.266667 21.333334-8.533334c12.8-12.8 12.8-34.133333 0-46.933333l-76.8-76.8c72.533333-34.133333 136.533333-85.333333 187.733333-153.6 8.533333-12.8 4.266667-29.866667-8.533333-42.666667z"
        fill="currentColor"
      />
    </svg>
  );
}

// The slide list (#slide-list-items) and its title field / count.
export function SlideList({
  model,
  asideToggle,
}: {
  model: EditorModel;
  asideToggle: React.ReactNode;
}) {
  const { slides, currentSectionId } = model;
  const current = slides.find((s) => s.section_id === currentSectionId) ?? null;
  const [titleDraft, setTitleDraft] = useState(current?.title || "");
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const itemsRef = useRef<HTMLDivElement>(null);

  // Like the legacy renderSlideList: every re-render syncs the field with the saved title.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sync on any list/selection change
  useEffect(() => {
    setTitleDraft(current?.title || "");
  }, [slides, currentSectionId]);

  // On mobile the slide list is a horizontal strip; keep the active slide's
  // chip visible. No-op on desktop, where the list doesn't scroll sideways.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run after each render of the list
  useEffect(() => {
    const items = itemsRef.current;
    const active = items?.querySelector<HTMLElement>(".slide-item.active");
    if (!items || !active || items.scrollWidth <= items.clientWidth) return;
    items.scrollLeft = active.offsetLeft - (items.clientWidth - active.offsetWidth) / 2;
  }, [slides, currentSectionId]);

  const commitTitle = () => void model.flushTitleSave();
  const onTitleChange = (value: string) => {
    setTitleDraft(value);
    model.queueTitleSave(value);
  };

  const onDrop = async (e: DragEvent, toId: string) => {
    e.preventDefault();
    setDragOver(null);
    const fromId = e.dataTransfer.getData("text/plain");
    if (fromId && fromId !== toId) await model.reorderTo(fromId, toId);
  };

  return (
    <>
      <div className="slide-list-meta">
        <div className="slide-list-meta-top">
          <h3>Slides</h3>
          <span className="slide-list-meta-right">
            <span className="slide-list-count" id="slide-list-count">
              {`${slides.length} slide${slides.length === 1 ? "" : "s"}`}
            </span>
            {asideToggle}
          </span>
        </div>
        <label className="slide-list-title-label">
          Title
          <input
            id="slide-list-title"
            className="slide-list-title-input"
            type="text"
            placeholder="Select a slide"
            autoComplete="off"
            value={titleDraft}
            onChange={(e) => onTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTitle();
                e.currentTarget.blur();
              }
            }}
            onBlur={commitTitle}
          />
        </label>
        <div className="slide-list-info" id="slide-list-info" />
      </div>
      <div id="slide-list-items" className="slide-list-items" ref={itemsRef}>
        {slides.map((s, i) => {
          const hidden = isSlideHiddenContent(s.content);
          const classes = [
            "slide-item",
            s.section_id === currentSectionId && "active",
            dragging === s.section_id && "dragging",
            dragOver === s.section_id && "drag-over",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            // biome-ignore lint/a11y/useKeyWithClickEvents: preserved legacy markup
            // biome-ignore lint/a11y/noStaticElementInteractions: preserved legacy markup
            <div
              key={s.section_id}
              className={classes}
              draggable="true"
              data-section-id={s.section_id}
              data-hidden={hidden ? "true" : "false"}
              onClick={(e) => {
                // Only switch slide if not clicking on an action button.
                if ((e.target as HTMLElement).closest(".slide-actions, details")) return;
                void model.switchSlide(s.section_id);
              }}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", s.section_id);
                e.dataTransfer.effectAllowed = "move";
                setDragging(s.section_id);
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOver(s.section_id);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => void onDrop(e, s.section_id)}
            >
              <span className="order">{i + 1}</span>
              <span className="title">
                {hidden && (
                  <>
                    <span className="hidden-slide-icon" title="Hidden in presentation">
                      <HiddenSlideIcon />
                    </span>{" "}
                  </>
                )}
                {s.title || s.section_id}
              </span>
              <span className="slide-actions">
                <details className="dropdown slide-dropdown" style={{ display: "inline-block" }}>
                  <summary
                    className="btn"
                    style={{ padding: "0 8px", minWidth: 32, textAlign: "center" }}
                  >
                    …
                  </summary>
                  <div className="dropdown-menu" style={{ minWidth: 80, right: 0, left: "auto" }}>
                    <ActionButton
                      className="slide-action-toggle-hidden"
                      sectionId={s.section_id}
                      onAct={() => model.setSlideHiddenState(s.section_id, !hidden)}
                    >
                      {hidden ? "Show" : "Hide"}
                    </ActionButton>
                    <ActionButton
                      className="slide-action-duplicate"
                      sectionId={s.section_id}
                      onAct={() => model.duplicateSlide(s.section_id)}
                    >
                      Duplicate
                    </ActionButton>
                    <ActionButton
                      className="slide-action-delete"
                      sectionId={s.section_id}
                      closeAfter
                      onAct={() => model.deleteSlideById(s.section_id)}
                    >
                      Delete
                    </ActionButton>
                  </div>
                </details>
              </span>
            </div>
          );
        })}
        <button type="button" id="add-slide" onClick={() => void model.addSlide()}>
          + New slide
        </button>
      </div>
    </>
  );
}

function ActionButton({
  className,
  sectionId,
  onAct,
  closeAfter = false,
  children,
}: {
  className: string;
  sectionId: string;
  onAct: () => Promise<void>;
  closeAfter?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      data-section-id={sectionId}
      onClick={async (e) => {
        e.stopPropagation();
        const details = e.currentTarget.closest("details");
        // Close the menu first so it doesn't linger over the result
        // (delete closes it after, like the legacy page).
        if (!closeAfter) details?.removeAttribute("open");
        await onAct();
        if (closeAfter) details?.removeAttribute("open");
      }}
    >
      {children}
    </button>
  );
}
