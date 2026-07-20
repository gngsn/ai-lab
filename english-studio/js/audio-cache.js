/**
 * audio-cache.js — IndexedDB storage for synthesized audio & recordings.
 *
 * Stores:
 *   audio      — TTS results, key: `${engine}|${voice}|${sha1(text)}`
 *   recordings — user takes, key: `${namespace}` → {versions:[{ts,mime,buf}]}
 */

let _db = null;

function getDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open("english-studio", 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio");
      if (!db.objectStoreNames.contains("recordings"))
        db.createObjectStore("recordings");
    };
    req.onsuccess = (e) => {
      _db = e.target.result;
      res(_db);
    };
    req.onerror = () => rej(req.error);
  });
}

export async function dbGet(key, store = "audio") {
  const db = await getDb();
  return new Promise((res, rej) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => rej(req.error);
  });
}

export async function dbPut(key, val, store = "audio") {
  const db = await getDb();
  return new Promise((res, rej) => {
    const req = db
      .transaction(store, "readwrite")
      .objectStore(store)
      .put(val, key);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

export async function dbDelete(key, store = "audio") {
  const db = await getDb();
  return new Promise((res, rej) => {
    const req = db
      .transaction(store, "readwrite")
      .objectStore(store)
      .delete(key);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

const MAX_REC_HISTORY = 10;

/** Save a user recording under a namespace; keeps the last N takes. */
export async function saveRecording(namespace, blob) {
  const buf = await blob.arrayBuffer();
  const hist = (await dbGet(namespace, "recordings")) || { versions: [] };
  const version = { ts: Date.now(), mime: blob.type || "audio/webm", buf };
  hist.versions.unshift(version);
  if (hist.versions.length > MAX_REC_HISTORY)
    hist.versions.length = MAX_REC_HISTORY;
  await dbPut(namespace, hist, "recordings");
  return { version, hist };
}

export async function getRecordings(namespace) {
  return (await dbGet(namespace, "recordings")) || { versions: [] };
}
