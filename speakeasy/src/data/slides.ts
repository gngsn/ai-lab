// The `slides` table (port of public/js/repo/slide-repo.js, same behavior).
import { supabase } from "./client";
import * as history from "./history";
import type { SlideInsert, SlideRow, SlideUpdate } from "./types";

export async function listByDeck(deckId: string): Promise<SlideRow[]> {
  const { data, error } = await supabase
    .from("slides")
    .select("*")
    .eq("deck_id", deckId)
    .order("order", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getOne(deckId: string, sectionId: string): Promise<SlideRow> {
  const { data, error } = await supabase
    .from("slides")
    .select("*")
    .eq("deck_id", deckId)
    .eq("section_id", sectionId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateContent(deckId: string, sectionId: string, content: string) {
  const { error } = await supabase
    .from("slides")
    .update({ content })
    .eq("deck_id", deckId)
    .eq("section_id", sectionId);
  if (error) throw error;
  // History append is best-effort — never fail the save itself.
  history
    .appendAutoSlide({ deck_id: deckId, section_id: sectionId, content })
    .catch((err) => console.warn("[history] slide auto-append:", err));
}

export async function updateMeta(
  deckId: string,
  sectionId: string,
  { title }: { title?: string } = {},
) {
  const patch: SlideUpdate = {};
  if (title !== undefined) patch.title = title;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase
    .from("slides")
    .update(patch)
    .eq("deck_id", deckId)
    .eq("section_id", sectionId);
  if (error) throw error;
}

export async function insertSlide({ deck_id, section_id, order, title, content }: SlideInsert) {
  const { error } = await supabase
    .from("slides")
    .insert({ deck_id, section_id, order, title, content });
  if (error) throw error;
}

export async function deleteSlide(deckId: string, sectionId: string) {
  const { error } = await supabase
    .from("slides")
    .delete()
    .eq("deck_id", deckId)
    .eq("section_id", sectionId);
  if (error) throw error;
}

export async function deleteByDeck(deckId: string) {
  const { error } = await supabase.from("slides").delete().eq("deck_id", deckId);
  if (error) throw error;
}

export async function insertSlides(rows: SlideInsert[]) {
  if (!rows.length) return;
  const { error } = await supabase.from("slides").insert(rows);
  if (error) throw error;
}

// RPC defined in migrations/004_rpc.sql. Single SQL transaction with the
// UNIQUE (deck_id, order) constraint deferred — no two-phase shuffle.
export async function reorder(deckId: string, sectionIdsInOrder: string[]) {
  const { error } = await supabase.rpc("reorder_slides", {
    p_deck_id: deckId,
    p_section_ids: sectionIdsInOrder,
  });
  if (error) throw error;
}
