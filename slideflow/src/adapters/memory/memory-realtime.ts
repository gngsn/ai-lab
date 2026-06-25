import type { RealtimePort, RealtimeChannel, SyncPayload } from '@ports/realtime-port';

type Listener = (payload: SyncPayload) => void;

/** Same-tab broadcast bus — useful for dev and tests; peers in other tabs are not reached. */
export class MemoryRealtime implements RealtimePort {
  private readonly rooms = new Map<string, Set<Listener>>();

  join(room: string, onMessage: Listener): RealtimeChannel {
    const listeners = this.rooms.get(room) ?? new Set<Listener>();
    listeners.add(onMessage);
    this.rooms.set(room, listeners);

    return {
      broadcast: (payload) => {
        for (const listener of listeners) {
          if (listener !== onMessage) listener(payload);
        }
      },
      close: () => {
        listeners.delete(onMessage);
        if (listeners.size === 0) this.rooms.delete(room);
      },
    };
  }
}
