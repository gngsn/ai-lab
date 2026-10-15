/** The sync room is the deck ID unless the URL explicitly supplies one. */
export function syncRoomFor(deckId: string): string {
  return String(deckId);
}
