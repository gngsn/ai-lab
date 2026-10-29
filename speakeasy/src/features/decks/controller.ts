// Deck list page: the deck list, the Import modal and the Re-import modal.
import { deleteDeck, getDeck, listDecks, upsertDeck } from "../../data/decks";
import { appendManualBatch } from "../../data/history";
import { listByDeck as listNotes, upsertKeyMessage, upsert as upsertNote } from "../../data/notes";
import { deleteByDeck, insertSlides, listByDeck as listSlides } from "../../data/slides";
import { uploadImportedAsset } from "../../data/storage";
import { parseImportedHtmlDeck, parseNotesMd, slugify } from "../../lib/import-html";
import type { RemoteMedia } from "../../lib/remote-source";

type RemoteSource = typeof import("../../lib/remote-source");

import { syncRoomFor } from "../../lib/sync-room";

// A chosen source: from a local file or a fetched URL.
type Source = { name?: string; load: () => Promise<string>; media?: RemoteMedia[] };
type Loaded = { source: Source; missing?: RemoteMedia[] };
type Part = {
  row: HTMLElement;
  file: HTMLInputElement;
  url: HTMLInputElement;
  state: HTMLElement;
  source: Source | null;
  pending: Promise<void> | null;
};
type KeyedSlide = { section_id: string; order: number };
type NoteBody = { body: string };

const TOKEN_KEY = "speakeasy:github-token";
const IMPORT_INTRO = {
  file:
    "Choose an HTML presentation file from your computer. It should " +
    "contain top-level <section> slides.",
  url:
    "Paste the URL of an HTML presentation — GitHub file links, raw " +
    "links, gists and GitHub Pages work. Linked images and video in " +
    "the same repo are copied into your storage.",
};

const escapeHtml = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
const formatEditTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

export async function mountDeckList(remote: RemoteSource): Promise<() => void> {
  const {
    fetchRemoteBlob,
    fetchRemoteText,
    findRepoMedia,
    makeSelfContained,
    nameFromUrl,
    remoteFileExists,
  } = remote;
  const controller = new AbortController();
  const { signal } = controller;

  const status = byId("status");
  const list = byId("deck-list");
  const importModalBg = byId("import-modal-bg");
  const importBtn = byId("import-html-btn");
  const importUrlBtn = byId("import-url-btn");
  const importModal = importModalBg.querySelector<HTMLElement>(".modal") as HTMLElement;
  const importModalTitle = byId("import-modal-title");
  const importCancelBtn = byId("import-cancel-btn");
  const importRunBtn = byId<HTMLButtonElement>("import-run-btn");
  const importFileInput = byId<HTMLInputElement>("import-file");
  const importDeckIdInput = byId<HTMLInputElement>("import-deck-id");
  const importTitleInput = byId<HTMLInputElement>("import-title");
  const importNotesInput = byId<HTMLInputElement>("import-notes-file");
  const importUrlInput = byId<HTMLInputElement>("import-url");
  const importUrlHint = byId("import-url-hint");
  const importNotesUrlInput = byId<HTMLInputElement>("import-notes-url");
  const importNotesUrlHint = byId("import-notes-url-hint");
  const importKmInput = byId<HTMLInputElement>("import-km-file");
  const importKmUrlInput = byId<HTMLInputElement>("import-km-url");
  const importKmUrlHint = byId("import-km-url-hint");
  const importTokenInput = byId<HTMLInputElement>("import-github-token");
  const importError = byId("import-error");
  try {
    importTokenInput.value = localStorage.getItem(TOKEN_KEY) || "";
  } catch {}
  // A token typed here wins; otherwise window.GITHUB_TOKEN from a local
  // js/config.local.js (local dev only — deployments never set it).
  const githubToken = () => importTokenInput.value.trim() || window.GITHUB_TOKEN || "";
  if (window.GITHUB_TOKEN) importTokenInput.placeholder = "using GITHUB_TOKEN from config";

  // Each source is { name, load }, from a local file or a fetched URL —
  // whichever the user picked last.
  let htmlSource: Source | null = null;
  let notesSource: Source | null = null;
  let kmSource: Source | null = null; // key messages: same Markdown format as the script
  // In-flight URL fetches; Import waits for them (clicking Import blurs the
  // URL field, which starts its fetch).
  let htmlUrlPending: Promise<void> | null = null;
  let notesUrlPending: Promise<void> | null = null;
  let kmUrlPending: Promise<void> | null = null;

  function setImportError(message = "") {
    if (!message) {
      importError.textContent = "";
      importError.style.display = "none";
      return;
    }
    importError.textContent = message;
    importError.style.display = "block";
  }

  // mode: "file" (local HTML + notes files) or "url" (GitHub/remote links).
  function openImportModal(mode: "file" | "url" = "file") {
    importModal.dataset.mode = mode;
    importModalTitle.textContent = mode === "url" ? "Import from GitHub" : "Import HTML deck";
    byId("import-intro").textContent = IMPORT_INTRO[mode];
    setImportError("");
    importDeckIdInput.value = "";
    importTitleInput.value = "";
    importNotesInput.value = "";
    importUrlInput.value = "";
    importNotesUrlInput.value = "";
    importUrlHint.textContent = "";
    importNotesUrlHint.textContent = "";
    importKmInput.value = "";
    importKmUrlInput.value = "";
    importKmUrlHint.textContent = "";
    kmSource = null;
    importModalBg.classList.add("show");
    importModalBg.setAttribute("aria-hidden", "false");
    importFileInput.value = "";
    htmlSource = null;
    notesSource = null;
  }

  function closeImportModal() {
    importModalBg.classList.remove("show");
    importModalBg.setAttribute("aria-hidden", "true");
    setImportError("");
  }

  async function adoptHtmlSource(source: Source) {
    htmlSource = source;
    const parsed = parseImportedHtmlDeck(await source.load(), {
      deckId: slugify(source.name),
    });
    if (!importDeckIdInput.value) importDeckIdInput.value = parsed.deckId;
    if (!importTitleInput.value) importTitleInput.value = parsed.title;
    return parsed;
  }

  async function handleImportFile(file: File) {
    importUrlInput.value = "";
    importUrlHint.textContent = "";
    await adoptHtmlSource({ name: file.name.replace(/\.[^.]+$/, ""), load: () => file.text() });
  }

  // Fetch a remote HTML deck, inline its stylesheets, and find the repo
  // files it links to (copied to storage on import). Missing ones are
  // reported up front so broken paths show before importing.
  async function loadRemoteHtml(value: string): Promise<Loaded> {
    const token = githubToken();
    const { text, url } = await fetchRemoteText(value, { token });
    const html = await makeSelfContained(text, url, { token });
    const media = findRepoMedia(html, url);
    const exists = await Promise.all(media.map((m) => remoteFileExists(m.url, { token })));
    return {
      source: {
        name: nameFromUrl(url),
        load: async () => html,
        media: media.filter((_, i) => exists[i]),
      },
      missing: media.filter((_, i) => !exists[i]),
    };
  }

  async function handleImportUrl(value: string) {
    importFileInput.value = "";
    importUrlHint.textContent = "Fetching…";
    const { source, missing = [] } = await loadRemoteHtml(value);
    const found = source.media ?? [];
    const parsed = await adoptHtmlSource(source);
    importUrlHint.textContent = [
      `✓ ${parsed.slides.length} slide(s) found`,
      found.length && `${found.length} linked file(s) will be copied`,
      missing.length &&
        `⚠ ${missing.length} linked file(s) not in the repo: ${missing
          .slice(0, 3)
          .map((m) => m.path.split("/").slice(-2).join("/"))
          .join(", ")}${missing.length > 3 ? `, +${missing.length - 3} more` : ""}`,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  async function handleImportKmFile(file: File) {
    importKmUrlInput.value = "";
    importKmUrlHint.textContent = "";
    kmSource = { name: file.name, load: () => file.text() };
  }

  async function handleImportKmUrl(value: string) {
    importKmInput.value = "";
    importKmUrlHint.textContent = "Fetching…";
    const { text, url } = await fetchRemoteText(value, { token: githubToken() });
    kmSource = { name: nameFromUrl(url), load: async () => text };
    importKmUrlHint.textContent = `✓ ${parseNotesMd(text).length} key message(s) found`;
  }

  // Write key messages to slides in order (parsed like the script).
  async function writeKeyMessages(
    deckId: string,
    orderedSlides: KeyedSlide[],
    keyMessages: NoteBody[],
    btn: HTMLElement,
  ) {
    btn.textContent = "Writing key messages…";
    for (const [i, slide] of orderedSlides.entries()) {
      await upsertKeyMessage(deckId, slide.section_id, keyMessages[i]?.body ?? "");
    }
  }

  async function handleImportNotesFile(file: File) {
    importNotesUrlInput.value = "";
    importNotesUrlHint.textContent = "";
    notesSource = { name: file.name, load: () => file.text() };
  }

  async function handleImportNotesUrl(value: string) {
    importNotesInput.value = "";
    importNotesUrlHint.textContent = "Fetching…";
    const { text, url } = await fetchRemoteText(value, { token: githubToken() });
    notesSource = { name: nameFromUrl(url), load: async () => text };
    importNotesUrlHint.textContent = `✓ ${parseNotesMd(text).length} note(s) found`;
  }

  // Copy a GitHub deck's repo images/video into storage and point the HTML at
  // the copies, so it does not depend on GitHub access.
  async function copyRepoMedia(
    html: string,
    deckId: string,
    media: RemoteMedia[] = [],
    btn: HTMLElement = importRunBtn,
  ) {
    let out = html;
    for (const [i, file] of media.entries()) {
      btn.textContent = `Copying files ${i + 1}/${media.length}…`;
      const blob = await fetchRemoteBlob(file.url, { token: githubToken() });
      const publicUrl = await uploadImportedAsset(deckId, file.path, blob);
      out = out.split(file.url).join(publicUrl);
    }
    return out;
  }

  async function runImport() {
    await Promise.all([htmlUrlPending, notesUrlPending, kmUrlPending]);
    if (!htmlSource) throw new Error("Choose an HTML file or enter its URL first.");
    let html = await htmlSource.load();
    const deckId = importDeckIdInput.value.trim() || slugify(htmlSource.name);
    if (!deckId) throw new Error("Deck ID is required.");
    const title = importTitleInput.value.trim() || undefined;
    let parsed = parseImportedHtmlDeck(html, { deckId, title });
    if (parsed.slides.length === 0) {
      throw new Error("No <section> slides found in the selected HTML.");
    }
    const notes = notesSource ? parseNotesMd(await notesSource.load()) : null;
    if (notes && notes.length !== parsed.slides.length) {
      console.warn(
        `[import] notes count mismatch — will import first ${Math.min(notes.length, parsed.slides.length)}`,
      );
    }
    const keyMessages = kmSource ? parseNotesMd(await kmSource.load()) : null;

    importRunBtn.disabled = true;
    importRunBtn.textContent = "Importing…";
    try {
      if (htmlSource.media?.length) {
        html = await copyRepoMedia(html, parsed.deckId, htmlSource.media);
        parsed = parseImportedHtmlDeck(html, { deckId, title });
      }
      importRunBtn.textContent = "Importing…";
      await upsertDeck({
        deck_id: parsed.deckId,
        title: parsed.title,
        frame_html: parsed.frameHtml,
      });
      await deleteByDeck(parsed.deckId);
      await insertSlides(parsed.slides.map((slide) => ({ ...slide, deck_id: parsed.deckId })));
      if (notes && notes.length > 0) {
        const n = Math.min(notes.length, parsed.slides.length);
        for (let i = 0; i < n; i++) {
          await upsertNote(
            parsed.deckId,
            (parsed.slides[i] as KeyedSlide).section_id,
            (notes[i] as NoteBody).body,
          );
        }
      }
      if (keyMessages?.length) {
        await writeKeyMessages(parsed.deckId, parsed.slides, keyMessages, importRunBtn);
      }
      closeImportModal();
      location.href = `./edit.html?deck=${encodeURIComponent(parsed.deckId)}`;
    } finally {
      importRunBtn.disabled = false;
      importRunBtn.textContent = "Import";
    }
  }

  // Replace an existing deck's slides (frame + all slides) and/or its script
  // (all notes) from new whole files. The deck ID and title stay, so links
  // keep working; whatever is replaced is saved to History first.
  const reimportBg = byId("reimport-modal-bg");
  const reimportTitle = byId("reimport-title");
  const reimportError = byId("reimport-error");
  const reimportCancel = byId<HTMLButtonElement>("reimport-cancel");
  const reimportRun = byId<HTMLButtonElement>("reimport-run");
  let reimportDeck: { id: string; title: string } | null = null;

  // One entry per part: its row, and what it'll be replaced with.
  const reimportParts: Record<string, Part> = {};
  for (const row of reimportBg.querySelectorAll<HTMLElement>(".reimport-part")) {
    reimportParts[row.dataset.part as string] = {
      row,
      file: row.querySelector('input[type="file"]') as HTMLInputElement,
      url: row.querySelector(".part-url") as HTMLInputElement,
      state: row.querySelector(".part-state") as HTMLElement,
      source: null, // once chosen
      pending: null, // in-flight URL fetch
    };
  }

  function setReimportError(message = "") {
    reimportError.textContent = message;
    reimportError.hidden = !message;
  }

  function updateReimportRun() {
    const names: Record<string, string> = {
      slides: "slides",
      script: "script",
      keys: "key messages",
    };
    const picked = Object.entries(reimportParts)
      .filter(([, part]) => part.source)
      .map(([name]) => names[name] as string);
    reimportRun.disabled = picked.length === 0;
    reimportRun.textContent =
      picked.length === 0
        ? "Replace"
        : picked.length === 1
          ? `Replace ${picked[0]}`
          : picked.length === 2
            ? `Replace ${picked.join(" + ")}`
            : "Replace all";
  }

  // state: "" (keep current), "busy", "ready" or "error".
  function setPartState(part: Part, state: string, text?: string) {
    part.row.dataset.state = state;
    part.state.replaceChildren();
    const label = document.createElement("span");
    label.textContent = text || "Keep current";
    label.title = label.textContent;
    part.state.append(label);
    if (state === "ready" || state === "error") {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "md-btn md-text part-clear";
      clear.textContent = "Clear";
      clear.addEventListener("click", () => resetPart(part));
      part.state.append(clear);
    }
    updateReimportRun();
  }

  function resetPart(part: Part) {
    part.source = null;
    part.pending = null;
    part.file.value = "";
    part.url.value = "";
    setPartState(part, "");
  }

  // Validate a chosen source right away so the row can say what it holds.
  async function pickPart(name: string, getSource: () => Promise<Loaded>, label: string) {
    const part = reimportParts[name] as Part;
    part.source = null;
    setPartState(part, "busy", "Reading…");
    setReimportError("");
    const pending = (async () => {
      const { source, missing = [] } = await getSource();
      const text = await source.load();
      let summary: string;
      if (name === "slides") {
        const parsed = parseImportedHtmlDeck(text, { deckId: reimportDeck?.id });
        if (!parsed.slides.length) throw new Error("No <section> slides found.");
        summary = plural(parsed.slides.length, "slide");
        if (source.media?.length) summary += ` · ${plural(source.media.length, "file")} to copy`;
        if (missing.length) summary += ` · ⚠ ${missing.length} missing`;
      } else {
        const notes = parseNotesMd(text);
        const what = name === "keys" ? "key message" : "note";
        if (!notes.length) throw new Error(`No ${what}s found.`);
        summary = plural(notes.length, what);
      }
      part.source = source;
      setPartState(part, "ready", `✓ ${label} — ${summary}`);
    })().catch((err: unknown) => {
      part.source = null;
      setPartState(part, "error", messageOf(err));
    });
    part.pending = pending;
    await pending;
  }

  for (const [name, part] of Object.entries(reimportParts)) {
    part.file.addEventListener("change", () => {
      const file = part.file.files?.[0];
      if (!file) return;
      part.url.value = "";
      void pickPart(name, async () => ({ source: { load: () => file.text() } }), file.name);
    });
    part.url.addEventListener("change", () => {
      const value = part.url.value.trim();
      if (!value) return resetPart(part);
      part.file.value = "";
      void pickPart(
        name,
        async () => {
          if (name === "slides") return loadRemoteHtml(value);
          const { text, url } = await fetchRemoteText(value, { token: githubToken() });
          return { source: { name: nameFromUrl(url), load: async () => text } };
        },
        nameFromUrl(value),
      );
    });
  }

  function openReimportModal(deck: { id: string; title: string }) {
    reimportDeck = deck;
    reimportTitle.textContent = deck.title;
    for (const part of Object.values(reimportParts)) resetPart(part);
    setReimportError("");
    reimportBg.classList.add("show");
    reimportBg.setAttribute("aria-hidden", "false");
  }

  function closeReimportModal() {
    reimportBg.classList.remove("show");
    reimportBg.setAttribute("aria-hidden", "true");
    reimportDeck = null;
  }

  async function runReimport() {
    const {
      slides: slidesPart,
      script: scriptPart,
      keys: keysPart,
    } = reimportParts as Record<"slides" | "script" | "keys", Part>;
    await Promise.all(Object.values(reimportParts).map((p) => p.pending));
    const current = reimportDeck as { id: string; title: string };
    const deckId = current.id;
    const htmlSrc = slidesPart.source;
    const notesSrc = scriptPart.source;
    const kmSrc = keysPart.source;
    if (!htmlSrc && !notesSrc && !kmSrc) {
      throw new Error("Choose at least one part to replace first.");
    }

    // Parse and validate everything before touching the database.
    let html = htmlSrc ? await htmlSrc.load() : null;
    let parsed = html ? parseImportedHtmlDeck(html, { deckId }) : null;
    if (parsed && parsed.slides.length === 0) {
      throw new Error("No <section> slides found in the new HTML.");
    }
    const newNotes = notesSrc ? parseNotesMd(await notesSrc.load()) : null;
    if (newNotes && newNotes.length === 0) throw new Error("No notes found in the new Markdown.");
    const newKeys = kmSrc ? parseNotesMd(await kmSrc.load()) : null;
    if (newKeys && newKeys.length === 0) {
      throw new Error("No key messages found in the new Markdown.");
    }

    reimportRun.disabled = true;
    reimportCancel.disabled = true;
    try {
      reimportRun.textContent = "Saving current version…";
      const [deck, slides, notes] = await Promise.all([
        getDeck(deckId),
        listSlides(deckId),
        listNotes(deckId),
      ]);
      // Snapshot only what this re-import replaces: slides + frame for new
      // slides, notes for a new script.
      await appendManualBatch(
        deckId,
        "Before re-import",
        parsed ? slides : [],
        newNotes ? notes : [],
        parsed ? deck.frame_html : undefined,
      );

      let finalSlides: KeyedSlide[] = slides;
      if (parsed && html && htmlSrc) {
        if (htmlSrc.media?.length) {
          html = await copyRepoMedia(html, deckId, htmlSrc.media, reimportRun);
          parsed = parseImportedHtmlDeck(html, { deckId });
        }
        reimportRun.textContent = "Replacing slides…";
        await upsertDeck({
          deck_id: deckId,
          title: deck.title || current.title || deckId,
          frame_html: parsed.frameHtml,
        });
        await deleteByDeck(deckId);
        await insertSlides(parsed.slides.map((slide) => ({ ...slide, deck_id: deckId })));
        finalSlides = parsed.slides;
      }

      if (newNotes) {
        // Whole-script replace, in slide order: slides past the end of the
        // script get empty notes.
        reimportRun.textContent = "Replacing script…";
        const ordered = [...finalSlides].sort((a, b) => a.order - b.order);
        for (const [i, slide] of ordered.entries()) {
          await upsertNote(deckId, slide.section_id, newNotes[i]?.body ?? "");
        }
      }

      if (newKeys) {
        // Same as the script: by slide order, extra slides get "".
        const ordered = [...finalSlides].sort((a, b) => a.order - b.order);
        await writeKeyMessages(deckId, ordered, newKeys, reimportRun);
      }

      closeReimportModal();
      const parts = [
        parsed && `${parsed.slides.length} slide(s)`,
        newNotes && `script (${newNotes.length} note(s))`,
        newKeys && `${newKeys.length} key message(s)`,
      ].filter(Boolean);
      await loadDecks();
      status.innerHTML += ` · <span class="ok">re-imported ${escapeHtml(deckId)}: ${escapeHtml(parts.join(" + "))}</span>`;
    } finally {
      reimportCancel.disabled = false;
      updateReimportRun();
    }
  }

  const on = (target: EventTarget, type: string, handler: (event: Event) => void) =>
    target.addEventListener(type, handler, { signal });

  reimportCancel.addEventListener("click", closeReimportModal);
  reimportBg.addEventListener("click", (e) => {
    if (e.target === reimportBg) closeReimportModal();
  });
  reimportRun.addEventListener("click", async () => {
    try {
      setReimportError("");
      await runReimport();
    } catch (err) {
      setReimportError(messageOf(err));
    }
  });
  on(document, "keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape" && reimportBg.classList.contains("show")) {
      closeReimportModal();
    }
  });

  importBtn.addEventListener("click", () => openImportModal("file"));
  importUrlBtn.addEventListener("click", () => openImportModal("url"));
  importCancelBtn.addEventListener("click", closeImportModal);
  importModalBg.addEventListener("click", (e) => {
    if (e.target === importModalBg) closeImportModal();
  });
  const bindFileInput = (input: HTMLInputElement, handle: (file: File) => Promise<void>) =>
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        setImportError("");
        await handle(file);
      } catch (err) {
        setImportError(messageOf(err));
      }
    });
  bindFileInput(importFileInput, handleImportFile);
  bindFileInput(importNotesInput, handleImportNotesFile);
  bindFileInput(importKmInput, handleImportKmFile);
  importTokenInput.addEventListener("change", () => {
    try {
      const token = githubToken();
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {}
    // Re-fetch any URL that may have failed for lack of a token.
    for (const input of [importUrlInput, importNotesUrlInput, importKmUrlInput]) {
      if (input.value.trim()) input.dispatchEvent(new Event("change"));
    }
  });
  function bindUrlInput(
    input: HTMLInputElement,
    hint: HTMLElement,
    handle: (value: string) => Promise<void>,
    setPending: (pending: Promise<void>) => void,
  ) {
    input.addEventListener("change", () => {
      const value = input.value.trim();
      if (!value) {
        hint.textContent = "";
        return;
      }
      setImportError("");
      const pending = handle(value).catch((err: unknown) => {
        hint.textContent = "";
        setImportError(messageOf(err));
      });
      setPending(pending);
    });
  }
  bindUrlInput(importUrlInput, importUrlHint, handleImportUrl, (p) => {
    htmlUrlPending = p;
  });
  bindUrlInput(importNotesUrlInput, importNotesUrlHint, handleImportNotesUrl, (p) => {
    notesUrlPending = p;
  });
  bindUrlInput(importKmUrlInput, importKmUrlHint, handleImportKmUrl, (p) => {
    kmUrlPending = p;
  });
  importRunBtn.addEventListener("click", async () => {
    try {
      setImportError("");
      await runImport();
    } catch (err) {
      setImportError(messageOf(err));
    }
  });

  type DeckItem = Awaited<ReturnType<typeof listDecks>>[number];
  function renderDeck(d: DeckItem) {
    const id = encodeURIComponent(d.deck_id);
    const room = encodeURIComponent(syncRoomFor(d.deck_id));
    const viewLink = d.share_token
      ? `<a href="./view.html?deck=${id}&token=${encodeURIComponent(d.share_token)}" target="_blank" class="md-btn">Shared view ↗</a>`
      : "";
    return (
      `<li class="deck-item">` +
      `<div class="deck-row">` +
      `<span class="deck-title" title="${escapeHtml(d.deck_id)}">${escapeHtml(d.title)}</span>` +
      `<time class="deck-time" datetime="${escapeHtml(d.updated_at)}">${formatEditTime(d.updated_at)}</time>` +
      `</div>` +
      `<div class="deck-row">` +
      `<div class="deck-actions">` +
      `<a class="md-btn md-secondary" href="./edit.html?deck=${id}">Edit</a>` +
      `<a class="md-btn md-secondary" href="./pronunciation.html?deck=${id}">Practice</a>` +
      `<a class="md-btn md-secondary" href="./present.html?deck=${id}&sync=${room}">Present</a>` +
      `<a class="md-btn md-secondary" href="./script.html?deck=${id}&sync=${room}">Script</a>` +
      viewLink +
      `<button class="md-btn md-secondary" type="button" data-reimport-deck="${escapeHtml(d.deck_id)}">Re-import</button>` +
      `</div>` +
      `<button class="md-btn md-danger" type="button" data-delete-deck="${escapeHtml(d.deck_id)}">Delete</button>` +
      `</div>` +
      `</li>`
    );
  }

  async function loadDecks() {
    try {
      const data = await listDecks();
      status.innerHTML = `<span class="ok">✓ connected</span> — ${data.length} deck(s)`;
      list.innerHTML = data.length
        ? data.map(renderDeck).join("")
        : "<li>(none — run <code>migrations/seed.sql</code> for a sample deck)</li>";
    } catch (err) {
      status.innerHTML = `<span class="bad">✗ ${escapeHtml(messageOf(err))}</span>`;
      list.innerHTML = "<li>—</li>";
      console.error(err);
    }
  }

  const titleOf = (btn: HTMLElement, fallback: string) =>
    btn.closest(".deck-item")?.querySelector(".deck-title")?.textContent || fallback;

  list.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-reimport-deck]");
    if (!btn) return;
    const id = btn.dataset.reimportDeck as string;
    openReimportModal({ id, title: titleOf(btn, id) });
  });

  list.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-delete-deck]");
    if (!btn) return;
    const deckId = btn.dataset.deleteDeck as string;
    const title = titleOf(btn, deckId);
    if (
      !confirm(
        `"${title}" 덱을 삭제할까요?\n슬라이드, 노트, 히스토리, 이미지가 모두 삭제되며 되돌릴 수 없습니다.`,
      )
    )
      return;
    btn.disabled = true;
    btn.textContent = "Deleting…";
    try {
      await deleteDeck(deckId);
      await loadDecks();
    } catch (err) {
      console.error(err);
      alert(`삭제 실패: ${messageOf(err)}`);
      btn.disabled = false;
      btn.textContent = "Delete";
    }
  });

  await loadDecks();
  return () => controller.abort();
}
