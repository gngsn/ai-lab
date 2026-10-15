// Raw <section>…</section> editing for the current slide (the "html" mode):
// CodeMirror when the vendor script is loaded, a textarea with a highlight.js
// overlay otherwise. Port of the HTML-edit part of public/js/edit-bootstrap.js.
import { useCallback, useEffect, useRef } from "react";
import { updateContent } from "../../data/slides";
import { formatHtmlSource } from "../../lib/format-html";
import type { EditorModel } from "./model";

type CodeMirrorEditor = {
  getValue: () => string;
  setValue: (value: string) => void;
  refresh: () => void;
  focus: () => void;
  setSize: (width: string, height: string) => void;
  setOption: (name: string, value: unknown) => void;
  on: (event: string, handler: () => void) => void;
};
type CodeMirrorStatic = {
  fromTextArea: (ta: HTMLTextAreaElement, options: Record<string, unknown>) => CodeMirrorEditor;
};
type Hljs = {
  highlight: (
    code: string,
    options: { language: string; ignoreIllegals: boolean },
  ) => { value: string };
};
type VendorWindow = Window & { CodeMirror?: CodeMirrorStatic; hljs?: Hljs };

type Chrome = {
  setStatus: (text: string, kind?: string) => void;
  toast: (message: string, kind?: string) => void;
};

// Auto-save is persisted in localStorage; there is no toolbar control for it any more.
const autoSave = () => localStorage.getItem("slidesEditor.autoSave") !== "false";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useHtmlEditor({
  deckId,
  model,
  chrome,
}: {
  deckId: string;
  model: EditorModel;
  chrome: Chrome;
}) {
  const cm = useRef<CodeMirrorEditor | null>(null);
  const suppressSync = useRef(false);
  const pending = useRef<{ sid: string; content: string } | null>(null);
  const timer = useRef(0);
  const latest = useRef({ model, chrome });
  latest.current = { model, chrome };

  const textarea = () => document.getElementById("html-editor") as HTMLTextAreaElement | null;

  const getValue = () => cm.current?.getValue() ?? textarea()?.value ?? "";
  const setValue = (value: string) => {
    if (cm.current) {
      suppressSync.current = true;
      cm.current.setValue(value);
      cm.current.refresh();
      suppressSync.current = false;
      return;
    }
    const ta = textarea();
    if (ta) ta.value = value;
  };

  const updateHighlight = () => {
    if (cm.current) return;
    const ta = textarea();
    const hl = document.getElementById("html-highlight");
    if (!ta || !hl) return;
    const value = ta.value || "";
    const hljs = (window as VendorWindow).hljs;
    if (!value.trim()) {
      hl.textContent = value;
    } else if (hljs?.highlight) {
      try {
        hl.innerHTML = hljs.highlight(value, { language: "xml", ignoreIllegals: true }).value;
      } catch {
        hl.textContent = value;
      }
    } else {
      hl.textContent = value;
    }
    hl.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
  };

  const flush = useCallback(async () => {
    if (!pending.current) return;
    window.clearTimeout(timer.current);
    timer.current = 0;
    const { sid, content } = pending.current;
    pending.current = null;
    const { model: m, chrome: c } = latest.current;
    if (!/<section\b/i.test(content) || !/<\/section\s*>/i.test(content)) {
      c.setStatus("HTML missing <section>", "err");
      c.toast("HTML must contain a single <section>…</section> block.", "err");
      // Re-queue so the buffer isn't lost
      pending.current = { sid, content };
      return;
    }
    try {
      await updateContent(deckId, sid, content);
      // Update local cache — no refetch. Sync the title from data-title if present.
      const title = content.match(/data-title="([^"]*)"/i)?.[1];
      m.setSlides(
        m.slidesRef.current.map((s) =>
          s.section_id === sid ? { ...s, content, ...(title !== undefined ? { title } : {}) } : s,
        ),
      );
      c.setStatus(`HTML saved · ${new Date().toLocaleTimeString()}`, "ok");
    } catch (err) {
      c.setStatus("HTML save failed", "err");
      c.toast(`HTML save failed: ${messageOf(err)}`, "err");
    }
  }, [deckId]);

  const queueChange = (content: string) => {
    const sid = latest.current.model.currentRef.current;
    if (!sid) return;
    pending.current = { sid, content };
    window.clearTimeout(timer.current);
    if (autoSave()) {
      latest.current.chrome.setStatus("HTML: saving…");
      timer.current = window.setTimeout(() => void flush(), 800);
    } else {
      latest.current.chrome.setStatus("HTML: unsaved", "warn");
    }
    updateHighlight();
  };

  // Read the slide from the local cache — no network round-trip.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the helpers read refs only
  const load = useCallback(() => {
    const sid = latest.current.model.currentRef.current;
    if (!sid) {
      setValue("");
      updateHighlight();
      return;
    }
    const slide = latest.current.model.slidesRef.current.find((s) => s.section_id === sid);
    setValue(slide?.content ?? "");
    pending.current = null;
    updateHighlight();
  }, []);

  // CodeMirror themes are class-based, so follow the OS color scheme in JS.
  const ensure = () => {
    const vendor = (window as VendorWindow).CodeMirror;
    if (cm.current || !vendor) return cm.current;
    const ta = textarea();
    if (!ta) return null;
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const editor = vendor.fromTextArea(ta, {
      mode: "xml",
      theme: dark.matches ? "monokai" : "default",
      lineNumbers: true,
      lineWrapping: true,
      tabSize: 2,
      indentUnit: 2,
      indentWithTabs: false,
      viewportMargin: Number.POSITIVE_INFINITY,
      extraKeys: {
        "Cmd-Shift-F": () => format(),
        "Ctrl-Shift-F": () => format(),
      },
    });
    editor.setSize("100%", "100%");
    editor.on("change", () => {
      if (suppressSync.current) return;
      queueChange(editor.getValue());
    });
    dark.addEventListener("change", () =>
      editor.setOption("theme", dark.matches ? "monokai" : "default"),
    );
    cm.current = editor;
    return editor;
  };

  const format = () => {
    const ta = cm.current ?? textarea();
    if (!ta) return;
    const { chrome: c, model: m } = latest.current;
    const current = getValue();
    const formatted = formatHtmlSource(current);
    if (formatted === current) {
      c.toast("Already formatted", "ok");
      return;
    }
    setValue(formatted);
    pending.current = { sid: m.currentRef.current as string, content: formatted };
    updateHighlight();
    if (autoSave()) {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 0);
      c.setStatus("HTML: formatting…");
    } else {
      c.setStatus("HTML formatted · unsaved", "warn");
    }
    c.toast("HTML formatted", "ok");
  };

  const focus = () => {
    if (cm.current) cm.current.focus();
    else textarea()?.focus();
  };

  // Wiring: the textarea fallback, the highlight scroll sync, the flush on
  // slide switch / unload, and the hook the model calls to reload the slide.
  // biome-ignore lint/correctness/useExhaustiveDependencies: handlers read refs only
  useEffect(() => {
    model.htmlEditorRef.current = { load };
    const unregister = model.registerFlusher(flush);
    const ta = textarea();
    const onInput = () => {
      if (cm.current || !ta) return;
      queueChange(ta.value);
    };
    const onScroll = () => {
      const hl = document.getElementById("html-highlight");
      if (!cm.current && ta && hl) {
        hl.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
      }
    };
    const onBeforeUnload = () => {
      if (pending.current) void flush();
    };
    ta?.addEventListener("input", onInput);
    ta?.addEventListener("scroll", onScroll);
    window.addEventListener("beforeunload", onBeforeUnload);
    updateHighlight();
    return () => {
      unregister();
      ta?.removeEventListener("input", onInput);
      ta?.removeEventListener("scroll", onScroll);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [flush, load, model.htmlEditorRef, model.registerFlusher]);

  return { ensure, load, format, flush, focus };
}
