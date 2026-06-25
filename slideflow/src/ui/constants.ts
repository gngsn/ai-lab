/** Single source of truth for string keys — no magic strings scattered in features (PLAN §7). */

/** localStorage keys (SPEC §9.3). The `slidesEditor.*` prefix is kept for data continuity. */
export const StorageKeys = {
  theme: 'slidesEditor.theme',
  lastSectionId: (deckId: string) => `slidesEditor.lastSectionId:${deckId}`,
  slideListWidth: 'slidesEditor.slideListWidth',
  propsPanelWidth: 'slidesEditor.propsPanelWidth',
  propsPanelHeight: 'slidesEditor.propsPanelHeight',
  notesFontSize: 'slidesEditor.notesFontSize',
  autoSave: 'slidesEditor.autoSave',
} as const;

/** URL query params used across pages. */
export const QueryParams = {
  deck: 'deck',
  token: 'token',
  section: 'section',
  slide: 'slide',
  sync: 'sync',
  next: 'next',
  mode: 'mode',
  print: 'print',
} as const;

/** Realtime channel name for a sync room (SPEC §10.5). */
export const syncChannel = (room: string) => `slides-editor-sync-${room}`;

/** Storage bucket + app scheme for images (SPEC §8). */
export const IMAGE_BUCKET = 'slides-images';
