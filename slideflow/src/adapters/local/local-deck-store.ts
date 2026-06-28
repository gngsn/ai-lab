import type { DeckStorePort } from '@ports/deck-store-port';
import type { Deck, DeckInput } from '@core/model/deck';
import type { RestClient } from './rest-client';

/** PostgREST row shape for the `decks` table (snake_case). */
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

export class LocalDeckStore implements DeckStorePort {
  constructor(private readonly rest: RestClient) {}

  async listByOwner(ownerId: string): Promise<Deck[]> {
    const rows = await this.rest.get<DeckRow[]>(
      '/decks',
      `owner_id=eq.${ownerId}&order=updated_at.desc`,
    );
    return rows.map(toDeck);
  }

  async get(deckId: string): Promise<Deck | null> {
    const rows = await this.rest.get<DeckRow[]>('/decks', `deck_id=eq.${deckId}&limit=1`);
    return rows[0] ? toDeck(rows[0]) : null;
  }

  async upsert(ownerId: string, ownerEmail: string | null, deck: DeckInput): Promise<void> {
    await this.rest.post(
      '/decks',
      {
        deck_id: deck.deckId,
        owner_id: ownerId,
        owner_email: ownerEmail,
        title: deck.title,
        frame_html: deck.frameHtml,
        updated_at: nowIso(),
      },
      'resolution=merge-duplicates,return=minimal',
    );
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
    await this.rest.delete('/decks', `deck_id=eq.${deckId}`);
  }

  private patch(deckId: string, fields: Partial<DeckRow>): Promise<unknown> {
    return this.rest.patch('/decks', `deck_id=eq.${deckId}`, { ...fields, updated_at: nowIso() });
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
