// Editor state shared by the editor's panels (slide list now; canvas, notes,
// assets, ... in the next P4-7 steps). A port of the state and mutations in
// the legacy public/js/edit-bootstrap.js.
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { upsertKeyMessage, upsert as upsertNote } from "../../data/notes";
import { deleteSlide, insertSlide, reorder, updateContent, updateMeta } from "../../data/slides";
import type { SlideRow } from "../../data/types";
import { setSlideHiddenContent } from "../../lib/slide-visibility";

export type EditSlide = Omit<SlideRow, "updated_at"> & { updated_at?: string };
type Chrome = {
  setStatus: (text: string, kind?: string) => void;
  toast: (message: string, kind?: string) => void;
};
type Flusher = () => Promise<void> | void;

const LAST_SECTION_KEY_PREFIX = "slidesEditor.lastSectionId:";
const newSectionId = () => `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export type EditorModel = ReturnType<typeof useEditorModel>;

export function useEditorModel({
  deckId,
  initialSlides,
  initialNotes,
  initialKeyMessages,
  canvasRef,
  chrome,
}: {
  deckId: string;
  initialSlides: EditSlide[];
  initialNotes: Map<string, string>;
  initialKeyMessages: Map<string, string>;
  canvasRef: RefObject<HTMLIFrameElement | null>;
  chrome: Chrome;
}) {
  const lastSectionKey = `${LAST_SECTION_KEY_PREFIX}${deckId}`;
  const [slides, setSlidesState] = useState(initialSlides);
  const slidesRef = useRef(slides);
  // sid → note text / key message, kept current by the mutations (like legacy).
  const notesRef = useRef(initialNotes);
  const keyMessagesRef = useRef(initialKeyMessages);
  const [currentSectionId, setCurrentState] = useState<string | null>(() => {
    const saved = localStorage.getItem(lastSectionKey);
    return saved && initialSlides.some((s) => s.section_id === saved)
      ? saved
      : (initialSlides[0]?.section_id ?? null);
  });
  const currentRef = useRef(currentSectionId);
  // The Present link only follows the slide on load and on a click in the list.
  const [navSectionId, setNavSectionId] = useState(currentSectionId);
  const flushers = useRef(new Set<Flusher>());
  const titlePending = useRef<{ sid: string; title: string } | null>(null);
  const titleTimer = useRef(0);

  const setSlides = useCallback((next: EditSlide[]) => {
    slidesRef.current = next;
    setSlidesState(next);
  }, []);
  const setCurrent = useCallback(
    (sid: string | null) => {
      currentRef.current = sid;
      setCurrentState(sid);
      if (!sid) return;
      try {
        localStorage.setItem(lastSectionKey, sid);
      } catch {}
    },
    [lastSectionKey],
  );
  useEffect(() => {
    // Remember the starting slide, as the legacy refresh() did.
    if (currentRef.current) {
      try {
        localStorage.setItem(lastSectionKey, currentRef.current);
      } catch {}
    }
  }, [lastSectionKey]);

  const showSlide = useCallback(
    (sid: string | null) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (!sid) {
        canvas.src = "about:blank";
        return;
      }
      canvas.src = `./edit-frame.html?deck=${encodeURIComponent(deckId)}&section=${encodeURIComponent(sid)}&edit=1`;
    },
    [canvasRef, deckId],
  );
  // The first slide is shown once the canvas exists.
  useEffect(() => {
    showSlide(currentRef.current);
  }, [showSlide]);

  const slideOf = (sid: string | null) =>
    slidesRef.current.find((s) => s.section_id === sid) ?? null;

  /** Panels register what must be saved before the slide changes (notes, html). */
  const registerFlusher = useCallback((fn: Flusher) => {
    flushers.current.add(fn);
    return () => {
      flushers.current.delete(fn);
    };
  }, []);

  // ── slide title (debounced) ──────────────────────────────────────
  const flushTitleSave = useCallback(async () => {
    if (!titlePending.current) return;
    window.clearTimeout(titleTimer.current);
    titleTimer.current = 0;
    const { sid, title } = titlePending.current;
    titlePending.current = null;
    try {
      await updateMeta(deckId, sid, { title });
      setSlides(slidesRef.current.map((s) => (s.section_id === sid ? { ...s, title } : s)));
      chrome.setStatus("title saved", "ok");
    } catch (err) {
      chrome.toast(`Title save failed: ${messageOf(err)}`, "err");
      chrome.setStatus("title save failed", "err");
    }
  }, [deckId, chrome, setSlides]);
  const queueTitleSave = (title: string) => {
    if (!currentRef.current) return;
    titlePending.current = { sid: currentRef.current, title };
    window.clearTimeout(titleTimer.current);
    chrome.setStatus("title: saving…");
    titleTimer.current = window.setTimeout(() => void flushTitleSave(), 600);
  };

  // ── selection ────────────────────────────────────────────────────
  // Flushes pending buffers so nothing is lost when moving away.
  const switchSlide = async (sid: string) => {
    if (sid === currentRef.current) return;
    await flushTitleSave();
    for (const flush of flushers.current) await flush();
    setCurrent(sid);
    showSlide(sid);
    setNavSectionId(sid);
  };

  // ── mutations ────────────────────────────────────────────────────
  const reorderTo = async (fromId: string, toId: string) => {
    const list = slidesRef.current;
    const fromIdx = list.findIndex((s) => s.section_id === fromId);
    const toIdx = list.findIndex((s) => s.section_id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const prev = list;
    const next = list.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved as EditSlide);
    // The RPC assigns order = index (0-based).
    setSlides(next.map((s, i) => ({ ...s, order: i })));
    try {
      await reorder(
        deckId,
        slidesRef.current.map((s) => s.section_id),
      );
      chrome.toast("Reordered", "ok");
    } catch (err) {
      setSlides(prev);
      chrome.toast(`Reorder failed: ${messageOf(err)}`, "err");
    }
  };

  const addSlide = async () => {
    const sid = newSectionId();
    const list = slidesRef.current;
    const order = list.length ? Math.max(...list.map((s) => s.order)) + 1 : 0;
    const content =
      `<section class="slide" data-title="Untitled">` +
      `<div><h1 data-editable="true">새 슬라이드</h1>` +
      `<p data-editable="true">내용을 입력하세요.</p></div>` +
      `</section>`;
    try {
      await insertSlide({ deck_id: deckId, section_id: sid, order, title: "Untitled", content });
      await upsertNote(deckId, sid, "");
      setSlides([
        ...slidesRef.current,
        { deck_id: deckId, section_id: sid, order, title: "Untitled", content },
      ]);
      notesRef.current.set(sid, "");
      setCurrent(sid);
      showSlide(sid);
      chrome.toast("Slide added", "ok");
    } catch (err) {
      chrome.toast(`Add failed: ${messageOf(err)}`, "err");
    }
  };

  // Duplicate a slide (content + notes), insert it right after the source,
  // then persist the new order.
  const duplicateSlide = async (sourceSid: string) => {
    const src = slideOf(sourceSid);
    if (!src) return;
    const list = slidesRef.current;
    const srcIdx = list.findIndex((s) => s.section_id === sourceSid);
    const newSid = newSectionId();
    const newTitle = `${src.title || "Untitled"} (copy)`;
    const newContent = src.content;
    const newNotes = notesRef.current.get(sourceSid) ?? "";
    const nextOrder = list.length ? Math.max(...list.map((s) => s.order ?? 0)) + 1 : 0;
    try {
      // 1. Insert at a fresh tail order so the UNIQUE (deck_id, order)
      //    constraint isn't violated by gaps from prior deletes/reorders.
      await insertSlide({
        deck_id: deckId,
        section_id: newSid,
        order: nextOrder,
        title: newTitle,
        content: newContent,
      });
      await upsertNote(deckId, newSid, newNotes);
      const newKeyMessage = keyMessagesRef.current.get(sourceSid) ?? "";
      if (newKeyMessage) await upsertKeyMessage(deckId, newSid, newKeyMessage);

      // 2. Splice into the right position locally.
      const spliced = slidesRef.current.slice();
      spliced.splice(srcIdx + 1, 0, {
        deck_id: deckId,
        section_id: newSid,
        order: srcIdx + 1,
        title: newTitle,
        content: newContent,
      });
      setSlides(spliced);
      notesRef.current.set(newSid, newNotes);
      keyMessagesRef.current.set(newSid, newKeyMessage);

      // 3. Persist that order on the server (single-transaction RPC).
      await reorder(
        deckId,
        spliced.map((s) => s.section_id),
      );
      setSlides(slidesRef.current.map((s, i) => ({ ...s, order: i })));

      setCurrent(newSid);
      showSlide(newSid);
      chrome.toast("Duplicated", "ok");
    } catch (err) {
      chrome.toast(`Duplicate failed: ${messageOf(err)}`, "err");
    }
  };

  const setSlideHiddenState = async (sectionId: string, hidden: boolean) => {
    const slide = slideOf(sectionId);
    if (!slide) return;
    const prevContent = slide.content;
    const nextContent = setSlideHiddenContent(prevContent, hidden);
    if (nextContent === prevContent) return;
    const patch = (content: string) =>
      setSlides(slidesRef.current.map((s) => (s.section_id === sectionId ? { ...s, content } : s)));
    try {
      patch(nextContent);
      await updateContent(deckId, sectionId, nextContent);
      showSlide(currentRef.current);
      chrome.toast(hidden ? "Slide hidden in presentation" : "Slide shown in presentation", "ok");
    } catch (err) {
      patch(prevContent);
      chrome.toast(`Visibility update failed: ${messageOf(err)}`, "err");
    }
  };

  const deleteSlideById = async (sectionId: string) => {
    const s = slideOf(sectionId);
    if (!s) return;
    if (!confirm(`Delete slide '${s.title || sectionId}'?`)) return;
    // Snapshot for rollback.
    const prevSlides = slidesRef.current;
    const prevNotes = new Map(notesRef.current);
    const prevCurrent = currentRef.current;
    try {
      await deleteSlide(deckId, sectionId);
      // Local splice — no refetch.
      const list = slidesRef.current.slice();
      const idx = list.findIndex((x) => x.section_id === sectionId);
      list.splice(idx, 1);
      setSlides(list);
      notesRef.current.delete(sectionId);
      if (currentRef.current === sectionId) {
        // Pick the adjacent slide: prefer the same index (next), fall back to previous.
        setCurrent(list[idx]?.section_id ?? list[idx - 1]?.section_id ?? null);
      }
      chrome.toast("Deleted", "ok");
    } catch (err) {
      // Rollback local state.
      setSlides(prevSlides);
      notesRef.current = prevNotes;
      setCurrent(prevCurrent);
      chrome.toast(`Delete failed: ${messageOf(err)}`, "err");
    }
  };

  return {
    slides,
    slidesRef,
    currentSectionId,
    navSectionId,
    notesRef,
    keyMessagesRef,
    registerFlusher,
    queueTitleSave,
    flushTitleSave,
    switchSlide,
    reorderTo,
    addSlide,
    duplicateSlide,
    setSlideHiddenState,
    deleteSlideById,
    showSlide,
  };
}
