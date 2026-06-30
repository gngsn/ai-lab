import type { RealtimePort, RealtimeChannel, SyncPayload } from '@ports/realtime-port';

/**
 * Cross-tab realtime via the BroadcastChannel API — vendor-neutral and serverless.
 * Reaches other tabs of the same origin (presenter + teleprompter on one machine).
 * The sender does not receive its own messages, matching the `{ self: false }` contract.
 */
export class BroadcastChannelRealtime implements RealtimePort {
  join(room: string, onMessage: (payload: SyncPayload) => void): RealtimeChannel {
    const channel = new BroadcastChannel(`slides-editor-sync-${room}`);
    channel.onmessage = (event: MessageEvent<SyncPayload>) => onMessage(event.data);
    return {
      broadcast: (payload) => channel.postMessage(payload),
      close: () => channel.close(),
    };
  }
}
