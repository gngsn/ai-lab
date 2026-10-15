// Pretty-printer for the editor's HTML mode (port of formatHtmlSource in
// public/js/edit-bootstrap.js, same output). Needs a DOM (<template>).
const INDENT = "  ";
const SELF_CLOSING = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const escapeAttr = (value: string) => String(value).replace(/"/g, "&quot;");

function formatNode(node: Node, depth: number): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    return text ? `${INDENT.repeat(depth)}${text}\n` : "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  const attrs = [...element.attributes]
    .map((attr) => `${attr.name}="${escapeAttr(attr.value)}"`)
    .join(" ");
  const openTag = attrs ? `<${tag} ${attrs}>` : `<${tag}>`;
  const children = [...element.childNodes].map((child) => formatNode(child, depth + 1)).join("");
  const textContent = (element.textContent ?? "").replace(/\s+/g, " ").trim();
  const hasElementChildren = [...element.childNodes].some(
    (child) => child.nodeType === Node.ELEMENT_NODE,
  );

  if (!children && !textContent && SELF_CLOSING.has(tag)) {
    return `${INDENT.repeat(depth)}<${tag}${attrs ? ` ${attrs}` : ""} />\n`;
  }
  if (!hasElementChildren && element.childNodes.length === 1) {
    return `${INDENT.repeat(depth)}${openTag}${textContent}</${tag}>\n`;
  }
  return `${INDENT.repeat(depth)}${openTag}\n${children}${INDENT.repeat(depth)}</${tag}>\n`;
}

export function formatHtmlSource(source: string): string {
  const preservedBlocks: string[] = [];
  const protectedSource = String(source).replace(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi, (match) => {
    const token = `__HTML_PRESERVE_BLOCK_${preservedBlocks.length}__`;
    preservedBlocks.push(match);
    return token;
  });
  const template = document.createElement("template");
  template.innerHTML = protectedSource.trim();
  const formatted = [...template.content.childNodes]
    .map((node) => formatNode(node, 0))
    .join("")
    .trimEnd();
  return preservedBlocks.reduce(
    (output, block, index) => output.replace(`__HTML_PRESERVE_BLOCK_${index}__`, block),
    formatted,
  );
}
