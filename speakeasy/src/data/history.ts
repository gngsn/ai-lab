// `slide_history`, `notes_history` and `frame_history` (port of
// public/js/repo/history-repo.js, same behavior).
// - `appendAuto*` insert one `kind='auto'` row, with content dedup against
//   the most recent row for that (deck, section) to avoid noise from
//   repeated saves of unchanged content.
// - `appendManualBatch` inserts one `kind='manual'` row per slide, note,
//   and frame, all sharing the same `created_at` + `message` so the snapshot
//   group is recoverable.
// - `listAllHistory` merges slide and notes streams by created_at desc and
//   tags each row with `_source` ('slide' | 'notes' | 'frame').
import { supabase } from "./client";
import type { HistoryRow, NoteRow, SlideRow } from "./types";

const SLIDE = "slide_history";
const NOTES = "notes_history";
const FRAME = "frame_history";
type HistoryTable = typeof SLIDE | typeof NOTES | typeof FRAME;

export type HistorySource = "slide" | "notes" | "frame";
export type HistoryEntry = HistoryRow & { _source: HistorySource };

export interface AutoRow {
  deck_id: string;
  section_id: string;
  content: string;
}

async function lastContent(table: HistoryTable, deckId: string, sectionId: string) {
  const { data, error } = await supabase
    .from(table)
    .select("content")
    .eq("deck_id", deckId)
    .eq("section_id", sectionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.content ?? null;
}

async function appendAuto(table: HistoryTable, { deck_id, section_id, content }: AutoRow) {
  const last = await lastContent(table, deck_id, section_id);
  if (last === content) return false;
  const { error } = await supabase
    .from(table)
    .insert({ deck_id, section_id, content, kind: "auto" });
  if (error) throw error;
  return true;
}

export const appendAutoSlide = (row: AutoRow) => appendAuto(SLIDE, row);
export const appendAutoNote = (row: AutoRow) => appendAuto(NOTES, row);

export async function appendAutoFrame({ deck_id, content }: { deck_id: string; content: string }) {
  const last = await lastContent(FRAME, deck_id, "frame");
  if (last === content) return false;
  const { error } = await supabase
    .from(FRAME)
    .insert({ deck_id, section_id: "frame", content, kind: "auto" });
  if (error) throw error;
  return true;
}

/**
 * Manual snapshot: insert one row per slide and per note, all tagged with
 * the same `message` and `created_at` for group identification.
 * Returns the shared timestamp.
 */
export async function appendManualBatch(
  deckId: string,
  message: string,
  slides: Pick<SlideRow, "section_id" | "content">[],
  notes: Pick<NoteRow, "section_id" | "content">[],
  frameHtml?: string,
) {
  const ts = new Date().toISOString();
  const slideRows = slides.map((s) => ({
    deck_id: deckId,
    section_id: s.section_id,
    content: s.content,
    kind: "manual" as const,
    message,
    created_at: ts,
  }));
  const noteRows = notes.map((n) => ({
    deck_id: deckId,
    section_id: n.section_id,
    content: n.content,
    kind: "manual" as const,
    message,
    created_at: ts,
  }));
  if (slideRows.length) {
    const { error } = await supabase.from(SLIDE).insert(slideRows);
    if (error) throw error;
  }
  if (noteRows.length) {
    const { error } = await supabase.from(NOTES).insert(noteRows);
    if (error) throw error;
  }

  if (frameHtml !== undefined) {
    const { error: frameError } = await supabase.from(FRAME).insert({
      deck_id: deckId,
      section_id: "frame",
      content: frameHtml,
      kind: "manual",
      message,
      created_at: ts,
    });
    if (frameError) throw frameError;
  }

  return ts;
}

export interface ListOptions {
  sectionId?: string;
  limit?: number;
}

async function listOne(
  table: HistoryTable,
  deckId: string,
  { sectionId, limit = 200 }: ListOptions = {},
) {
  let q = supabase.from(table).select("*").eq("deck_id", deckId);
  if (sectionId) q = q.eq("section_id", sectionId);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

const listSlideHistory = (deckId: string, opts?: ListOptions) => listOne(SLIDE, deckId, opts);
const listNotesHistory = (deckId: string, opts?: ListOptions) => listOne(NOTES, deckId, opts);
const listFrameHistory = (deckId: string) => listOne(FRAME, deckId, {});

export async function listAllHistory(
  deckId: string,
  opts: ListOptions = {},
): Promise<HistoryEntry[]> {
  const [s, n, f] = await Promise.all([
    listSlideHistory(deckId, opts),
    listNotesHistory(deckId, opts),
    listFrameHistory(deckId),
  ]);
  const merged: HistoryEntry[] = [
    ...s.map((r) => ({ ...r, _source: "slide" as const })),
    ...n.map((r) => ({ ...r, _source: "notes" as const })),
    ...f.map((r) => ({ ...r, _source: "frame" as const })),
  ];
  merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return merged;
}
