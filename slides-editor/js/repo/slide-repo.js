// Repo for the `slides` table.
import { supabase } from "../supabase.js";

export async function listByDeck(deckId) {
  const { data, error } = await supabase
    .from("slides")
    .select("*")
    .eq("deck_id", deckId)
    .order("order", { ascending: true });
  if (error) throw error;
  return data;
}
