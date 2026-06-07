// Repo for `slide_history`, `notes_history`, and `frame_history`.
// - `appendAuto*` insert one `kind='auto'` row, with content dedup against
//   the most recent row for that (deck, section) to avoid noise from
//   repeated saves of unchanged content.
// - `appendManualBatch` inserts one `kind='manual'` row per slide, note,
//   and frame, all sharing the same `created_at` + `message` so the snapshot
//   group is recoverable.
// - `listAllHistory` merges slide and notes streams by created_at desc and
//   tags each row with `_source` ('slide' | 'notes').

import { supabase } from "../supabase.js";

const SLIDE = "slide_history";
const NOTES = "notes_history";
const FRAME = "frame_history";

async function lastContent(table, deckId, sectionId) {
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

async function appendAuto(table, { deck_id, section_id, content }) {
  const last = await lastContent(table, deck_id, section_id);
  if (last === content) return false;
  const { error } = await supabase
    .from(table)
    .insert({ deck_id, section_id, content, kind: "auto" });
  if (error) throw error;
  return true;
}

export const appendAutoSlide = (row) => appendAuto(SLIDE, row);
export const appendAutoNote = (row) => appendAuto(NOTES, row);

export async function appendAutoFrame({ deck_id, content }) {
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
  deckId,
  message,
  slides,
  notes,
  frameHtml,
) {
  const ts = new Date().toISOString();
  const slideRows = slides.map((s) => ({
    deck_id: deckId,
    section_id: s.section_id,
    content: s.content,
    kind: "manual",
    message,
    created_at: ts,
  }));
  const noteRows = notes.map((n) => ({
    deck_id: deckId,
    section_id: n.section_id,
    content: n.content,
    kind: "manual",
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

async function listOne(table, deckId, { sectionId, limit = 200 } = {}) {
  let q = supabase.from(table).select("*").eq("deck_id", deckId);
  if (sectionId) q = q.eq("section_id", sectionId);
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export const listSlideHistory = (deckId, opts) => listOne(SLIDE, deckId, opts);
export const listNotesHistory = (deckId, opts) => listOne(NOTES, deckId, opts);
export const listFrameHistory = (deckId) => listOne(FRAME, deckId, {});

export async function listAllHistory(deckId, opts = {}) {
  const [s, n, f] = await Promise.all([
    listSlideHistory(deckId, opts),
    listNotesHistory(deckId, opts),
    listFrameHistory(deckId),
  ]);
  const merged = [
    ...s.map((r) => ({ ...r, _source: "slide" })),
    ...n.map((r) => ({ ...r, _source: "notes" })),
    ...listFrameHistoryRows(f),
  ];
  merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return merged;
}

function listFrameHistoryRows(frameRows) {
  return frameRows.map((r) => ({ ...r, _source: "frame" }));
}

export async function getRow(source, id) {
  const table = source === "slide" ? SLIDE : source === "notes" ? NOTES : FRAME;
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}
