// Hidden slides carry `data-hidden` on their <section>.
// Note: setSlideHiddenContent needs a DOM (DOMParser), unlike the rest of lib/.

function getAttrValue(attrs: string, name: string) {
  const re = new RegExp(`\\b${name}\\s*(?:=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+)))?`, "i");
  const m = attrs.match(re);
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
}

function getSectionNode(content: string) {
  const doc = new DOMParser().parseFromString(content, "text/html");
  return doc.querySelector("section");
}

export function isSlideHiddenContent(content: unknown): boolean {
  const sectionMatch = String(content || "").match(/<section\b([^>]*)>/i);
  if (!sectionMatch) return false;
  const rawValue = getAttrValue(sectionMatch[1], "data-hidden");
  if (rawValue === null) return false;
  if (rawValue === "") return true;
  return /^(true|1|yes)$/i.test(rawValue);
}

export function setSlideHiddenContent(content: string, hidden: boolean): string {
  const section = getSectionNode(content);
  if (!section) return content;
  if (hidden) section.setAttribute("data-hidden", "true");
  else section.removeAttribute("data-hidden");
  return section.outerHTML;
}
