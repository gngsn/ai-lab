// Live captions — the realtime channel between the caption console and the
// audience page. Bundled to /js/captions/channel.js. Its own channel (not the
// slide-sync one), so the feature can be removed without touching slide sync.
//
// Payload: { en, ko, mt } — `mt: true` when the English is a machine
// translation (the speaker went off script) rather than a reviewed line.
import { createClient } from "/vendor/modules/supabase-client.mjs";

export type CaptionPayload = { en?: string; ko?: string; mt?: boolean };
type Config = { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string };

export function openCaptionChannel(
  room: string | null | undefined,
  {
    onCaption,
    onStatus,
  }: {
    onCaption?: (payload?: CaptionPayload) => void;
    onStatus?: (status: string) => void;
  } = {},
) {
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: key } = window as unknown as Config;
  if (!room || !url || !key) return null;
  const supabase = createClient(url, key);
  const channel = supabase.channel(`speakeasy-captions-${room}`, {
    config: { broadcast: { self: false } },
  });
  if (onCaption) {
    channel.on("broadcast", { event: "caption" }, ({ payload }) =>
      onCaption(payload as CaptionPayload | undefined),
    );
  }
  channel.subscribe((status) => onStatus?.(status));
  return {
    send: (payload: CaptionPayload) =>
      channel.send({ type: "broadcast", event: "caption", payload }),
    close: () => supabase.removeChannel(channel),
  };
}
