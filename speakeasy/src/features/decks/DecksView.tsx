export function DecksView() {
  return (
    <>
      <div className="wrap">
        <div className="header-row">
          <div>
            <h1>Speakeasy</h1>
            <p id="status">checking Supabase connection…</p>
          </div>
          <div className="import-panel">
            <span className="import-label">Import</span>
            <button
              className="md-btn md-primary"
              id="import-html-btn"
              type="button"
              title="Import an HTML deck file from your computer"
            >
              File
            </button>
            <button
              className="md-btn md-primary"
              id="import-url-btn"
              type="button"
              title="Import an HTML deck from a GitHub link"
            >
              GitHub
            </button>
          </div>
        </div>

        <h2>Decks</h2>
        <ul id="deck-list">
          <li>loading…</li>
        </ul>
      </div>

      <div className="modal-bg" id="import-modal-bg" aria-hidden="true">
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="import-modal-title">
          <h2 id="import-modal-title">Import HTML deck</h2>
          <p id="import-intro"></p>
          <div className="field" data-only="file">
            <label htmlFor="import-file">HTML file</label>
            <input id="import-file" type="file" accept=".html,.htm,text/html" />
          </div>
          <div className="field" data-only="url">
            <label htmlFor="import-url">HTML URL</label>
            <input
              id="import-url"
              type="url"
              placeholder="https://github.com/…/deck.html"
              autoComplete="off"
            />
            <span className="field-hint" id="import-url-hint"></span>
          </div>
          <div className="field">
            <label htmlFor="import-deck-id">Deck ID</label>
            <input id="import-deck-id" type="text" placeholder="auto from file name" />
          </div>
          <div className="field">
            <label htmlFor="import-title">Title</label>
            <input id="import-title" type="text" placeholder="auto from &lt;title&gt;" />
          </div>
          <div className="field" data-only="file">
            <label htmlFor="import-notes-file">Notes Markdown (optional)</label>
            <input id="import-notes-file" type="file" accept=".md,.markdown,text/markdown" />
          </div>
          <div className="field" data-only="url">
            <label htmlFor="import-notes-url">Notes Markdown URL (optional)</label>
            <input
              id="import-notes-url"
              type="url"
              placeholder="https://github.com/…/script.md"
              autoComplete="off"
            />
            <span className="field-hint" id="import-notes-url-hint"></span>
          </div>
          <div className="field" data-only="file">
            <label htmlFor="import-km-file">Key messages Markdown (optional)</label>
            <input id="import-km-file" type="file" accept=".md,.markdown,text/markdown" />
          </div>
          <div className="field" data-only="url">
            <label htmlFor="import-km-url">Key messages Markdown URL (optional)</label>
            <input
              id="import-km-url"
              type="url"
              placeholder="https://github.com/…/key-messages.md"
              autoComplete="off"
            />
            <span className="field-hint" id="import-km-url-hint"></span>
          </div>
          <div className="field" data-only="url">
            <label htmlFor="import-github-token">
              GitHub token (optional, for private repositories)
            </label>
            <input
              id="import-github-token"
              type="password"
              placeholder="github_pat_…"
              autoComplete="off"
              spellCheck="false"
            />
            <span className="field-hint">
              Read-only "Contents" access is enough. The token is kept only in this browser.
            </span>
          </div>
          <p id="import-error" className="bad" style={{ display: "none" }}></p>
          <div className="actions">
            <button className="md-btn md-secondary" id="import-cancel-btn" type="button">
              Cancel
            </button>
            <button className="md-btn md-primary" id="import-run-btn" type="button">
              Import
            </button>
          </div>
        </div>
      </div>

      <div className="modal-bg" id="reimport-modal-bg" aria-hidden="true">
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="reimport-title">
          <p className="modal-eyebrow">Re-import</p>
          {/* biome-ignore lint/a11y/useHeadingContent: filled by the controller */}
          <h2 id="reimport-title"></h2>
          <p className="reimport-note">
            Replace any of the parts below; the rest stay as they are. Replaced slides and script
            are saved to History first.
          </p>
          <div className="reimport-part" data-part="slides">
            <span className="part-name">Slides</span>
            <div className="part-body">
              <div className="part-pick">
                <label className="md-btn md-secondary">
                  Choose HTML
                  <input type="file" accept=".html,.htm,text/html" />
                </label>
                <input
                  className="part-url"
                  type="url"
                  placeholder="or paste a GitHub URL"
                  autoComplete="off"
                />
              </div>
              <div className="part-state">
                <span>Keep current</span>
              </div>
            </div>
          </div>
          <div className="reimport-part" data-part="script">
            <span className="part-name">Script</span>
            <div className="part-body">
              <div className="part-pick">
                <label className="md-btn md-secondary">
                  Choose Markdown
                  <input type="file" accept=".md,.markdown,text/markdown" />
                </label>
                <input
                  className="part-url"
                  type="url"
                  placeholder="or paste a GitHub URL"
                  autoComplete="off"
                />
              </div>
              <div className="part-state">
                <span>Keep current</span>
              </div>
            </div>
          </div>
          <div className="reimport-part" data-part="keys">
            <span className="part-name">Key messages</span>
            <div className="part-body">
              <div className="part-pick">
                <label className="md-btn md-secondary">
                  Choose Markdown
                  <input type="file" accept=".md,.markdown,text/markdown" />
                </label>
                <input
                  className="part-url"
                  type="url"
                  placeholder="or paste a GitHub URL"
                  autoComplete="off"
                />
              </div>
              <div className="part-state">
                <span>Keep current</span>
              </div>
            </div>
          </div>
          <p id="reimport-error" className="bad" hidden></p>
          <div className="actions">
            <button className="md-btn md-secondary" id="reimport-cancel" type="button">
              Cancel
            </button>
            <button className="md-btn md-primary" id="reimport-run" type="button" disabled>
              Replace
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
