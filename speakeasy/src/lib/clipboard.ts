// Copy text to the clipboard, also on plain-HTTP pages (e.g. the dev server
// opened via a LAN IP), where navigator.clipboard doesn't exist: fall back
// to a hidden textarea + execCommand("copy"). Resolves true when copied.
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* e.g. permission denied — try the fallback */
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.appendChild(textarea);
  const active = document.activeElement as HTMLElement | null;
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  textarea.remove();
  active?.focus?.();
  return ok;
}
