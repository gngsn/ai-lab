import type { Ports } from '@ports/ports';
import { env, type Backend } from './env';
import { createMemoryPorts } from '@adapters/memory';

/**
 * The composition root — the only module that imports adapters. It maps the
 * configured backend to a concrete Ports bundle. Adding a backend means adding
 * one case here; no other file changes.
 */
export function buildPorts(backend: Backend = env.backend): Ports {
  switch (backend) {
    case 'memory':
      return createMemoryPorts();
    case 'local':
      // Wired in Phase 1 (adapters/local/*).
      throw new Error("Backend 'local' is not implemented yet. Set VITE_BACKEND=memory.");
    case 'supabase':
      // Wired in Phase 1 (adapters/supabase/*).
      throw new Error("Backend 'supabase' is not implemented yet. Set VITE_BACKEND=memory.");
    default:
      throw new Error(`Unknown backend: ${backend as string}`);
  }
}
