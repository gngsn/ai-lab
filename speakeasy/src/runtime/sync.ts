// Slide sync for a deck document (present, view, share). Bundled to
// /js/sync.js. It makes its own Supabase client from the window globals, so it
// works inside the rewritten document where module identity differs from the
// app's. The app's own copy is src/lib/sync.ts; both use the same channel name
// and payloads:
//   - channel name prefix: "speakeasy-sync-"
//   - payload: { section_id, index } — section_id is preferred; index is the
//     fallback so reordering a deck doesn't desync the script viewer.
//   - "hello" event: a follower that joins mid-talk asks for the current
//     slide (requestState); the presenter answers by re-broadcasting it
//     (onHello), so late joiners don't sit on slide 1.
import { createClient } from "/vendor/modules/supabase-client.mjs";

type Config = { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string };

export function createSlideSync(
  syncId: string | null | undefined,
  onSlideChange?: (payload: unknown) => void,
  onStatusChange?: (status: string, err?: unknown) => void,
  { onHello }: { onHello?: () => void } = {},
) {
  if (!syncId) return null;

  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: key } = window as unknown as Config;
  if (!url || !key) {
    console.warn("[sync] SUPABASE_URL / SUPABASE_ANON_KEY not configured");
    return null;
  }

  const supabase = createClient(url, key);
  const channel = supabase.channel(`speakeasy-sync-${syncId}`, {
    config: { broadcast: { self: false } },
  });

  if (onSlideChange) {
    channel.on("broadcast", { event: "slide" }, ({ payload }) => {
      onSlideChange(payload);
    });
  }
  if (onHello) {
    channel.on("broadcast", { event: "hello" }, () => onHello());
  }
  channel.subscribe((status, err) => {
    console.info("[sync]", syncId, status, err || "");
    onStatusChange?.(status, err);
  });

  return {
    broadcast: (payload: unknown) => channel.send({ type: "broadcast", event: "slide", payload }),
    // Ask the presenter to re-broadcast its current slide.
    requestState: () => channel.send({ type: "broadcast", event: "hello", payload: {} }),
    close: () => supabase.removeChannel(channel),
  };
}
