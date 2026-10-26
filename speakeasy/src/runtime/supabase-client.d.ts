// The shape of the Supabase client the runtime modules import by URL
// (/vendor/modules/supabase-client.mjs is served as it is, not bundled).
type Channel = {
  on(
    type: string,
    filter: { event: string },
    callback: (message: { payload?: unknown }) => void,
  ): Channel;
  subscribe(callback: (status: string, err?: unknown) => void): Channel;
  send(message: { type: string; event: string; payload: unknown }): Promise<unknown>;
};
export function createClient(
  url: string,
  key: string,
  options?: unknown,
): {
  channel(name: string, options?: unknown): Channel;
  removeChannel(channel: Channel): unknown;
};
