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
    .select("deck_id,title,updated_at,share_token")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function updateTitle(deckId, title) {
  const { error } = await supabase
    .from("decks")
    .update({ title })
    .eq("deck_id", deckId);
  if (error) throw error;
}

export async function updateFrameHtml(deckId, frameHtml) {
  const { error } = await supabase
    .from("decks")
    .update({ frame_html: frameHtml })
    .eq("deck_id", deckId);
  if (error) throw error;
}

export async function upsertDeck(row) {
  const { error } = await supabase
    .from("decks")
    .upsert(row, { onConflict: "deck_id" });
  if (error) throw error;
}

/**
 * Set or clear the deck's share_token. Pass null to revoke sharing.
 * Token uniqueness is enforced by the table-level UNIQUE constraint.
 */
export async function setShareToken(deckId, token) {
  const { error } = await supabase
    .from("decks")
    .update({ share_token: token })
    .eq("deck_id", deckId);
  if (error) throw error;
}
