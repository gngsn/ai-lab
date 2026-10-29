// Realtime slide sync over a Supabase broadcast channel (port of
// public/js/sync.js, same channel name and payloads).
//   - channel name prefix: "speakeasy-sync-"
//   - payload: { section_id, index }. section_id is preferred; index is the
//     fallback so reordering a deck doesn't desync the script viewer.
//   - "hello" event: a follower that joins mid-talk asks for the current
//     slide (requestState); the presenter answers by re-broadcasting it
//     (onHello), so late joiners don't sit on slide 1.
// The legacy file made its own client because it ran inside a rewritten
// document where module identity could differ; here the app's one client is
// used.
import { getConfig } from "../config";
import { supabase } from "../data/client";

export type SlidePayload = { section_id?: string; index?: number } | null | undefined;
export type SyncStatus = string;

export type SlideSync = {
  broadcast: (payload: unknown) => Promise<unknown>;
  /** Ask the presenter to re-broadcast its current slide. */
  requestState: () => Promise<unknown>;
  close: () => unknown;
};

export function createSlideSync(
  syncId: string | null | undefined,
  onSlideChange?: (payload: SlidePayload) => void,
  onStatusChange?: (status: SyncStatus, err?: unknown) => void,
  { onHello }: { onHello?: () => void } = {},
): SlideSync | null {
  if (!syncId) return null;

  const { supabaseUrl, supabaseAnonKey } = getConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn("[sync] SUPABASE_URL / SUPABASE_ANON_KEY not configured");
    return null;
  }

  const channel = supabase.channel(`speakeasy-sync-${syncId}`, {
    config: { broadcast: { self: false } },
  });

  if (onSlideChange) {
    channel.on("broadcast", { event: "slide" }, ({ payload }) => {
      onSlideChange(payload as SlidePayload);
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
    broadcast: (payload) => channel.send({ type: "broadcast", event: "slide", payload }),
    requestState: () => channel.send({ type: "broadcast", event: "hello", payload: {} }),
    close: () => supabase.removeChannel(channel),
  };
}
