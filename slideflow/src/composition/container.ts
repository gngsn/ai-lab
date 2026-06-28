import type { Ports } from '@ports/ports';
import { env, type Backend } from './env';
import { notImplemented } from './not-implemented';
import { createMemoryPorts } from '@adapters/memory';
import { MemoryRealtime } from '@adapters/memory/memory-realtime';
import { MemoryAudioCache } from '@adapters/memory/memory-audio-cache';
import { DompurifySanitizer } from '@adapters/browser/dompurify-sanitizer';
import { RestClient } from '@adapters/local/rest-client';
import { LocalAuth } from '@adapters/local/local-auth';
import { LocalDeckStore } from '@adapters/local/local-deck-store';
import { LocalSlideStore } from '@adapters/local/local-slide-store';
import { LocalNotesStore } from '@adapters/local/local-notes-store';
import { createSupabaseClient } from '@adapters/supabase/supabase-client';
import { SupabaseAuth } from '@adapters/supabase/supabase-auth';
import { SupabaseDeckStore } from '@adapters/supabase/supabase-deck-store';
import { SupabaseSlideStore } from '@adapters/supabase/supabase-slide-store';
import { SupabaseNotesStore } from '@adapters/supabase/supabase-notes-store';

/**
 * The composition root — the only module that imports adapters. It maps the
 * configured backend to a concrete Ports bundle. Ports not yet built for a phase
 * use `notImplemented` placeholders; they are replaced as later phases land.
 */
export function buildPorts(backend: Backend = env.backend): Ports {
  switch (backend) {
    case 'memory':
      return createMemoryPorts();
    case 'local':
      return buildLocalPorts();
    case 'supabase':
      return buildSupabasePorts();
    default:
      throw new Error(`Unknown backend: ${backend as string}`);
  }
}

function buildLocalPorts(): Ports {
  const auth = new LocalAuth({ apiUrl: env.localApiUrl, jwtSecret: env.localJwtSecret });
  const rest = new RestClient({ baseUrl: env.localApiUrl, getToken: () => auth.currentToken() });
  return {
    auth,
    deckStore: new LocalDeckStore(rest),
    slideStore: new LocalSlideStore(rest),
    notesStore: new LocalNotesStore(rest),
    historyStore: notImplemented('historyStore'), // Phase 5
    blobStorage: notImplemented('blobStorage'), // Phase 5
    realtime: new MemoryRealtime(), // Phase 4 → local WebSocket
    shareRead: notImplemented('shareRead'), // Phase 4
    audioCache: new MemoryAudioCache(), // Phase 7 → IndexedDB
    sanitizer: new DompurifySanitizer(),
  };
}

function buildSupabasePorts(): Ports {
  const sb = createSupabaseClient(env.supabaseUrl, env.supabaseAnonKey);
  return {
    auth: new SupabaseAuth(sb),
    deckStore: new SupabaseDeckStore(sb),
    slideStore: new SupabaseSlideStore(sb),
    notesStore: new SupabaseNotesStore(sb),
    historyStore: notImplemented('historyStore'), // Phase 5
    blobStorage: notImplemented('blobStorage'), // Phase 5
    realtime: new MemoryRealtime(), // Phase 4 → Supabase broadcast
    shareRead: notImplemented('shareRead'), // Phase 4
    audioCache: new MemoryAudioCache(), // Phase 7 → IndexedDB
    sanitizer: new DompurifySanitizer(),
  };
}
