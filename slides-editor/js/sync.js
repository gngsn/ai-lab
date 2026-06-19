// Port of personal-log/Kprintf2026/v5/sync.js.
// Differences:
//   - channel name prefix: "slides-editor-sync-"
//   - payload: { section_id, index } — section_id is preferred; index is fallback
//     so reordering a deck doesn't desync the script viewer.
// Standalone: creates its own Supabase client so it works inside the rewritten
// `present.html` document where module identity may differ.
import { createClient } from "../vendor/modules/supabase-client.mjs";

export function createSlideSync(syncId, onSlideChange, onStatusChange) {
  if (!syncId) return null;

  const url = window.SUPABASE_URL;
  const key = window.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.warn("[sync] SUPABASE_URL / SUPABASE_ANON_KEY not configured");
    return null;
  }

  const supabase = createClient(url, key);
  const channel = supabase.channel(`slides-editor-sync-${syncId}`, {
    config: { broadcast: { self: false } },
  });

  if (onSlideChange) {
    channel.on("broadcast", { event: "slide" }, ({ payload }) => {
      onSlideChange(payload);
    });
  }
  channel.subscribe((status, err) => {
    console.info("[sync]", syncId, status, err || "");
    onStatusChange?.(status, err);
  });

  return {
    broadcast: (payload) =>
      channel.send({ type: "broadcast", event: "slide", payload }),
    close: () => supabase.removeChannel(channel),
  };
}
