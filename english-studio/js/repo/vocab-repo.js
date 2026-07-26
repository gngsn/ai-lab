// Repo for the `vocab_lookups` table (persisted vocabulary lookups).
// Best-effort: Supabase is an optional shared/durable layer on top of the
// localStorage cache in vocabulary.js — every call here swallows errors so
// a missing table or offline Supabase never blocks a lookup.
import { supabase } from "../supabase.js";

// Returns the saved markdown for (word, engine), or null if none / on error.
export async function getVocabLookup(wordLower, engine) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("vocab_lookups")
      .select("markdown, model")
      .eq("word_lower", wordLower)
      .eq("engine", engine)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch (err) {
    console.warn("[vocab-repo] read failed:", err.message || err);
    return null;
  }
}

// Upsert (word, engine) -> markdown. Never throws.
export async function saveVocabLookup(wordLower, engine, markdown, model) {
  if (!supabase) return;
  try {
    const { error } = await supabase.from("vocab_lookups").upsert(
      {
        word_lower: wordLower,
        engine,
        model: model || null,
        markdown,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "word_lower,engine" },
    );
    if (error) throw error;
  } catch (err) {
    console.warn("[vocab-repo] save failed:", err.message || err);
  }
}
