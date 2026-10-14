// Fake `createClient` served in place of vendor/modules/supabase-client.mjs
// during e2e tests (see tests/support/app.ts). It implements only what the
// app calls: table queries, the three RPCs, storage, and realtime broadcast.
//
// Data lives in localStorage["__fakedb"] / ["__fakestorage"] so every page
// and frame of one browser context sees the same rows. Each operation reads
// the latest state, so writes made in one tab show up in another.
// Realtime broadcast uses BroadcastChannel (same browser context only),
// which, like `broadcast: { self: false }`, never echoes to the sender.

const DB_KEY = "__fakedb";
const STORAGE_KEY = "__fakestorage";
const PUBLIC_BASE = "https://fake.supabase.test/storage/v1/object/public";

const HISTORY = new Set(["slide_history", "notes_history", "frame_history"]);
const DEFAULTS = {
  decks: () => ({ title: "Untitled", share_token: null, owner_email: null }),
  slides: () => ({ title: "Untitled" }),
  notes: () => ({ content: "", key_message: "" }),
};
const KEYS = {
  decks: ["deck_id"],
  slides: ["deck_id", "section_id"],
  notes: ["deck_id", "section_id"],
};

const now = () => new Date().toISOString();
const load = (key) => JSON.parse(localStorage.getItem(key) || "{}");
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const table = (db, name) => (db[name] ||= []);
const sameKey = (name, a, b, cols = KEYS[name]) =>
  cols && cols.every((c) => a[c] === b[c]);

function newRow(name, values) {
  const row = { ...(DEFAULTS[name]?.() || {}), ...values };
  row.updated_at = now();
  if (HISTORY.has(name)) {
    row.id ??= crypto.randomUUID();
    row.created_at ??= now();
  }
  if (name === "decks") row.created_at ??= now();
  return row;
}

function query(name) {
  const filters = [];
  let action = { kind: "select" };
  let orderBy = null;
  let limitTo = null;
  let single = null; // "single" | "maybe"

  const matches = (row) => filters.every(([k, v]) => row[k] === v);

  function run() {
    const db = load(DB_KEY);
    const rows = table(db, name);
    let data = null;

    if (action.kind === "select") {
      data = rows.filter(matches);
      if (orderBy) {
        const { col, asc } = orderBy;
        data.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
      }
      if (limitTo != null) data = data.slice(0, limitTo);
    } else if (action.kind === "insert") {
      for (const values of [].concat(action.values)) {
        if (KEYS[name] && rows.some((r) => sameKey(name, r, values))) {
          return { data: null, error: { message: `duplicate key value violates unique constraint on ${name}` } };
        }
        rows.push(newRow(name, values));
      }
      save(DB_KEY, db);
    } else if (action.kind === "upsert") {
      const cols = action.onConflict ? action.onConflict.split(",") : KEYS[name];
      for (const values of [].concat(action.values)) {
        const existing = rows.find((r) => sameKey(name, r, values, cols));
        if (existing) Object.assign(existing, values, { updated_at: now() });
        else rows.push(newRow(name, values));
      }
      save(DB_KEY, db);
    } else if (action.kind === "update") {
      for (const row of rows.filter(matches)) {
        Object.assign(row, action.values, { updated_at: now() });
      }
      save(DB_KEY, db);
    } else if (action.kind === "delete") {
      db[name] = rows.filter((r) => !matches(r));
      save(DB_KEY, db);
    }

    if (single) {
      const list = data || [];
      if (single === "single" && list.length !== 1) {
        return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
      }
      data = list[0] ?? null;
    }
    return { data, error: null };
  }

  const builder = {
    select() { return builder; }, // column lists are ignored: full rows are returned
    eq(col, value) { filters.push([col, value]); return builder; },
    order(col, { ascending = true } = {}) { orderBy = { col, asc: ascending }; return builder; },
    limit(n) { limitTo = n; return builder; },
    single() { single = "single"; return builder; },
    maybeSingle() { single = "maybe"; return builder; },
    insert(values) { action = { kind: "insert", values }; return builder; },
    upsert(values, { onConflict } = {}) { action = { kind: "upsert", values, onConflict }; return builder; },
    update(values) { action = { kind: "update", values }; return builder; },
    delete() { action = { kind: "delete" }; return builder; },
    then(resolve, reject) {
      return Promise.resolve().then(run).then(resolve, reject);
    },
  };
  return builder;
}

const RPC = {
  reorder_slides({ p_deck_id, p_section_ids }) {
    const db = load(DB_KEY);
    p_section_ids.forEach((id, i) => {
      const row = table(db, "slides").find((r) => r.deck_id === p_deck_id && r.section_id === id);
      if (row) row.order = i;
    });
    save(DB_KEY, db);
    return null;
  },
  delete_deck({ p_deck_id }) {
    const db = load(DB_KEY);
    for (const t of ["slides", "notes", "slide_history", "notes_history", "frame_history", "decks"]) {
      db[t] = table(db, t).filter((r) => r.deck_id !== p_deck_id);
    }
    save(DB_KEY, db);
    return null;
  },
  rename_asset_references({ p_old_url, p_new_url }) {
    const db = load(DB_KEY);
    let slides_updated = 0;
    let frames_updated = 0;
    for (const s of table(db, "slides")) {
      if (s.content.includes(p_old_url)) { s.content = s.content.split(p_old_url).join(p_new_url); slides_updated++; }
    }
    for (const d of table(db, "decks")) {
      if (d.frame_html.includes(p_old_url)) { d.frame_html = d.frame_html.split(p_old_url).join(p_new_url); frames_updated++; }
    }
    save(DB_KEY, db);
    return [{ slides_updated, frames_updated }];
  },
};

function storageBucket(bucket) {
  const all = () => load(STORAGE_KEY);
  const files = (s) => (s[bucket] ||= {});
  return {
    getPublicUrl(path) {
      return { data: { publicUrl: `${PUBLIC_BASE}/${bucket}/${path}` } };
    },
    async upload(path, file, { upsert = false } = {}) {
      const s = all();
      if (files(s)[path] && !upsert) return { data: null, error: { message: "The resource already exists" } };
      files(s)[path] = { size: file?.size ?? 0, mimetype: file?.type || "", updated_at: now(), created_at: now() };
      save(STORAGE_KEY, s);
      return { data: { path }, error: null };
    },
    async list(folder = "", { search = "" } = {}) {
      const prefix = folder ? `${folder.replace(/\/$/, "")}/` : "";
      const names = new Map();
      for (const [path, meta] of Object.entries(files(all()))) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const [head, ...tail] = rest.split("/");
        if (search && !head.includes(search)) continue;
        if (tail.length) names.set(head, { name: head, id: null, metadata: null }); // folder
        else names.set(head, { name: head, id: path, updated_at: meta.updated_at, created_at: meta.created_at, metadata: { size: meta.size, mimetype: meta.mimetype } });
      }
      return { data: [...names.values()], error: null };
    },
    async remove(paths) {
      const s = all();
      for (const p of paths) delete files(s)[p];
      save(STORAGE_KEY, s);
      return { data: paths.map((name) => ({ name })), error: null };
    },
    async copy(from, to) {
      const s = all();
      if (!files(s)[from]) return { data: null, error: { message: "Object not found" } };
      files(s)[to] = { ...files(s)[from], updated_at: now() };
      save(STORAGE_KEY, s);
      return { data: { path: to }, error: null };
    },
  };
}

export function createClient() {
  return {
    from: query,
    rpc: async (name, args) => {
      if (!RPC[name]) return { data: null, error: { message: `unknown rpc ${name}` } };
      return { data: RPC[name](args), error: null };
    },
    storage: { from: storageBucket },
    channel(name) {
      const bc = new BroadcastChannel(name);
      const handlers = [];
      bc.onmessage = (e) =>
        handlers
          .filter((h) => h.event === e.data.event)
          .forEach((h) => h.cb({ type: "broadcast", event: e.data.event, payload: e.data.payload }));
      const channel = {
        on(_type, { event }, cb) { handlers.push({ event, cb }); return channel; },
        subscribe(cb) { setTimeout(() => cb?.("SUBSCRIBED"), 50); return channel; },
        send({ event, payload }) { bc.postMessage({ event, payload }); return Promise.resolve("ok"); },
      };
      return channel;
    },
    removeChannel() { return Promise.resolve("ok"); },
  };
}
