/** The slide-change payload broadcast between presenter and followers (SPEC §10.5). */
export interface SyncPayload {
  section_id: string;
  index: number;
}

/** A live broadcast channel for one sync room. */
export interface RealtimeChannel {
  broadcast(payload: SyncPayload): void;
  close(): void;
}

/** Realtime transport. Implemented by Supabase broadcast or a local WebSocket adapter. */
export interface RealtimePort {
  /** Join `slides-editor-sync-<room>`; `onMessage` receives peers' payloads (not self). */
  join(room: string, onMessage: (payload: SyncPayload) => void): RealtimeChannel;
}
