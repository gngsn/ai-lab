// Repo for the `slides` table.
import { supabase } from "../supabase.js";
import * as historyRepo from "./history-repo.js";

export async function listByDeck(deckId) {
  const { data, error } = await supabase
    .from("slides")
    .select("*")
    .eq("deck_id", deckId)
    .order("order", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getOne(deckId, sectionId) {
  const { data, error } = await supabase
    .from("slides")
    .select("*")
    .eq("deck_id", deckId)
    .eq("section_id", sectionId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateContent(deckId, sectionId, content) {
  const { error } = await supabase
    .from("slides")
    .update({ content })
    .eq("deck_id", deckId)
    .eq("section_id", sectionId);
  if (error) throw error;
  // History append is best-effort — never fail the save itself.
  historyRepo
    .appendAutoSlide({ deck_id: deckId, section_id: sectionId, content })
    .catch((err) => console.warn("[history] slide auto-append:", err));
}

export async function updateMeta(deckId, sectionId, { title } = {}) {
  const patch = {};
  if (title !== undefined) patch.title = title;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase
    .from("slides")
    .update(patch)
    .eq("deck_id", deckId)
    .eq("section_id", sectionId);
  if (error) throw error;
}

export async function insertSlide({
  deck_id,
  section_id,
  order,
  title,
  content,
}) {
  const { error } = await supabase
    .from("slides")
    .insert({ deck_id, section_id, order, title, content });
  if (error) throw error;
}

export async function deleteSlide(deckId, sectionId) {
  const { error } = await supabase
    .from("slides")
    .delete()
    .eq("deck_id", deckId)
    .eq("section_id", sectionId);
  if (error) throw error;
}

export async function deleteByDeck(deckId) {
  const { error } = await supabase
    .from("slides")
    .delete()
    .eq("deck_id", deckId);
  if (error) throw error;
}

export async function insertSlides(rows) {
  if (!rows.length) return;
  const { error } = await supabase.from("slides").insert(rows);
  if (error) throw error;
}

// RPC defined in migrations/004_rpc.sql. Single SQL transaction with the
// UNIQUE (deck_id, order) constraint deferred — no two-phase shuffle.
export async function reorder(deckId, sectionIdsInOrder) {
  const { error } = await supabase.rpc("reorder_slides", {
    p_deck_id: deckId,
    p_section_ids: sectionIdsInOrder,
  });
  if (error) throw error;
}
