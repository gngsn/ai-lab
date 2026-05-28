// Shared "?" keyboard-help modal. Each page calls
// `bindShortcutsHelp("Page name", [...])` with its own shortcut list.
// The modal DOM is created on demand and inserted at the end of <body>.

function ensureModal() {
  let modal = document.getElementById("__se_shortcuts_modal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "__se_shortcuts_modal";
  modal.className = "sh-modal-bg";
  document.body.appendChild(modal);
  return modal;
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function close(modal, onKey) {
  modal.classList.remove("show");
  if (onKey) document.removeEventListener("keydown", onKey);
}

export function showShortcutsHelp(pageName, shortcuts) {
  const modal = ensureModal();
  modal.innerHTML = `
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
            <td class="sh-keys">${s.keys
              .map((k) => `<kbd>${escapeHtml(k)}</kbd>`)
              .join(" ")}</td>
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
  modal.classList.add("show");

  const onKey = (e) => {
    if (e.key === "Escape") close(modal, onKey);
  };
  modal.querySelector(".sh-close").onclick = () => close(modal, onKey);
  modal.onclick = (e) => {
    if (e.target === modal) close(modal, onKey);
  };
  document.addEventListener("keydown", onKey);
}

export function bindShortcutsHelp(pageName, shortcuts) {
  document.addEventListener("keydown", (e) => {
    if (
      e.target?.tagName === "INPUT" ||
      e.target?.tagName === "TEXTAREA" ||
      e.target?.getAttribute?.("contenteditable") === "true"
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
