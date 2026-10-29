import { useCallback, useRef, useState } from "react";
import { errorMessage } from "../../lib/errors";
import { parseImportedHtmlDeck, parseNotesMd, slugify } from "../../lib/import-html";
import {
  describeRemoteHtml,
  fileSource,
  importDeck,
  loadRemoteHtml,
  loadRemoteMarkdown,
  type Source,
} from "./import-deck";

export type ImportMode = "file" | "url";
type Field = "html" | "notes" | "keys";
type Texts = Record<Field, string>;

const TOKEN_KEY = "speakeasy:github-token";
const EMPTY: Texts = { html: "", notes: "", keys: "" };

const storedToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
};

/** The Import modal: what was picked (file or link, for the deck, notes and key messages), the
 *  hints and error shown, and running the import. */
export function useImportForm() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>("file");
  const [deckId, setDeckId] = useState("");
  const [title, setTitle] = useState("");
  const [urls, setUrls] = useState<Texts>(EMPTY);
  const [hints, setHints] = useState<Texts>(EMPTY);
  const [error, setError] = useState("");
  const [runLabel, setRunLabel] = useState<string | null>(null);
  const [token, setToken] = useState(storedToken);

  // What the user picked last for each source, and the URL fetches still in flight (Import waits
  // for them: clicking Import blurs the URL field, which starts its fetch).
  const sources = useRef<Record<Field, Source | null>>({ html: null, notes: null, keys: null });
  const pending = useRef<Record<Field, Promise<void> | null>>({
    html: null,
    notes: null,
    keys: null,
  });
  const fileInputs = useRef<Record<Field, HTMLInputElement | null>>({
    html: null,
    notes: null,
    keys: null,
  });

  // A token typed here wins; otherwise window.GITHUB_TOKEN from a local config.local.js (local
  // dev only — deployments never set it).
  const githubToken = useCallback(() => token.trim() || window.GITHUB_TOKEN || "", [token]);
  const setHint = (field: Field, text: string) => setHints((h) => ({ ...h, [field]: text }));
  const setUrl = (field: Field, text: string) => setUrls((u) => ({ ...u, [field]: text }));
  const clearFile = (field: Field) => {
    const input = fileInputs.current[field];
    if (input) input.value = "";
  };

  const reset = (next: ImportMode) => {
    setMode(next);
    setDeckId("");
    setTitle("");
    setUrls(EMPTY);
    setHints(EMPTY);
    setError("");
    for (const field of ["html", "notes", "keys"] as const) {
      clearFile(field);
      sources.current[field] = null;
    }
  };

  const adoptHtml = async (source: Source) => {
    sources.current.html = source;
    const parsed = parseImportedHtmlDeck(await source.load(), { deckId: slugify(source.name) });
    setDeckId((current) => current || parsed.deckId);
    setTitle((current) => current || parsed.title);
    return parsed;
  };

  const loaders: Record<Field, (value: string, tokenValue: string) => Promise<void>> = {
    async html(value, tokenValue) {
      clearFile("html");
      setHint("html", "Fetching…");
      const { source, missing = [] } = await loadRemoteHtml(value, tokenValue);
      const parsed = await adoptHtml(source);
      setHint("html", describeRemoteHtml(parsed.slides.length, source.media ?? [], missing));
    },
    async notes(value, tokenValue) {
      clearFile("notes");
      setHint("notes", "Fetching…");
      const source = await loadRemoteMarkdown(value, tokenValue);
      sources.current.notes = source;
      setHint("notes", `✓ ${parseNotesMd(await source.load()).length} note(s) found`);
    },
    async keys(value, tokenValue) {
      clearFile("keys");
      setHint("keys", "Fetching…");
      const source = await loadRemoteMarkdown(value, tokenValue);
      sources.current.keys = source;
      setHint("keys", `✓ ${parseNotesMd(await source.load()).length} key message(s) found`);
    },
  };

  /** A link was entered (the field lost focus with a new value): fetch it. */
  const commitUrl = (field: Field, value: string, tokenValue = githubToken()) => {
    const trimmed = value.trim();
    if (!trimmed) return setHint(field, "");
    setError("");
    pending.current[field] = loaders[field](trimmed, tokenValue).catch((err: unknown) => {
      setHint(field, "");
      setError(errorMessage(err));
    });
  };

  /** A file was chosen for a field: it replaces any link. */
  const chooseFile = async (field: Field, file: File) => {
    try {
      setError("");
      setUrl(field, "");
      setHint(field, "");
      if (field === "html") {
        await adoptHtml(fileSource(file, file.name.replace(/\.[^.]+$/, "")));
      } else {
        sources.current[field] = fileSource(file);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  /** The token field lost focus: remember it, and fetch again any link that may have failed for
   *  lack of a token. */
  const commitToken = (value: string) => {
    const effective = value.trim() || window.GITHUB_TOKEN || "";
    try {
      if (effective) localStorage.setItem(TOKEN_KEY, effective);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {}
    for (const field of ["html", "notes", "keys"] as const) {
      if (urls[field].trim()) commitUrl(field, urls[field], effective);
    }
  };

  const run = async () => {
    try {
      setError("");
      await Promise.all(Object.values(pending.current));
      const id = await importDeck(
        {
          html: sources.current.html,
          notes: sources.current.notes,
          keys: sources.current.keys,
          deckId,
          title,
          token: githubToken(),
        },
        setRunLabel,
      );
      setOpen(false);
      location.href = `./edit.html?deck=${encodeURIComponent(id)}`;
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunLabel(null);
    }
  };

  return {
    open,
    mode,
    deckId,
    title,
    urls,
    hints,
    error,
    runLabel,
    token,
    tokenFromConfig: Boolean(window.GITHUB_TOKEN),
    openAs: (next: ImportMode) => {
      reset(next);
      setOpen(true);
    },
    close: () => {
      setOpen(false);
      setError("");
    },
    setDeckId,
    setTitle,
    setUrl,
    setToken,
    fileInputRef: (field: Field) => (element: HTMLInputElement | null) => {
      fileInputs.current[field] = element;
    },
    chooseFile,
    commitUrl,
    commitToken,
    run,
  };
}
