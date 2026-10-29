import { useCallback, useEffect, useState } from "react";
import { deleteDeck, listDecks } from "../../data/decks";
import { errorMessage } from "../../lib/errors";

export type DeckItem = Awaited<ReturnType<typeof listDecks>>[number];
export type DeckListStatus =
  | { kind: "checking" }
  | { kind: "ok"; count: number }
  | { kind: "error"; message: string };

/** The deck list, its connection status, and deleting a deck. */
export function useDecks() {
  const [decks, setDecks] = useState<DeckItem[] | null>(null);
  const [status, setStatus] = useState<DeckListStatus>({ kind: "checking" });
  /** A line appended to the status after a re-import; any reload clears it. */
  const [note, setNote] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setNote(null);
    try {
      const data = await listDecks();
      setDecks(data);
      setStatus({ kind: "ok", count: data.length });
    } catch (error) {
      console.error(error);
      setDecks([]);
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Asks first; on failure tells the user and leaves the deck. */
  const remove = useCallback(
    async (deck: DeckItem) => {
      const ok = confirm(
        `"${deck.title}" 덱을 삭제할까요?\n슬라이드, 노트, 히스토리, 이미지가 모두 삭제되며 되돌릴 수 없습니다.`,
      );
      if (!ok) return;
      setDeleting(deck.deck_id);
      try {
        await deleteDeck(deck.deck_id);
        await reload();
      } catch (error) {
        console.error(error);
        alert(`삭제 실패: ${errorMessage(error)}`);
      } finally {
        setDeleting(null);
      }
    },
    [reload],
  );

  return { decks, status, note, setNote, deleting, reload, remove };
}
