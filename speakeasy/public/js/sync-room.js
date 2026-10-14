// The live-sync room a deck presents on. present.html broadcasts on it and
// script.html / share.html follow it, so every link to those pages must use
// the same room. The full deck ID keeps different decks from colliding
// (the old `r` + first-6-chars scheme put "slides" and "slides-v6" together).
export function syncRoomFor(deckId) {
  return String(deckId);
}
