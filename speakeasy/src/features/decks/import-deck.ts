// Importing a deck from files or links, and re-importing parts of an existing one. No DOM: the
// modals pass what the user picked and get progress through `onProgress`.
import { getDeck, upsertDeck } from "../../data/decks";
import { appendManualBatch } from "../../data/history";
import { listByDeck as listNotes, upsertKeyMessage, upsert as upsertNote } from "../../data/notes";
import { deleteByDeck, insertSlides, listByDeck as listSlides } from "../../data/slides";
import { uploadImportedAsset } from "../../data/storage";
import { parseImportedHtmlDeck, parseNotesMd, slugify } from "../../lib/import-html";
import {
  fetchRemoteBlob,
  fetchRemoteText,
  findRepoMedia,
  makeSelfContained,
  nameFromUrl,
  type RemoteMedia,
  remoteFileExists,
} from "../../lib/remote-source";

/** A chosen source: a local file or a fetched URL. */
export type Source = { name?: string; load: () => Promise<string>; media?: RemoteMedia[] };
export type Loaded = { source: Source; missing?: RemoteMedia[] };
type Progress = (label: string) => void;
type Slide = { section_id: string; order: number };
type Note = { body: string };

export const fileSource = (file: File, name = file.name): Source => ({
  name,
  load: () => file.text(),
});

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Fetches a remote HTML deck, inlines its stylesheets and finds the repo files it links to (they
 *  are copied to storage on import). Missing ones are reported up front. */
export async function loadRemoteHtml(url: string, token: string): Promise<Loaded> {
  const { text, url: resolved } = await fetchRemoteText(url, { token });
  const html = await makeSelfContained(text, resolved, { token });
  const media = findRepoMedia(html, resolved);
  const exists = await Promise.all(media.map((m) => remoteFileExists(m.url, { token })));
  return {
    source: {
      name: nameFromUrl(resolved),
      load: async () => html,
      media: media.filter((_, i) => exists[i]),
    },
    missing: media.filter((_, i) => !exists[i]),
  };
}

/** Fetches a remote Markdown file (notes or key messages). */
export async function loadRemoteMarkdown(url: string, token: string): Promise<Source> {
  const { text, url: resolved } = await fetchRemoteText(url, { token });
  return { name: nameFromUrl(resolved), load: async () => text };
}

/** What the HTML link's hint says about what was found. */
export function describeRemoteHtml(slides: number, found: RemoteMedia[], missing: RemoteMedia[]) {
  const shortPath = (m: RemoteMedia) => m.path.split("/").slice(-2).join("/");
  return [
    `✓ ${slides} slide(s) found`,
    found.length && `${found.length} linked file(s) will be copied`,
    missing.length &&
      `⚠ ${missing.length} linked file(s) not in the repo: ${missing
        .slice(0, 3)
        .map(shortPath)
        .join(", ")}${missing.length > 3 ? `, +${missing.length - 3} more` : ""}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Copies a GitHub deck's repo images/video into storage and points the HTML at the copies, so it
 *  does not depend on GitHub access. */
async function copyRepoMedia(
  html: string,
  deckId: string,
  media: RemoteMedia[],
  token: string,
  onProgress: Progress,
) {
  let out = html;
  for (const [i, file] of media.entries()) {
    onProgress(`Copying files ${i + 1}/${media.length}…`);
    const blob = await fetchRemoteBlob(file.url, { token });
    const publicUrl = await uploadImportedAsset(deckId, file.path, blob);
    out = out.split(file.url).join(publicUrl);
  }
  return out;
}

/** Writes key messages to slides in order; slides past the end get an empty one. */
async function writeKeyMessages(
  deckId: string,
  slides: Slide[],
  keyMessages: Note[],
  onProgress: Progress,
) {
  onProgress("Writing key messages…");
  for (const [i, slide] of slides.entries()) {
    await upsertKeyMessage(deckId, slide.section_id, keyMessages[i]?.body ?? "");
  }
}

const inOrder = (slides: Slide[]) => [...slides].sort((a, b) => a.order - b.order);

export type ImportInput = {
  html: Source | null;
  notes: Source | null;
  keys: Source | null;
  deckId: string;
  title: string;
  token: string;
};

/** Imports a deck (replacing a deck with the same id) and returns its id. */
export async function importDeck(input: ImportInput, onProgress: Progress): Promise<string> {
  const { html: htmlSource, notes: notesSource, keys: keysSource, token } = input;
  if (!htmlSource) throw new Error("Choose an HTML file or enter its URL first.");
  let html = await htmlSource.load();
  const deckId = input.deckId.trim() || slugify(htmlSource.name);
  if (!deckId) throw new Error("Deck ID is required.");
  const title = input.title.trim() || undefined;
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
  const keyMessages = keysSource ? parseNotesMd(await keysSource.load()) : null;

  onProgress("Importing…");
  if (htmlSource.media?.length) {
    html = await copyRepoMedia(html, parsed.deckId, htmlSource.media, token, onProgress);
    parsed = parseImportedHtmlDeck(html, { deckId, title });
  }
  onProgress("Importing…");
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
        (parsed.slides[i] as Slide).section_id,
        (notes[i] as Note).body,
      );
    }
  }
  if (keyMessages?.length) {
    await writeKeyMessages(parsed.deckId, parsed.slides, keyMessages, onProgress);
  }
  return parsed.deckId;
}

export type PartName = "slides" | "script" | "keys";
export const PARTS: PartName[] = ["slides", "script", "keys"];
const PART_LABEL: Record<PartName, string> = {
  slides: "slides",
  script: "script",
  keys: "key messages",
};

/** The Replace button's text for the parts picked so far. */
export function replaceLabel(picked: PartName[]): string {
  if (picked.length === 0) return "Replace";
  if (picked.length === 3) return "Replace all";
  return `Replace ${picked.map((p) => PART_LABEL[p]).join(" + ")}`;
}

/** Reads a chosen source right away and says what it holds; throws when it holds nothing. */
export async function summarizePart(
  name: PartName,
  { source, missing = [] }: Loaded,
  deckId: string,
): Promise<string> {
  const text = await source.load();
  if (name === "slides") {
    const parsed = parseImportedHtmlDeck(text, { deckId });
    if (!parsed.slides.length) throw new Error("No <section> slides found.");
    let summary = plural(parsed.slides.length, "slide");
    if (source.media?.length) summary += ` · ${plural(source.media.length, "file")} to copy`;
    if (missing.length) summary += ` · ⚠ ${missing.length} missing`;
    return summary;
  }
  const notes = parseNotesMd(text);
  const what = name === "keys" ? "key message" : "note";
  if (!notes.length) throw new Error(`No ${what}s found.`);
  return plural(notes.length, what);
}

export type ReimportInput = {
  deck: { id: string; title: string };
  slides: Source | null;
  script: Source | null;
  keys: Source | null;
  token: string;
};

/** Replaces the picked parts of a deck (its id and title stay) after saving what is replaced to
 *  History. Returns the parts that were replaced, for the status line. */
export async function reimportDeck(input: ReimportInput, onProgress: Progress): Promise<string[]> {
  const { deck: current, slides: htmlSrc, script: notesSrc, keys: kmSrc, token } = input;
  const deckId = current.id;
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

  onProgress("Saving current version…");
  const [deck, slides, notes] = await Promise.all([
    getDeck(deckId),
    listSlides(deckId),
    listNotes(deckId),
  ]);
  // Snapshot only what this re-import replaces: slides + frame for new slides, notes for a new
  // script.
  await appendManualBatch(
    deckId,
    "Before re-import",
    parsed ? slides : [],
    newNotes ? notes : [],
    parsed ? deck.frame_html : undefined,
  );

  let finalSlides: Slide[] = slides;
  if (parsed && html && htmlSrc) {
    if (htmlSrc.media?.length) {
      html = await copyRepoMedia(html, deckId, htmlSrc.media, token, onProgress);
      parsed = parseImportedHtmlDeck(html, { deckId });
    }
    onProgress("Replacing slides…");
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
    // Whole-script replace, in slide order: slides past the end of the script get empty notes.
    onProgress("Replacing script…");
    for (const [i, slide] of inOrder(finalSlides).entries()) {
      await upsertNote(deckId, slide.section_id, newNotes[i]?.body ?? "");
    }
  }
  if (newKeys) {
    await writeKeyMessages(deckId, inOrder(finalSlides), newKeys, onProgress);
  }

  return [
    parsed && `${parsed.slides.length} slide(s)`,
    newNotes && `script (${newNotes.length} note(s))`,
    newKeys && `${newKeys.length} key message(s)`,
  ].filter((part): part is string => Boolean(part));
}
