// Stand-in for the per-deck sync.js that decks in this format import with
// `import("./sync.js")` (relative to the page). In Speakeasy, present.html
// already syncs slides (js/sync.js), so the deck's own copy is a no-op —
// this only keeps that import from failing with a 404.
export function createSlideSync() {
  return { broadcast() {}, requestState() {}, close() {} };
}
