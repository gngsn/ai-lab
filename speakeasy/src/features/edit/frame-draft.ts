// The frame_html editor works on three parts — the document HTML, all <style>
// blocks, all inline <script> blocks — and puts them back together on save.
// Port of the draft helpers in public/js/edit-bootstrap.js.
export type FramePart = "html" | "css" | "js";
export type FrameDraft = { html: string; css: string; js: string; jsType: "" | "module" };

export const FRAME_PART_INFO: Record<FramePart, { label: string; help: string }> = {
  html: { label: "HTML", help: "문서 구조, head, body, layout을 편집합니다." },
  css: { label: "CSS", help: "frame_html 안의 <style> 블록 전체를 편집합니다." },
  js: { label: "JS", help: "frame_html 안의 inline <script> 블록 전체를 편집합니다." },
};

const EMPTY_DOCUMENT = "<!doctype html><html><head></head><body></body></html>";

export const createEmptyFrameDraft = (): FrameDraft => ({ html: "", css: "", js: "", jsType: "" });

export function parseFrameDraft(frameHtml: string | null | undefined): FrameDraft {
  const parsed = new DOMParser().parseFromString(frameHtml || EMPTY_DOCUMENT, "text/html");
  const styleNodes = Array.from(parsed.querySelectorAll("style"));
  const scriptNodes = Array.from(parsed.querySelectorAll<HTMLScriptElement>("script:not([src])"));
  const css = styleNodes
    .map((node) => node.textContent ?? "")
    .filter(Boolean)
    .join("\n\n");
  const js = scriptNodes
    .map((node) => node.textContent ?? "")
    .filter(Boolean)
    .join("\n\n");
  const jsType = scriptNodes.some((node) => node.type === "module") ? "module" : "";

  for (const node of styleNodes) node.remove();
  for (const node of scriptNodes) node.remove();

  return { html: `<!doctype html>\n${parsed.documentElement.outerHTML}`, css, js, jsType };
}

export function serializeFrameDraft(draft: FrameDraft | null) {
  const parsed = new DOMParser().parseFromString(draft?.html || EMPTY_DOCUMENT, "text/html");

  for (const node of parsed.querySelectorAll("style")) node.remove();
  for (const node of parsed.querySelectorAll("script:not([src])")) node.remove();

  const css = (draft?.css ?? "").trimEnd();
  if (css) {
    const style = parsed.createElement("style");
    style.textContent = css;
    parsed.head?.appendChild(style);
  }

  const js = (draft?.js ?? "").trimEnd();
  if (js) {
    const script = parsed.createElement("script");
    if (draft?.jsType === "module") script.type = "module";
    script.textContent = js;
    parsed.body?.appendChild(script);
  }

  let html = `<!doctype html>\n${parsed.documentElement.outerHTML}`;
  const hadPlaceholder = html.includes("<!-- slides -->");
  if (!hadPlaceholder) {
    if (/<\/main>/i.test(html)) {
      html = html.replace(/<\/main>/i, "<!-- slides -->\n</main>");
    } else if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, "<!-- slides -->\n</body>");
    } else {
      html += "\n<!-- slides -->\n";
    }
  }
  return { html, insertedPlaceholder: !hadPlaceholder };
}
