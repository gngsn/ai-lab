import type { DeckStorePort } from '@ports/deck-store-port';
import type { Deck, DeckInput } from '@core/model/deck';
import type { SupabaseClient } from './supabase-client';

interface DeckRow {
  deck_id: string;
  owner_id: string;
  owner_email: string | null;
  title: string;
  frame_html: string;
  share_token: string | null;
  created_at: string;
  updated_at: string;
}

const nowIso = () => new Date().toISOString();

export class SupabaseDeckStore implements DeckStorePort {
  constructor(private readonly sb: SupabaseClient) {}

  async listByOwner(ownerId: string): Promise<Deck[]> {
    const { data, error } = await this.sb
      .from('decks')
      .select('*')
      .eq('owner_id', ownerId)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as DeckRow[]).map(toDeck);
  }

  async get(deckId: string): Promise<Deck | null> {
    const { data, error } = await this.sb
      .from('decks')
      .select('*')
      .eq('deck_id', deckId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toDeck(data as DeckRow) : null;
  }

  async upsert(ownerId: string, ownerEmail: string | null, deck: DeckInput): Promise<void> {
    const { error } = await this.sb.from('decks').upsert({
      deck_id: deck.deckId,
      owner_id: ownerId,
      owner_email: ownerEmail,
      title: deck.title,
      frame_html: deck.frameHtml,
      updated_at: nowIso(),
    });
    if (error) throw new Error(error.message);
  }

  async updateTitle(deckId: string, title: string): Promise<void> {
    await this.patch(deckId, { title });
  }

  async updateFrame(deckId: string, frameHtml: string): Promise<void> {
    await this.patch(deckId, { frame_html: frameHtml });
  }

  async setShareToken(deckId: string, token: string | null): Promise<void> {
    await this.patch(deckId, { share_token: token });
  }

  async remove(deckId: string): Promise<void> {
    const { error } = await this.sb.from('decks').delete().eq('deck_id', deckId);
    if (error) throw new Error(error.message);
  }

  private async patch(deckId: string, fields: Partial<DeckRow>): Promise<void> {
    const { error } = await this.sb
      .from('decks')
      .update({ ...fields, updated_at: nowIso() })
      .eq('deck_id', deckId);
    if (error) throw new Error(error.message);
  }
}

function toDeck(row: DeckRow): Deck {
  return {
    deckId: row.deck_id,
    ownerId: row.owner_id,
    ownerEmail: row.owner_email,
    title: row.title,
    frameHtml: row.frame_html,
    shareToken: row.share_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
