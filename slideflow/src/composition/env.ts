/** The only module that reads configuration. Everything else receives ports. */
export type Backend = 'memory' | 'local' | 'supabase';

export interface Env {
  backend: Backend;
  supabaseUrl: string;
  supabaseAnonKey: string;
  localApiUrl: string;
  localAuthUrl: string;
  localStorageUrl: string;
  localRealtimeUrl: string;
  pronunciationTts: string;
}

function read(key: string, fallback = ''): string {
  return (import.meta.env[key] as string | undefined) ?? fallback;
}

export const env: Env = {
  backend: (read('VITE_BACKEND', 'memory') as Backend) || 'memory',
  supabaseUrl: read('VITE_SUPABASE_URL'),
  supabaseAnonKey: read('VITE_SUPABASE_ANON_KEY'),
  localApiUrl: read('VITE_LOCAL_API_URL', 'http://localhost:3001'),
  localAuthUrl: read('VITE_LOCAL_AUTH_URL', 'http://localhost:3002'),
  localStorageUrl: read('VITE_LOCAL_STORAGE_URL', 'http://localhost:9000'),
  localRealtimeUrl: read('VITE_LOCAL_REALTIME_URL', 'ws://localhost:3003'),
  pronunciationTts: read('VITE_PRONUNCIATION_TTS', 'kokoro'),
};
