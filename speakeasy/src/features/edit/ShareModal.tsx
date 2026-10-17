import { type RefObject, useRef, useState } from "react";
import { setShareToken } from "../../data/decks";
import type { DeckRow } from "../../data/types";
import { copyText } from "../../lib/clipboard";
import { syncRoomFor } from "../../lib/sync-room";
import type { EditChrome } from "./EditShell";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Audience link: share.html follows the presenter live on the deck's sync
// room (present from this editor or the deck list broadcasts on it).
function shareUrlFor(deckId: string, token: string) {
  const url = new URL("./share.html", location.href);
  url.search = "";
  url.searchParams.set("deck", deckId);
  url.searchParams.set("token", token);
  url.searchParams.set("sync", syncRoomFor(deckId));
  return url.toString();
}

function qrUrlFor(url: string, format = "png") {
  return (
    "https://api.qrserver.com/v1/create-qr-code/?size=480x480&margin=0" +
    `&format=${format}&data=${encodeURIComponent(url)}`
  );
}

/** State and actions of the Share dialog; `openShare` is the toolbar button. */
export function useShare(deckId: string, deckRef: RefObject<DeckRow>, chrome: EditChrome) {
  const { toast } = chrome;
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");

  const rotate = async ({ silent = false } = {}) => {
    const token = crypto.randomUUID();
    try {
      await setShareToken(deckId, token);
      deckRef.current = { ...deckRef.current, share_token: token };
      setUrl(shareUrlFor(deckId, token));
      if (!silent) toast("New share link", "ok");
    } catch (err) {
      toast(`Token generation failed: ${messageOf(err)}`, "err");
      throw err;
    }
  };

  const openShare = async () => {
    const token = deckRef.current.share_token;
    if (!token) {
      if (!window.confirm("No share link yet. Generate one?")) return;
      try {
        await rotate({ silent: true });
      } catch {
        return;
      }
    } else {
      setUrl(shareUrlFor(deckId, token));
    }
    setOpen(true);
  };

  const revoke = async () => {
    if (!window.confirm("Revoke sharing entirely? View links will return 'invalid'.")) return;
    try {
      await setShareToken(deckId, null);
      deckRef.current = { ...deckRef.current, share_token: null };
      setOpen(false);
      toast("Share link revoked", "ok");
    } catch (err) {
      toast(`Revoke failed: ${messageOf(err)}`, "err");
    }
  };

  const rotateWithConfirm = async () => {
    if (!window.confirm("Rotate token? Existing share links will stop working.")) return;
    try {
      await rotate();
    } catch {
      /* toast already shown */
    }
  };

  return { open, url, openShare, close: () => setOpen(false), revoke, rotate: rotateWithConfirm };
}

type Props = { share: ReturnType<typeof useShare>; chrome: EditChrome };

export function ShareModal({ share, chrome }: Props) {
  const { toast } = chrome;
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(0);

  const copy = async () => {
    try {
      if (!(await copyText(share.url))) throw new Error("not allowed");
      setCopied(true);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch (err) {
      toast(`Copy failed: ${messageOf(err)}`, "err");
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop closes the modal on a click outside it, as before
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc handling was never part of this modal
    <div
      className={`modal-bg${share.open ? " show" : ""}`}
      id="share-modal-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) share.close();
      }}
    >
      <div
        className="modal share-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
      >
        <div className="share-modal-head">
          <div>
            <div className="share-modal-eyebrow">Live audience</div>
            <h2 id="share-modal-title">Share this deck</h2>
          </div>
          <button
            className="btn share-modal-close"
            id="share-close"
            type="button"
            aria-label="Close share dialog"
            onClick={share.close}
          >
            ×
          </button>
        </div>
        <div className="share-modal-body">
          <div className="share-hero">
            <div className="share-qr-frame">
              <img
                className="share-qr-image"
                id="share-qr"
                alt="QR code for the audience link"
                src={share.url ? qrUrlFor(share.url) : undefined}
              />
            </div>
            <div className="share-hero-copy">
              <strong>Scan to join</strong>
              <p className="share-modal-note">
                Your audience sees the slides and follows along as you present. Notes and your
                script stay private.
              </p>
              <div className="share-hero-actions">
                <a
                  className="btn"
                  id="share-qr-download"
                  download="speakeasy-share-qr.png"
                  href={share.url ? qrUrlFor(share.url) : undefined}
                >
                  ↓ Download QR
                </a>
                <a
                  className="btn"
                  id="share-open"
                  target="_blank"
                  rel="noopener"
                  href={share.url || undefined}
                >
                  Open audience view ↗
                </a>
              </div>
            </div>
          </div>
          <div className="share-link">
            <label htmlFor="share-url">Audience link</label>
            <div className="share-url-row">
              <input id="share-url" readOnly value={share.url} />
              <button
                className={`btn share-copy-btn${copied ? " copied" : ""}`}
                id="share-copy"
                type="button"
                onClick={() => void copy()}
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
          </div>
        </div>
        <div className="share-modal-foot">
          <p>A new link turns the current one off.</p>
          <div className="share-foot-actions">
            <button
              className="btn"
              id="share-rotate"
              type="button"
              onClick={() => void share.rotate()}
            >
              ↻ New link
            </button>
            <button
              className="btn share-danger"
              id="share-revoke"
              type="button"
              onClick={() => void share.revoke()}
            >
              Stop sharing
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
