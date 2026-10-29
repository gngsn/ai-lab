// The `notes` table: speaker notes and the key message, one row per slide.
import { supabase } from "./client";
import * as history from "./history";
import type { NoteRow } from "./types";

export async function listByDeck(deckId: string): Promise<NoteRow[]> {
  const { data, error } = await supabase.from("notes").select("*").eq("deck_id", deckId);
  if (error) throw error;
  return data;
}

export async function getOne(deckId: string, sectionId: string): Promise<NoteRow | null> {
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("deck_id", deckId)
    .eq("section_id", sectionId)
    .maybeSingle();
  if (error) throw error;
  return data; // null if no row
}

export async function upsert(deckId: string, sectionId: string, content: string) {
  const { error } = await supabase
    .from("notes")
    .upsert(
      { deck_id: deckId, section_id: sectionId, content },
      { onConflict: "deck_id,section_id" },
    );
  if (error) throw error;
  // History append is best-effort.
  history
    .appendAutoNote({ deck_id: deckId, section_id: sectionId, content })
    .catch((err) => console.warn("[history] notes auto-append:", err));
}

// Key message lives on the same notes row; only that column is written, so
// the speaker notes are left as they are (and vice versa for upsert above).
export async function upsertKeyMessage(deckId: string, sectionId: string, keyMessage: string) {
  const { error } = await supabase
    .from("notes")
    .upsert(
      { deck_id: deckId, section_id: sectionId, key_message: keyMessage },
      { onConflict: "deck_id,section_id" },
    );
  if (error) {
    if (/key_message/.test(error.message || "")) {
      throw new Error("notes.key_message column missing — run migrations/010_key_message.sql");
    }
    throw error;
  }
}
