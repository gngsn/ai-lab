// Repo for the `decks` table.
import { supabase } from "../supabase.js";

export async function getDeck(deckId) {
  const { data, error } = await supabase
    .from("decks")
    .select("*")
    .eq("deck_id", deckId)
    .single();
  if (error) throw error;
  return data;
}

export async function listDecks() {
  const { data, error } = await supabase
    .from("decks")
    .select("deck_id,title,updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}
