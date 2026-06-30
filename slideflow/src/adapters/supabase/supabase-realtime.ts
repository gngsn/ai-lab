import type { RealtimePort, RealtimeChannel, SyncPayload } from '@ports/realtime-port';
import type { SupabaseClient } from './supabase-client';

/** Cross-device realtime via Supabase broadcast (SPEC §10.5). */
export class SupabaseRealtime implements RealtimePort {
  constructor(private readonly sb: SupabaseClient) {}

  join(room: string, onMessage: (payload: SyncPayload) => void): RealtimeChannel {
    const channel = this.sb.channel(`slides-editor-sync-${room}`, {
      config: { broadcast: { self: false } },
    });
    channel
      .on('broadcast', { event: 'slide' }, ({ payload }) => onMessage(payload as SyncPayload))
      .subscribe();

    return {
      broadcast: (payload) => {
        void channel.send({ type: 'broadcast', event: 'slide', payload });
      },
      close: () => {
        void this.sb.removeChannel(channel);
      },
    };
  }
}
