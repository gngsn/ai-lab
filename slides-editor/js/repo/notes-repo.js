// Repo for the `notes` table.
import { supabase } from "../supabase.js";

export async function listByDeck(deckId) {
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("deck_id", deckId);
  if (error) throw error;
  return data;
}

export async function getOne(deckId, sectionId) {
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("deck_id", deckId)
    .eq("section_id", sectionId)
    .maybeSingle();
  if (error) throw error;
  return data; // null if no row
}

export async function upsert(deckId, sectionId, content) {
  const { error } = await supabase
    .from("notes")
    .upsert(
      { deck_id: deckId, section_id: sectionId, content },
      { onConflict: "deck_id,section_id" },
    );
  if (error) throw error;
}
