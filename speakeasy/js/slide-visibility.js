function getAttrValue(attrs, name) {
  const re = new RegExp(
    `\\b${name}\\s*(?:=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+)))?`,
    "i",
  );
  const m = attrs.match(re);
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
}

function getSectionNode(content) {
  const doc = new DOMParser().parseFromString(content, "text/html");
  return doc.querySelector("section");
}

export function isSlideHiddenContent(content) {
  const sectionMatch = String(content || "").match(/<section\b([^>]*)>/i);
  if (!sectionMatch) return false;
  const rawValue = getAttrValue(sectionMatch[1], "data-hidden");
  if (rawValue === null) return false;
  if (rawValue === "") return true;
  return /^(true|1|yes)$/i.test(rawValue);
}

export function setSlideHiddenContent(content, hidden) {
  const section = getSectionNode(content);
  if (!section) return content;
  if (hidden) section.setAttribute("data-hidden", "true");
  else section.removeAttribute("data-hidden");
  return section.outerHTML;
}
