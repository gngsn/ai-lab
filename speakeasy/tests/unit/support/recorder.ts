// A fake Supabase client that records every query chain instead of running
// it. Each awaited chain becomes one "trace", e.g.
//   [["from", ["decks"]], ["select", ["*"]], ["eq", ["deck_id", "d"]], ["single", []]]
// and `respond(trace)` decides what the chain resolves to. Used to check that
// the TypeScript data layer issues exactly the queries the legacy one did.

export type Call = [method: string, args: unknown[]];
export type Respond = (trace: Call[]) => unknown;

export function createRecorder(respond: Respond) {
  const traces: Call[][] = [];

  // Anything chained off a query: records calls, resolves when awaited.
  const chain = (trace: Call[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop: string) {
          if (prop === "then") {
            traces.push(trace);
            const value = respond(trace);
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(value).then(resolve, reject);
          }
          return (...args: unknown[]) => chain([...trace, [prop, args]]);
        },
      },
    );

  const bucket = (name: string) =>
    new Proxy(
      {},
      {
        get(_target, prop: string) {
          if (prop === "getPublicUrl") {
            // synchronous in supabase-js
            return (path: string) => ({ data: { publicUrl: `https://fake.test/${name}/${path}` } });
          }
          return (...args: unknown[]) =>
            chain([
              ["storage.from", [name]],
              [prop, args],
            ]);
        },
      },
    );

  const client = {
    from: (table: string) => chain([["from", [table]]]),
    rpc: (name: string, args: unknown) => chain([["rpc", [name, args]]]),
    storage: { from: bucket },
  };

  return { client, traces };
}

/** Plausible rows for whatever the chain asks for. */
export const respondOk: Respond = (trace) => {
  const last = trace[trace.length - 1][0];
  const row = (n: number) => ({
    id: n,
    deck_id: "d1",
    section_id: `s${n}`,
    title: `T${n}`,
    content: `C${n}`,
    kind: "auto",
    message: null,
    created_at: `2026-01-0${n}T00:00:00Z`,
  });
  if (last === "single") return { data: row(1), error: null };
  if (last === "maybeSingle") return { data: { ...row(1), content: "same content" }, error: null };
  if (last === "list") {
    return {
      data: [
        {
          name: "1a-pic.png",
          id: "obj1",
          created_at: "2026-01-02T00:00:00Z",
          updated_at: "2026-01-03T00:00:00Z",
          metadata: { size: 5, mimetype: "image/png" },
        },
        { name: "sub", id: null, created_at: null, updated_at: null, metadata: null },
        { name: "s1", id: "obj2", created_at: "2026-01-01T00:00:00Z", metadata: { size: 9 } },
      ],
      error: null,
    };
  }
  if (last === "select" || last === "order" || last === "limit" || last === "eq") {
    return { data: [row(1), row(3), row(2)], error: null };
  }
  return { data: null, error: null };
};

export const respondError: Respond = () => ({ data: null, error: { message: "boom" } });
