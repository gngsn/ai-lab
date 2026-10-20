// P6-1: one index.html boots every React page. Each page must still start
// with what its own HTML used to give it (language, tab title, mount element,
// public stylesheets in the same order, classic scripts), under both the
// `.html` and the clean address, and the deck runtime pages stay plain files.
import type { Page } from "@playwright/test";
import { deckFrame, expect, test } from "../support/app";
import { DECK } from "../support/seed";

type Spec = {
  name: string;
  query: string;
  ready: string;
  lang: string;
  title: string; // the page may append the deck name later
  mount: "app" | "root";
  styles: string[]; // the public stylesheets, in order
};
const FONTS = "/vendor/fonts/fonts.css";
const SPECS: Spec[] = [
  {
    name: "index",
    query: "",
    ready: "#deck-list, #decks, .deck-card, h1",
    lang: "ko",
    title: "Speakeasy",
    mount: "app",
    styles: ["/css/theme.css"],
  },
  {
    name: "captions",
    query: `?deck=${DECK}`,
    ready: "#mic",
    lang: "en",
    title: "Live captions",
    mount: "app",
    styles: ["/css/theme.css"],
  },
  {
    name: "notes",
    query: `?deck=${DECK}`,
    ready: "#copy-btn, #download-btn, pre, textarea",
    lang: "ko",
    title: "Notes",
    mount: "app",
    styles: ["/css/theme.css"],
  },
  {
    name: "script",
    query: `?deck=${DECK}`,
    ready: "#app *",
    lang: "ko",
    title: "Script",
    mount: "app",
    styles: ["/css/theme.css", FONTS, "/css/shortcuts-help.css"],
  },
  {
    name: "script-edit",
    query: `?deck=${DECK}`,
    ready: "#edit-textarea",
    lang: "ko",
    title: "Notes",
    mount: "root",
    styles: ["/css/theme.css", FONTS, "/css/history-ui.css", "/css/shortcuts-help.css"],
  },
  {
    name: "pronunciation",
    query: `?deck=${DECK}`,
    ready: "#training-panel",
    lang: "en",
    title: "Pronunciation",
    mount: "root",
    styles: ["/css/theme.css", FONTS, "/css/training-panel.css"],
  },
  {
    name: "edit",
    query: `?deck=${DECK}`,
    ready: "#slide-list-items .slide-item",
    lang: "ko",
    title: "Edit",
    mount: "root",
    styles: [
      "/css/theme.css",
      FONTS,
      "/css/history-ui.css",
      "/css/shortcuts-help.css",
      "/css/training-panel.css",
      "/vendor/highlight.js/styles/github.min.css",
      "/vendor/highlight.js/styles/github-dark.min.css",
      "/vendor/codemirror/lib/codemirror.min.css",
      "/vendor/codemirror/theme/monokai.min.css",
    ],
  },
];

const publicStyles = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet]")]
      .map((l) => new URL(l.href).pathname)
      .filter((p) => p.startsWith("/css/") || p.startsWith("/vendor/")),
  );

for (const spec of SPECS) {
  for (const address of [`/${spec.name}.html`, `/${spec.name}`]) {
    test(`${address} starts like its old page`, async ({ page }) => {
      const url = `${spec.name === "index" && address === "/index" ? "/index.html" : address}${spec.query}`;
      if (spec.name === "index" && address === "/index") return; // covered by /index.html
      await page.goto(url);
      await expect(page.locator(spec.ready).first()).toBeAttached();
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(spec.lang);
      await expect.poll(() => page.title()).toMatch(new RegExp(`^${spec.title}`));
      await expect(page.locator(`body > #${spec.mount}`)).toHaveCount(1);
      await expect(page.locator(`body > #${spec.mount === "app" ? "root" : "app"}`)).toHaveCount(0);
      expect(await publicStyles(page)).toEqual(spec.styles);
    });
  }
}

test("/ opens the deck list", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body > #app")).toHaveCount(1);
  await expect(page).toHaveTitle("Speakeasy");
});

test("only the editor loads highlight.js and CodeMirror", async ({ page }) => {
  await page.goto(`/edit.html?deck=${DECK}`);
  await expect(page.locator("#slide-list-items .slide-item").first()).toBeAttached();
  const edit = await page.evaluate(() => ({
    hljs: typeof (window as { hljs?: unknown }).hljs,
    cm: typeof (window as { CodeMirror?: unknown }).CodeMirror,
  }));
  expect(edit).toEqual({ hljs: "object", cm: "function" });
  // the XML language pack and the XML editing mode come from their own scripts
  expect(
    await page.evaluate(() => {
      const w = window as unknown as {
        hljs: { getLanguage: (name: string) => unknown };
        CodeMirror: { modes: Record<string, unknown> };
      };
      return {
        hljsXml: Boolean(w.hljs.getLanguage("xml")),
        cmXml: Boolean(w.CodeMirror.modes.xml),
      };
    }),
  ).toEqual({ hljsXml: true, cmXml: true });
  await page.goto(`/notes.html?deck=${DECK}`);
  const notes = await page.evaluate(() => ({
    hljs: typeof (window as { hljs?: unknown }).hljs,
    cm: typeof (window as { CodeMirror?: unknown }).CodeMirror,
  }));
  expect(notes).toEqual({ hljs: "undefined", cm: "undefined" });
});

test("one page's own stylesheet does not leak into another", async ({ page }) => {
  await page.goto(`/notes.html?deck=${DECK}`);
  await expect(page.locator("body > #app")).toHaveCount(1);
  const own = await page.evaluate(
    () => document.querySelectorAll("link[rel=stylesheet][href*='/assets/']").length,
  );
  await page.goto(`/captions.html?deck=${DECK}`);
  await expect(page.locator("#mic")).toBeAttached();
  const captions = await page.evaluate(
    () => document.querySelectorAll("link[rel=stylesheet][href*='/assets/']").length,
  );
  expect(own).toBeGreaterThan(0);
  expect(captions).toBeGreaterThan(0);
  // a fresh document each time: the notes stylesheet is gone on the captions page
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet]")].map((l) => l.href),
  );
  expect(new Set(hrefs).size).toBe(hrefs.length);
});

test("the deck runtime pages are still plain files, not the app shell", async ({ page }) => {
  await page.goto(`/present.html?deck=${DECK}`);
  await deckFrame(page);
  await expect(page.locator("#__se_letterbox")).toHaveCount(1);
  await expect(page.locator("script[src*='/src/main'], script[src*='/assets/index-']")).toHaveCount(
    0,
  );
});
