// @ts-check
/**
 * @param {string} attrs
 * @param {string} name
 * @returns {string | null}
 */
function getAttrValue(attrs, name) {
  const re = new RegExp(
    `\\b${name}\\s*(?:=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+)))?`,
    "i",
  );
  const m = attrs.match(re);
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
}

/** @param {string} content */
function getSectionNode(content) {
  const doc = new DOMParser().parseFromString(content, "text/html");
  return doc.querySelector("section");
}

/**
 * @param {unknown} content
 * @returns {boolean}
 */
export function isSlideHiddenContent(content) {
  const sectionMatch = String(content || "").match(/<section\b([^>]*)>/i);
  if (!sectionMatch) return false;
  const rawValue = getAttrValue(sectionMatch[1], "data-hidden");
  if (rawValue === null) return false;
  if (rawValue === "") return true;
  return /^(true|1|yes)$/i.test(rawValue);
}

/**
 * @param {string} content
 * @param {boolean} hidden
 * @returns {string}
 */
export function setSlideHiddenContent(content, hidden) {
  const section = getSectionNode(content);
  if (!section) return content;
  if (hidden) section.setAttribute("data-hidden", "true");
  else section.removeAttribute("data-hidden");
  return section.outerHTML;
}
