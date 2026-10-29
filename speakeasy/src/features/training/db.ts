// IndexedDB "pronunciation-cache" shared by every panel instance: generated
// takes ("history"), the user's own recordings ("recordings") and the chosen
// recordings folder handle ("audio"). The layout must not change: takes saved
// in a user's browser are found by it.
export type StoreName = "audio" | "history" | "recordings";

export type KeyValueStore = {
  get<T>(key: string, store?: StoreName): Promise<T | null>;
  put(key: string, value: unknown, store?: StoreName): Promise<void>;
};

let cached: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (cached) return cached;
  cached = new Promise((resolve, reject) => {
    const req = indexedDB.open("pronunciation-cache", 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ["audio", "history", "recordings"] as const)
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      cached = null;
      reject(req.error);
    };
  });
  return cached;
}

export const idbStore: KeyValueStore = {
  async get<T>(key: string, store: StoreName = "audio") {
    const db = await getDb();
    return new Promise<T | null>((resolve, reject) => {
      const req = db.transaction(store, "readonly").objectStore(store).get(key);
      req.onsuccess = () => resolve((req.result as T) || null);
      req.onerror = () => reject(req.error);
    });
  },
  async put(key: string, value: unknown, store: StoreName = "audio") {
    const db = await getDb();
    return new Promise<void>((resolve, reject) => {
      const req = db.transaction(store, "readwrite").objectStore(store).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
};
