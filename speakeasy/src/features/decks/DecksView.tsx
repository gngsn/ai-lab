import { DeckItemRow } from "./DeckItemRow";
import { ImportModal } from "./ImportModal";
import { ReimportModal } from "./ReimportModal";
import type { DeckListStatus } from "./useDecks";
import { useDecks } from "./useDecks";
import { useImportForm } from "./useImportForm";
import { useReimport } from "./useReimport";

function Status({ status, note }: { status: DeckListStatus; note: string | null }) {
  if (status.kind === "checking") return <>checking Supabase connection…</>;
  if (status.kind === "error") return <span className="bad">✗ {status.message}</span>;
  return (
    <>
      <span className="ok">✓ connected</span> — {status.count} deck(s)
      {note && (
        <>
          {" "}
          · <span className="ok">{note}</span>
        </>
      )}
    </>
  );
}

export function DecksView() {
  const { decks, status, note, setNote, deleting, reload, remove } = useDecks();
  const importForm = useImportForm();
  const reimport = useReimport(
    () => importForm.token.trim() || window.GITHUB_TOKEN || "",
    async (deckId, parts) => {
      await reload();
      setNote(`re-imported ${deckId}: ${parts.join(" + ")}`);
    },
  );

  return (
    <>
      <div className="wrap">
        <div className="header-row">
          <div>
            <h1>Speakeasy</h1>
            <p id="status">
              <Status status={status} note={note} />
            </p>
          </div>
          <div className="import-panel">
            <span className="import-label">Import</span>
            <button
              className="md-btn md-primary"
              id="import-html-btn"
              type="button"
              title="Import an HTML deck file from your computer"
              onClick={() => importForm.openAs("file")}
            >
              File
            </button>
            <button
              className="md-btn md-primary"
              id="import-url-btn"
              type="button"
              title="Import an HTML deck from a GitHub link"
              onClick={() => importForm.openAs("url")}
            >
              GitHub
            </button>
          </div>
        </div>

        <h2>Decks</h2>
        <ul id="deck-list">
          {decks === null ? (
            <li>loading…</li>
          ) : status.kind === "error" ? (
            <li>—</li>
          ) : decks.length === 0 ? (
            <li>
              (none — run <code>migrations/seed.sql</code> for a sample deck)
            </li>
          ) : (
            decks.map((deck) => (
              <DeckItemRow
                key={deck.deck_id}
                deck={deck}
                deleting={deleting === deck.deck_id}
                onReimport={() => reimport.openFor({ id: deck.deck_id, title: deck.title })}
                onDelete={() => void remove(deck)}
              />
            ))
          )}
        </ul>
      </div>

      <ImportModal form={importForm} />
      <ReimportModal reimport={reimport} />
    </>
  );
}
