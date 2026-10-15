// Database types, written by hand from migrations/001–010 (generating them
// with `supabase gen types` needs access to the production database).
// Keep in sync with the migrations. Shaped like Supabase's generated
// `Database` so `createClient<Database>()` can use it. These are `type`
// aliases on purpose: Supabase's generics require `Record<string, unknown>`,
// which an `interface` does not satisfy (writes would type as `never`).

export type HistoryKind = "auto" | "manual";

// ── decks ─────────────────────────────────────────────────────────────
export type DeckRow = {
  deck_id: string;
  title: string;
  frame_html: string;
  share_token: string | null;
  owner_email: string | null;
  created_at: string;
  updated_at: string;
};
export type DeckInsert = Pick<DeckRow, "deck_id" | "frame_html"> &
  Partial<Omit<DeckRow, "deck_id" | "frame_html">>;
export type DeckUpdate = Partial<DeckRow>;

// ── slides ────────────────────────────────────────────────────────────
export type SlideRow = {
  deck_id: string;
  section_id: string;
  /** 0–200, unique per deck (deferrable constraint). */
  order: number;
  title: string;
  content: string;
  updated_at: string;
};
export type SlideInsert = Pick<SlideRow, "deck_id" | "section_id" | "order" | "content"> &
  Partial<Pick<SlideRow, "title" | "updated_at">>;
export type SlideUpdate = Partial<SlideRow>;

// ── notes (speaker notes + key message, one row per slide) ────────────
export type NoteRow = {
  deck_id: string;
  section_id: string;
  content: string;
  /** Added by migration 010. */
  key_message: string;
  updated_at: string;
};
export type NoteInsert = Pick<NoteRow, "deck_id" | "section_id"> &
  Partial<Pick<NoteRow, "content" | "key_message" | "updated_at">>;
export type NoteUpdate = Partial<NoteRow>;

// ── history (slide_history, notes_history, frame_history) ─────────────
export type HistoryRow = {
  id: number;
  deck_id: string;
  /** "frame" for frame_history rows. */
  section_id: string;
  content: string;
  kind: HistoryKind;
  message: string | null;
  created_at: string;
};
export type HistoryInsert = Pick<HistoryRow, "deck_id" | "content" | "kind"> &
  Partial<Pick<HistoryRow, "id" | "section_id" | "message" | "created_at">>;
export type HistoryUpdate = Partial<HistoryRow>;

type Table<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      decks: Table<DeckRow, DeckInsert, DeckUpdate>;
      slides: Table<SlideRow, SlideInsert, SlideUpdate>;
      notes: Table<NoteRow, NoteInsert, NoteUpdate>;
      slide_history: Table<HistoryRow, HistoryInsert, HistoryUpdate>;
      notes_history: Table<HistoryRow, HistoryInsert, HistoryUpdate>;
      frame_history: Table<HistoryRow, HistoryInsert, HistoryUpdate>;
    };
    Views: Record<string, never>;
    Functions: {
      /** migrations/004: renumber a deck's slides to the given order. */
      reorder_slides: {
        Args: { p_deck_id: string; p_section_ids: string[] };
        Returns: undefined;
      };
      /** migrations/007: delete a deck with its slides, notes and history. */
      delete_deck: {
        Args: { p_deck_id: string };
        Returns: undefined;
      };
      /** migrations/009: replace an asset URL in every slide and frame. */
      rename_asset_references: {
        Args: { p_old_url: string; p_new_url: string };
        Returns: { slides_updated: number; frames_updated: number }[];
      };
    };
    Enums: { history_kind: HistoryKind };
    CompositeTypes: Record<string, never>;
  };
};
