import { syncRoomFor } from "../../lib/sync-room";
import type { DeckItem } from "./useDecks";

const formatEditTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

type Props = {
  deck: DeckItem;
  deleting: boolean;
  onReimport: () => void;
  onDelete: () => void;
};

export function DeckItemRow({ deck, deleting, onReimport, onDelete }: Props) {
  const id = encodeURIComponent(deck.deck_id);
  const room = encodeURIComponent(syncRoomFor(deck.deck_id));
  return (
    <li className="deck-item">
      <div className="deck-row">
        <span className="deck-title" title={deck.deck_id}>
          {deck.title}
        </span>
        <time className="deck-time" dateTime={deck.updated_at}>
          {formatEditTime(deck.updated_at)}
        </time>
      </div>
      <div className="deck-row">
        <div className="deck-actions">
          <a className="md-btn md-secondary" href={`./edit.html?deck=${id}`}>
            Edit
          </a>
          <a className="md-btn md-secondary" href={`./pronunciation.html?deck=${id}`}>
            Practice
          </a>
          <a className="md-btn md-secondary" href={`./present.html?deck=${id}&sync=${room}`}>
            Present
          </a>
          <a className="md-btn md-secondary" href={`./script.html?deck=${id}&sync=${room}`}>
            Script
          </a>
          {deck.share_token && (
            <a
              href={`./view.html?deck=${id}&token=${encodeURIComponent(deck.share_token)}`}
              target="_blank"
              rel="noreferrer"
              className="md-btn"
            >
              Shared view ↗
            </a>
          )}
          <button
            className="md-btn md-secondary"
            type="button"
            data-reimport-deck={deck.deck_id}
            onClick={onReimport}
          >
            Re-import
          </button>
        </div>
        <button
          className="md-btn md-danger"
          type="button"
          data-delete-deck={deck.deck_id}
          disabled={deleting}
          onClick={onDelete}
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </li>
  );
}
