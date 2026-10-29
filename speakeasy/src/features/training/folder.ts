// Saving the user's recordings to a folder on disk (File System Access API),
// or downloading them where that API is missing. Port of the folder code in
// the legacy training-panel.js.
import { idbStore, type KeyValueStore } from "./db";
import type { RecVersion } from "./takes";
import { fileStamp, safePart } from "./text";

type Permission = "granted" | "denied" | "prompt";
export type DirHandle = {
  queryPermission(opts: { mode: "readwrite" }): Promise<Permission>;
  requestPermission(opts: { mode: "readwrite" }): Promise<Permission>;
  getDirectoryHandle(name: string, opts: { create: boolean }): Promise<DirHandle>;
  getFileHandle(
    name: string,
    opts: { create: boolean },
  ): Promise<{
    createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }>;
  }>;
};
type Picker = (opts: { id: string; mode: "readwrite" }) => Promise<DirHandle>;

const ROOT_KEY = "__rec_root_dir__";
const pickerOf = () => (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker;

export const canPickFolder = () => Boolean(pickerOf());

async function verifyPermission(handle: DirHandle) {
  const opts = { mode: "readwrite" } as const;
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

/** The recordings folder of one panel: remembered in IndexedDB, asked for only on request. */
export function createRecordingFolder(deckId: string, store: KeyValueStore = idbStore) {
  let root: DirHandle | null = null;

  async function getRoot({ interactive }: { interactive: boolean }) {
    if (root && (await verifyPermission(root))) return root;
    const saved = await store.get<DirHandle>(ROOT_KEY);
    if (saved && (await verifyPermission(saved))) {
      root = saved;
      return saved;
    }
    const pick = pickerOf();
    if (!interactive || !pick) return null;
    root = await pick({ id: "cleartalk-recordings", mode: "readwrite" });
    await store.put(ROOT_KEY, root);
    return root;
  }

  /** True if written; false if no folder is configured yet (silent mode). */
  async function save(sectionId: string, version: RecVersion, opts: { interactive: boolean }) {
    const base = await getRoot(opts);
    if (!base) return false;
    let dir = base;
    for (const part of ["speakeasy", deckId, sectionId])
      dir = await dir.getDirectoryHandle(safePart(part), { create: true });
    const ext = (version.mime || "").includes("wav") ? "wav" : "webm";
    const file = await dir.getFileHandle(`${fileStamp(version.ts)}.${ext}`, { create: true });
    const writable = await file.createWritable();
    await writable.write(new Blob([version.buf], { type: version.mime || "audio/webm" }));
    await writable.close();
    return true;
  }

  return { save };
}

/** Firefox / Safari: no File System Access API, so the take is downloaded instead. */
export function downloadRecording(deckId: string, sectionId: string, version: RecVersion) {
  const url = URL.createObjectURL(new Blob([version.buf], { type: version.mime || "audio/webm" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${deckId}__${sectionId}__${fileStamp(version.ts)}.webm`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
