import { useCallback, useRef, useState } from "react";
import { updateFrameHtml } from "../../data/decks";
import { type HistoryEntry, type HistorySource, listAllHistory } from "../../data/history";
import { upsert as upsertNote } from "../../data/notes";
import { updateContent } from "../../data/slides";
import { fmtTime } from "./view";

export type Restored = { section_id: string; source: HistorySource };

type Options = {
  deckId: string;
  /** The section the "current section only" filter and label follow. */
  getSectionId: () => string | null;
  onRestored?: (info: Restored) => void | Promise<void>;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The history timeline's state (port of the HistoryUI class in
 * public/js/history-ui.js): a merged slide / notes / frame list, an optional
 * filter to the current section, one row's content open at a time, and
 * restoring a row through the live data layer.
 */
export function useHistory({ deckId, getSectionId, onRestored }: Options) {
  const [started, setStarted] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterCurrent, setFilterCurrent] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // The label follows the section as of the last render of the list, like the
  // legacy drawer, which only redrew itself on these events.
  const [sectionId, setSectionId] = useState<string | null>(null);

  const latest = useRef({ deckId, getSectionId, onRestored, entries, filterCurrent });
  latest.current = { deckId, getSectionId, onRestored, entries, filterCurrent };

  const refresh = useCallback(async (filterOverride?: boolean) => {
    const { deckId: id, getSectionId: current, filterCurrent: filter } = latest.current;
    const useFilter = filterOverride ?? filter;
    setStarted(true);
    setError(null);
    setLoading(true);
    setSectionId(current());
    const sid = useFilter ? current() : null;
    try {
      setEntries(await listAllHistory(id, sid ? { sectionId: sid } : {}));
    } catch (err) {
      setError(messageOf(err));
      setLoading(false);
      return;
    }
    setLoading(false);
    setSectionId(current());
  }, []);

  const setFilter = (checked: boolean) => {
    setFilterCurrent(checked);
    void refresh(checked);
  };

  const toggleView = (key: string) => {
    setOpenId((open) => (open === key ? null : key));
    setSectionId(latest.current.getSectionId());
  };

  const restore = async (id: number, source: HistorySource) => {
    const { deckId: deck, entries: list, onRestored: done } = latest.current;
    const entry = list.find((e) => e.id === id && e._source === source);
    if (!entry) return;
    const ok = confirm(
      `Restore ${source} for '${entry.section_id}'\nto ${fmtTime(entry.created_at)}?`,
    );
    if (!ok) return;
    try {
      if (source === "slide") {
        await updateContent(deck, entry.section_id, entry.content);
      } else if (source === "notes") {
        await upsertNote(deck, entry.section_id, entry.content);
      } else {
        await updateFrameHtml(deck, entry.content);
      }
      void done?.({ section_id: entry.section_id, source });
      // Refresh history to show the new auto row created by the restore.
      void refresh();
    } catch (err) {
      alert(`Restore failed: ${messageOf(err)}`);
    }
  };

  return {
    started,
    entries,
    loading,
    error,
    filterCurrent,
    openId,
    sectionId,
    refresh: () => refresh(),
    setFilter,
    toggleView,
    restore,
  };
}
export type History = ReturnType<typeof useHistory>;
