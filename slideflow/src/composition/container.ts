import type { Ports } from '@ports/ports';
import { env, type Backend } from './env';
import { notImplemented } from './not-implemented';
import { createMemoryPorts } from '@adapters/memory';
import { MemoryRealtime } from '@adapters/memory/memory-realtime';
import { MemoryAudioCache } from '@adapters/memory/memory-audio-cache';
import { DompurifySanitizer } from '@adapters/browser/dompurify-sanitizer';
import { LocalAuth } from '@adapters/local/local-auth';
import { createSupabaseClient } from '@adapters/supabase/supabase-client';
import { SupabaseAuth } from '@adapters/supabase/supabase-auth';

/**
 * The composition root — the only module that imports adapters. It maps the
 * configured backend to a concrete Ports bundle. Stores not yet built for a given
 * backend use `notImplemented` placeholders (filled in Phase 2+); browser-native
 * ports (sanitizer/audio) and realtime are wired now.
 */
export function buildPorts(backend: Backend = env.backend): Ports {
  switch (backend) {
    case 'memory':
      return createMemoryPorts();
    case 'local':
      return withAuth(new LocalAuth({ apiUrl: env.localApiUrl, jwtSecret: env.localJwtSecret }));
    case 'supabase':
      return withAuth(new SupabaseAuth(createSupabaseClient(env.supabaseUrl, env.supabaseAnonKey)));
    default:
      throw new Error(`Unknown backend: ${backend as string}`);
  }
}

/** Assemble a bundle around a real auth port; data stores arrive in later phases. */
function withAuth(auth: Ports['auth']): Ports {
  return {
    auth,
    deckStore: notImplemented('deckStore'),
    slideStore: notImplemented('slideStore'),
    notesStore: notImplemented('notesStore'),
    historyStore: notImplemented('historyStore'),
    blobStorage: notImplemented('blobStorage'),
    realtime: new MemoryRealtime(),
    shareRead: notImplemented('shareRead'),
    audioCache: new MemoryAudioCache(),
    sanitizer: new DompurifySanitizer(),
  };
}
