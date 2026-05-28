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
