import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import {
  type Asset,
  copyAssetForRename,
  deleteAsset,
  listAllAssets,
  renameAssetReferences,
  uploadAsset,
} from "../../data/storage";
import { copyText } from "../../lib/clipboard";
import type { EditChrome } from "./EditShell";

// The asset library (images, video, audio, any file). One library is shared by
// every deck: uploads go to a shared folder, and the list also includes files
// uploaded from any deck before that. Assets are inserted/copied by their
// public https URL, so they show in every view.
const ASSET_ICONS = { video: "🎬", audio: "🎵", file: "📄" } as const;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function formatSize(bytes: number | null) {
  if (bytes == null) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function Thumb({ asset }: { asset: Asset }) {
  if (asset.kind === "image") return <img src={asset.url} alt="" loading="lazy" />;
  if (asset.kind === "video") {
    // #t=0.1 makes browsers paint the first frame as a preview.
    return <video src={`${asset.url}#t=0.1`} muted preload="metadata" playsInline />;
  }
  const ext = asset.name.split(".").pop()?.toUpperCase() || "";
  return (
    <div className="asset-icon">
      <span>{ASSET_ICONS[asset.kind]}</span>
      <small>{ext}</small>
    </div>
  );
}

const noteStyle = { opacity: 0.5, fontSize: 12, padding: "1em", gridColumn: "1/-1" } as const;

type Props = {
  deckId: string;
  canvasRef: RefObject<HTMLIFrameElement | null>;
  chrome: EditChrome;
  open: boolean;
  onClose: () => void;
};

export function AssetLibrary({ deckId, canvasRef, chrome, open, onClose }: Props) {
  const { setStatus, toast } = chrome;
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const fileInput = useRef<HTMLInputElement>(null);
  const loadId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++loadId.current;
    setAssets(null);
    setError(null);
    try {
      const list = await listAllAssets();
      if (id === loadId.current) setAssets(list);
    } catch (err) {
      if (id === loadId.current) setError(messageOf(err));
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const upload = async (files: FileList | null) => {
    const list = Array.from(files || []);
    if (list.length === 0) return;
    let ok = 0;
    const failed: string[] = [];
    for (const [index, file] of list.entries()) {
      setStatus(`uploading ${index + 1}/${list.length}: ${file.name}…`);
      try {
        await uploadAsset(file);
        ok++;
      } catch (err) {
        console.warn("[asset upload]", file.name, err);
        failed.push(`${file.name} (${messageOf(err)})`);
      }
    }
    if (failed.length === 0) {
      setStatus(`uploaded ${ok}`, "ok");
      toast(`Uploaded ${ok} file(s)`, "ok");
    } else {
      setStatus(`uploaded ${ok}, failed ${failed.length}`, "err");
      toast(`Upload failed: ${failed.join(", ")}`, "err");
    }
    await refresh();
  };

  const copyUrl = async (asset: Asset) => {
    if (await copyText(asset.url)) {
      toast(`Copied URL: …/${asset.url.split("/").pop()}`, "ok");
    } else {
      // Last resort: show it so it can be copied by hand.
      window.prompt("Copy this asset URL:", asset.url);
    }
  };

  const insert = (asset: Asset) => {
    canvasRef.current?.contentWindow?.postMessage(
      { type: "edit:insert-asset", url: asset.url, name: asset.name, kind: asset.kind },
      "*",
    );
    onClose();
    toast("Inserted into current slide", "ok");
  };

  const setBusyPath = (path: string, on: boolean) =>
    setBusy((current) => {
      const next = new Set(current);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });

  const rename = async (asset: Asset) => {
    const nextName = window.prompt("New asset name:", asset.name);
    if (nextName == null || nextName.trim() === "" || nextName.trim() === asset.name) return;
    try {
      setBusyPath(asset.path, true);
      const renamed = await copyAssetForRename(asset.path, nextName);
      if (renamed.newPath === renamed.oldPath) {
        setBusyPath(asset.path, false);
        toast("That asset already has this name", "ok");
        return;
      }
      try {
        await renameAssetReferences(renamed.oldUrl, renamed.newUrl);
      } catch (err) {
        await deleteAsset(renamed.newPath).catch(() => {});
        throw err;
      }
      try {
        await deleteAsset(renamed.oldPath);
      } catch (cleanupErr) {
        toast(`Renamed, but the old file could not be removed: ${messageOf(cleanupErr)}`, "err");
        setBusyPath(asset.path, false);
        await refresh();
        return;
      }
      toast(`Renamed to ${renamed.name}`, "ok");
      setBusyPath(asset.path, false);
      await refresh();
    } catch (err) {
      setBusyPath(asset.path, false);
      toast(`Rename failed: ${messageOf(err)}`, "err");
    }
  };

  const remove = async (asset: Asset) => {
    if (
      !window.confirm(
        `Delete '${asset.name}' from the shared library?\n` +
          "Any deck using it will show it as missing. This cannot be undone.",
      )
    )
      return;
    try {
      await deleteAsset(asset.path);
      toast("Deleted", "ok");
      await refresh();
    } catch (err) {
      toast(`Delete failed: ${messageOf(err)}`, "err");
    }
  };

  const sourceOf = (asset: Asset) =>
    asset.deckId == null ? "shared" : asset.deckId === deckId ? "this deck" : asset.deckId;
  const query = filter.trim().toLowerCase();

  let body: React.ReactNode;
  if (error) {
    body = <div style={{ ...noteStyle, opacity: 1, color: "var(--se-bad, #b42318)" }}>{error}</div>;
  } else if (assets === null) {
    body = <div style={noteStyle}>loading…</div>;
  } else if (assets.length === 0) {
    body = (
      <div style={noteStyle}>
        No assets yet — drop files here or click <b>+ Upload</b>. Images, video, audio and other
        files are all fine.
      </div>
    );
  } else {
    body = assets.map((asset) => (
      <div
        className={`img-card${busy.has(asset.path) ? " uploading" : ""}`}
        key={asset.path}
        data-path={asset.path}
        data-url={asset.url}
        data-kind={asset.kind}
        data-name={asset.name}
        hidden={Boolean(query) && !`${asset.name} ${sourceOf(asset)}`.toLowerCase().includes(query)}
      >
        <div className="thumb">
          <Thumb asset={asset} />
        </div>
        <div className="actions">
          <button
            type="button"
            className="act-copy"
            title="Copy this asset's URL"
            onClick={() => void copyUrl(asset)}
          >
            Copy URL
          </button>
          <button
            type="button"
            className="act-insert"
            title="Insert into current slide"
            onClick={() => insert(asset)}
          >
            ↩
          </button>
          <button
            type="button"
            className="act-rename"
            title="Rename this asset"
            onClick={() => void rename(asset)}
          >
            Rename
          </button>
          <button
            type="button"
            className="act-del"
            title="Delete"
            onClick={() => void remove(asset)}
          >
            🗑
          </button>
        </div>
        <div className="meta">
          <span className="nm" title={asset.name}>
            {asset.name}
          </span>
          <span>{formatSize(asset.size)}</span>
          <span className="src" title="Uploaded in">
            {sourceOf(asset)}
          </span>
        </div>
      </div>
    ));
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop closes the modal on a click outside it, as before
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc handling was never part of this modal
    <div
      className={`modal-bg${open ? " show" : ""}`}
      id="images-modal-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ width: "min(820px, 92vw)", height: "min(640px, 88vh)" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2>Assets</h2>
          <span style={{ fontSize: 11, color: "var(--text-mid)" }}>shared across all decks</span>
          <span style={{ flex: 1 }} />
          <input
            id="images-filter"
            type="search"
            placeholder="Filter by name or deck"
            autoComplete="off"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            id="images-upload-btn"
            onClick={() => fileInput.current?.click()}
          >
            + Upload
          </button>
          <input
            type="file"
            id="images-upload-input"
            ref={fileInput}
            multiple
            hidden
            onChange={(e) => {
              void upload(e.currentTarget.files);
              e.currentTarget.value = ""; // allow re-uploading the same file
            }}
          />
          <button type="button" className="btn" id="images-close" onClick={onClose}>
            Close
          </button>
        </header>
        <div id="images-grid" className="image-grid">
          {body}
        </div>
      </div>
    </div>
  );
}
