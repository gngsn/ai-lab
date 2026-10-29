import type { HistoryEntry } from "../../data/history";
import type { History } from "./useHistory";
import { fmtTime, previewHtml } from "./view";

function Row({ entry, history }: { entry: HistoryEntry; history: History }) {
  const key = `${entry._source}-${entry.id}`;
  const isOpen = history.openId === key;
  const sectionLabel = entry._source === "frame" ? "frame" : entry.section_id;
  return (
    <li className="hist-row" data-id={entry.id} data-source={entry._source}>
      <div className="hist-line">
        {entry.kind === "manual" ? (
          <span className="h-kind manual">★</span>
        ) : (
          <span className="h-kind auto">·</span>
        )}
        <span className={`h-src ${entry._source}`}>{entry._source}</span>
        <code className="h-sec">{sectionLabel}</code>
        <span className="h-time">{fmtTime(entry.created_at)}</span>
        {entry.message ? <span className="h-msg">{entry.message}</span> : null}
        <span className="h-actions">
          <button type="button" className="h-view" onClick={() => history.toggleView(key)}>
            {isOpen ? "hide" : "view"}
          </button>
          <button
            type="button"
            className="h-restore"
            onClick={() => void history.restore(entry.id, entry._source)}
          >
            restore
          </button>
        </span>
      </div>
      {isOpen ? (
        <pre
          className="hist-content"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: previewHtml escapes the content
          dangerouslySetInnerHTML={{ __html: previewHtml(entry.content) }}
        />
      ) : null}
    </li>
  );
}

/**
 * The slide-in history drawer, shared by the editor and the script editor. The ids, classes and
 * `data-act` hooks are what history-ui.css and the tests use.
 */
export function HistoryDrawer({
  open,
  history,
  onClose,
}: {
  open: boolean;
  history: History;
  onClose: () => void;
}) {
  const { entries, loading, error, started, sectionId } = history;
  let body = null;
  if (error !== null) {
    body = <p className="hist-err">{error}</p>;
  } else if (started) {
    body = (
      <>
        <header className="hist-head">
          <strong>History</strong>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button type="button" className="btn" data-act="refresh" onClick={history.refresh}>
              ↻
            </button>
            <button
              type="button"
              className="btn"
              data-act="close"
              aria-label="Close history drawer"
              onClick={onClose}
            >
              ×
            </button>
          </span>
        </header>
        <label className="hist-filter">
          <input
            type="checkbox"
            data-act="filter"
            checked={history.filterCurrent}
            disabled={!sectionId}
            onChange={(e) => history.setFilter(e.target.checked)}
          />
          current section only{" "}
          {sectionId ? (
            <>
              (<code>{sectionId}</code>)
            </>
          ) : (
            ""
          )}
        </label>
        <ul className="hist-list">
          {entries.length ? (
            entries.map((entry) => (
              <Row key={`${entry._source}-${entry.id}`} entry={entry} history={history} />
            ))
          ) : (
            <li className="hist-empty">{loading ? "loading…" : "(no history yet)"}</li>
          )}
        </ul>
      </>
    );
  }
  return (
    <aside className={`hist-drawer${open ? " open" : ""}`} id="hist-drawer">
      <div id="history-panel">{body}</div>
    </aside>
  );
}
