// What a deck bootstrap (view, present, edit frame) shows in its document while
// it loads, and when it cannot. The document is replaced by the deck's own once
// loading succeeds.

/** The loading line, centred on the page background (light and dark). */
export function showLoading(text: string, fontPx = 14) {
  const style = document.createElement("style");
  style.textContent = `
body {
  margin: 0; background: #f2f2f2; color: #6b6c6e;
  color-scheme: light dark;
  font: ${fontPx}px ui-monospace, monospace;
  display: grid; place-items: center; height: 100vh;
}
@media (prefers-color-scheme: dark) {
  body { background: #19191a; color: #9a9a9c; }
}`;
  document.head.appendChild(style);
  const line = document.createElement("p");
  line.textContent = text;
  document.body.replaceChildren(line);
}

/** The failure page: the message as text in a <pre>. */
export function showFailure(message: string, style: string) {
  const pre = document.createElement("pre");
  pre.setAttribute("style", style);
  pre.textContent = message;
  document.body.replaceChildren(pre);
}
