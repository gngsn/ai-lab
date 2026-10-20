// Shared "?" keyboard-help modal (port of public/js/shortcuts-help.js, same
// markup and behavior). Each page calls `bindShortcutsHelp("Page name", [...])`
// with its own shortcut list. The modal element is created on demand and
// inserted at the end of <body>.
export type Shortcut = { keys: string[]; desc: string };

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c] as string);

/** The modal's inner HTML. */
export function shortcutsHtml(pageName: string, shortcuts: Shortcut[]): string {
  return `
    <div class="sh-modal" role="dialog" aria-label="Keyboard shortcuts">
      <header>
        <h2>${escapeHtml(pageName)} <span>· Keyboard shortcuts</span></h2>
        <button class="sh-close" aria-label="Close">×</button>
      </header>
      <table>
        ${shortcuts
          .map(
            (s) => `
          <tr>
            <td class="sh-keys">${s.keys.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join(" ")}</td>
            <td>${escapeHtml(s.desc)}</td>
          </tr>`,
          )
          .join("")}
      </table>
      <footer>
        <kbd>?</kbd> toggle · <kbd>Esc</kbd> close
      </footer>
    </div>
  `;
}

function ensureModal(): HTMLElement {
  let modal = document.getElementById("__se_shortcuts_modal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "__se_shortcuts_modal";
  modal.className = "sh-modal-bg";
  document.body.appendChild(modal);
  return modal;
}

function close(modal: HTMLElement, onKey: (e: KeyboardEvent) => void) {
  modal.classList.remove("show");
  document.removeEventListener("keydown", onKey);
}

export function showShortcutsHelp(pageName: string, shortcuts: Shortcut[]) {
  const modal = ensureModal();
  modal.innerHTML = shortcutsHtml(pageName, shortcuts);
  modal.classList.add("show");

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close(modal, onKey);
  };
  const closeButton = modal.querySelector<HTMLElement>(".sh-close");
  if (closeButton) closeButton.onclick = () => close(modal, onKey);
  modal.onclick = (e) => {
    if (e.target === modal) close(modal, onKey);
  };
  document.addEventListener("keydown", onKey);
}

export function bindShortcutsHelp(pageName: string, shortcuts: Shortcut[]) {
  document.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (
      target?.tagName === "INPUT" ||
      target?.tagName === "TEXTAREA" ||
      target?.getAttribute?.("contenteditable") === "true"
    )
      return;
    // `?` is typically Shift+/ on US layouts; cover both literal key and the combo.
    if (e.key === "?" || (e.shiftKey && e.key === "/")) {
      e.preventDefault();
      const modal = document.getElementById("__se_shortcuts_modal");
      if (modal?.classList.contains("show")) {
        modal.classList.remove("show");
      } else {
        showShortcutsHelp(pageName, shortcuts);
      }
    }
  });
}
