// Live captions — the realtime channel between the caption console and the
// audience page. Its own channel (not the slide-sync one), so the feature
// can be removed without touching slide sync.
//
// Payload: { en, ko, mt } — `mt: true` when the English is a machine
// translation (the speaker went off script) rather than a reviewed line.
import { createClient } from "../../vendor/modules/supabase-client.mjs";

export function openCaptionChannel(room, { onCaption, onStatus } = {}) {
  const url = window.SUPABASE_URL;
  const key = window.SUPABASE_ANON_KEY;
  if (!room || !url || !key) return null;
  const supabase = createClient(url, key);
  const channel = supabase.channel(`speakeasy-captions-${room}`, {
    config: { broadcast: { self: false } },
  });
  if (onCaption) {
    channel.on("broadcast", { event: "caption" }, ({ payload }) =>
      onCaption(payload),
    );
  }
  channel.subscribe((status) => onStatus?.(status));
  return {
    send: (payload) =>
      channel.send({ type: "broadcast", event: "caption", payload }),
    close: () => supabase.removeChannel(channel),
  };
}
