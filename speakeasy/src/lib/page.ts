// What every page entry (src/pages/*/main) needs before it can render: the
// owner gate, the ?deck= id, the mount point, and a way to stop with a message
// the user can read. A stop is a `PageError`: the message is already on screen,
// so `runPage` does not log it.
import { ensureAuthed } from "./auth";

export class PageError extends Error {}

/** The look of the plain-text error pages. */
export const ERROR_STYLE = {
  /** A load or input problem. */
  plain: "padding:2rem;color:var(--se-bad, #b42318)",
  /** An access problem (monospace). */
  denied: "padding:2rem;color:var(--se-bad, #b42318);font-family:monospace",
} as const;

type ErrorOptions = {
  style?: string;
  className?: string;
  /** Where to draw it, replacing what is there (default: the whole page). */
  into?: HTMLElement;
  /** Wrap the message in <main> (the caption console's layout). */
  inMain?: boolean;
};

/** Replaces the page with one line of text. `message` is shown as text, never as markup. */
export function showError(
  message: string,
  { style = ERROR_STYLE.plain, className, into = document.body, inMain }: ErrorOptions = {},
) {
  const line = document.createElement("p");
  line.textContent = message;
  if (className) line.className = className;
  else line.setAttribute("style", style);
  if (inMain) {
    const main = document.createElement("main");
    main.append(line);
    into.replaceChildren(main);
  } else {
    into.replaceChildren(line);
  }
}

/** Shows `message` and stops the page. */
export function stop(message: string, options?: ErrorOptions): never {
  showError(message, options);
  throw new PageError(message);
}

/** The owner passphrase gate; stops the page with `denied` when it is not passed. */
export async function requireOwner(denied: string, options?: ErrorOptions) {
  if (!(await ensureAuthed())) stop(denied, { style: ERROR_STYLE.denied, ...options });
}

/** The element a page renders into. */
export function mountPoint(id: string): HTMLElement {
  const mount = document.getElementById(id);
  if (!mount) throw new Error(`Missing #${id} mount point`);
  return mount;
}

/** Runs a page's main function; stops that already told the user are not logged. */
export function runPage(main: () => Promise<void>) {
  void main().catch((error: unknown) => {
    if (!(error instanceof PageError)) console.error(error);
  });
}
