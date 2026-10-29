import { useEffect, useRef } from "react";
import type { useImportForm } from "./useImportForm";

type Form = ReturnType<typeof useImportForm>;

const INTRO = {
  file:
    "Choose an HTML presentation file from your computer. It should " +
    "contain top-level <section> slides.",
  url:
    "Paste the URL of an HTML presentation — GitHub file links, raw " +
    "links, gists and GitHub Pages work. Linked images and video in " +
    "the same repo are copied into your storage.",
};

type UrlFieldProps = {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  hint: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
};

/** A link field that fetches when it loses focus (or Enter is pressed) with a new value. */
function UrlField({ id, label, placeholder, value, hint, onChange, onCommit }: UrlFieldProps) {
  const committed = useRef("");
  // a value cleared from outside (a file was chosen instead) can be entered again
  useEffect(() => {
    if (value === "") committed.current = "";
  }, [value]);
  const commit = () => {
    if (value === committed.current) return;
    committed.current = value;
    onCommit(value);
  };
  return (
    <div className="field" data-only="url">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="url"
        placeholder={placeholder}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      <span className="field-hint" id={`${id}-hint`}>
        {hint}
      </span>
    </div>
  );
}

type FileFieldProps = {
  id: string;
  label: string;
  accept: string;
  inputRef: (element: HTMLInputElement | null) => void;
  onFile: (file: File) => void;
};

function FileField({ id, label, accept, inputRef, onFile }: FileFieldProps) {
  return (
    <div className="field" data-only="file">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="file"
        accept={accept}
        ref={inputRef}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
    </div>
  );
}

const MD = ".md,.markdown,text/markdown";

export function ImportModal({ form }: { form: Form }) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop closes the modal on a click outside it
    // biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop closes the modal on a click outside it; Esc is not handled
    <div
      className={form.open ? "modal-bg show" : "modal-bg"}
      id="import-modal-bg"
      aria-hidden={!form.open}
      onClick={(e) => e.target === e.currentTarget && form.close()}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-modal-title"
        data-mode={form.mode}
      >
        <h2 id="import-modal-title">
          {form.mode === "url" ? "Import from GitHub" : "Import HTML deck"}
        </h2>
        <p id="import-intro">{INTRO[form.mode]}</p>
        <FileField
          id="import-file"
          label="HTML file"
          accept=".html,.htm,text/html"
          inputRef={form.fileInputRef("html")}
          onFile={(file) => void form.chooseFile("html", file)}
        />
        <UrlField
          id="import-url"
          label="HTML URL"
          placeholder="https://github.com/…/deck.html"
          value={form.urls.html}
          hint={form.hints.html}
          onChange={(value) => form.setUrl("html", value)}
          onCommit={(value) => form.commitUrl("html", value)}
        />
        <div className="field">
          <label htmlFor="import-deck-id">Deck ID</label>
          <input
            id="import-deck-id"
            type="text"
            placeholder="auto from file name"
            value={form.deckId}
            onChange={(e) => form.setDeckId(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="import-title">Title</label>
          <input
            id="import-title"
            type="text"
            placeholder="auto from <title>"
            value={form.title}
            onChange={(e) => form.setTitle(e.target.value)}
          />
        </div>
        <FileField
          id="import-notes-file"
          label="Notes Markdown (optional)"
          accept={MD}
          inputRef={form.fileInputRef("notes")}
          onFile={(file) => void form.chooseFile("notes", file)}
        />
        <UrlField
          id="import-notes-url"
          label="Notes Markdown URL (optional)"
          placeholder="https://github.com/…/script.md"
          value={form.urls.notes}
          hint={form.hints.notes}
          onChange={(value) => form.setUrl("notes", value)}
          onCommit={(value) => form.commitUrl("notes", value)}
        />
        <FileField
          id="import-km-file"
          label="Key messages Markdown (optional)"
          accept={MD}
          inputRef={form.fileInputRef("keys")}
          onFile={(file) => void form.chooseFile("keys", file)}
        />
        <UrlField
          id="import-km-url"
          label="Key messages Markdown URL (optional)"
          placeholder="https://github.com/…/key-messages.md"
          value={form.urls.keys}
          hint={form.hints.keys}
          onChange={(value) => form.setUrl("keys", value)}
          onCommit={(value) => form.commitUrl("keys", value)}
        />
        <div className="field" data-only="url">
          <label htmlFor="import-github-token">
            GitHub token (optional, for private repositories)
          </label>
          <input
            id="import-github-token"
            type="password"
            placeholder={form.tokenFromConfig ? "using GITHUB_TOKEN from config" : "github_pat_…"}
            autoComplete="off"
            spellCheck="false"
            value={form.token}
            onChange={(e) => form.setToken(e.target.value)}
            onBlur={(e) => form.commitToken(e.target.value)}
          />
          <span className="field-hint">
            Read-only "Contents" access is enough. The token is kept only in this browser.
          </span>
        </div>
        <p id="import-error" className="bad" style={{ display: form.error ? "block" : "none" }}>
          {form.error}
        </p>
        <div className="actions">
          <button
            className="md-btn md-secondary"
            id="import-cancel-btn"
            type="button"
            onClick={form.close}
          >
            Cancel
          </button>
          <button
            className="md-btn md-primary"
            id="import-run-btn"
            type="button"
            disabled={form.runLabel !== null}
            onClick={() => void form.run()}
          >
            {form.runLabel ?? "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
