// The canvas — the slide iframe and its messages, the < > preview steps, and the mode select (16:9,
// portrait, raw HTML, stretch).
import { type Page, expect as pwExpect } from "@playwright/test";
import { dbRow, expect, test } from "../support/app";
import { DECK } from "../support/seed";

const items = (page: Page) => page.locator("#slide-list-items .slide-item");
const frame = (page: Page) => page.frameLocator("#canvas");
const sectionIdOf = (page: Page, title: string) =>
  items(page).filter({ hasText: title }).first().getAttribute("data-section-id");

const path = "/edit.html";
test.describe(path, () => {
  const open = async (page: Page) => {
    await page.goto(`${path}?deck=${DECK}`);
    await pwExpect(items(page)).toHaveCount(6);
    await frame(page).locator("section").first().waitFor();
    // The inline editor reports in once it is up; later messages would race it.
    await expect(page.locator("#status")).toHaveText(/^ready · /);
  };

  test("shows the selected slide in the canvas and reports it ready", async ({ page }) => {
    await open(page);
    await expect(frame(page).locator("section.slide")).toHaveAttribute("data-title", "Opening");
    await expect(page.locator("#status")).toHaveText(/^ready · \d+ editables?$/);
    await items(page).filter({ hasText: "Two steps" }).click();
    await expect(frame(page).locator("section.slide")).toHaveAttribute("data-title", "Two steps");
  });

  test("saves what the inline editor sends and keeps it in the cache", async ({ page }) => {
    await open(page);
    const sid = (await sectionIdOf(page, "Opening"))!;
    const content =
      '<section class="slide" data-title="Opening"><h1>Edited in canvas</h1></section>';
    await page.evaluate(
      ([deck, section, html]) =>
        window.postMessage(
          { type: "edit:save", deck_id: deck, section_id: section, content: html },
          "*",
        ),
      [DECK, sid, content],
    );
    await expect(page.locator("#status")).toHaveText(/^saved · /);
    expect((await dbRow(page, "slides", { deck_id: DECK, section_id: sid }))?.content).toBe(
      content,
    );
    // The editor now hands the new content to the iframe from its cache.
    await items(page).filter({ hasText: "Closing" }).click();
    await items(page).filter({ hasText: "Opening" }).click();
    await expect(frame(page).locator("h1")).toHaveText("Edited in canvas");
  });

  test("shows the other inline-editor messages in the status bar", async ({ page }) => {
    await open(page);
    const post = (message: object) => page.evaluate((m) => window.postMessage(m, "*"), message);
    await post({ type: "edit:dirty" });
    await expect(page.locator("#status")).toHaveText("saving…");
    await post({ type: "edit:noop" });
    await expect(page.locator("#status")).toHaveText("no changes");
    await post({ type: "edit:ready", editable_count: 1 });
    await expect(page.locator("#status")).toHaveText("ready · 1 editable");
    await post({ type: "edit-frame:error", message: "boom" });
    await expect(page.locator("#status")).toHaveText("frame error");
    await expect(page.locator("#toast")).toHaveText("Frame: boom");
  });

  test("the < > buttons step the slide's reveals forward and back", async ({ page }) => {
    await open(page);
    await items(page).filter({ hasText: "Two steps" }).click();
    await frame(page).locator("section.slide .fragment").first().waitFor({ state: "attached" });
    const shown = frame(page).locator("section.slide .fragment.show");
    await expect(shown).toHaveCount(0);
    await page.locator("#canvas-preview-click").click();
    await expect(shown).toHaveCount(1);
    await page.locator("#canvas-preview-click").click();
    await expect(shown).toHaveCount(2);
    await page.locator("#canvas-preview-prev").click();
    await expect(shown).toHaveCount(1);
  });

  test("portrait mode moves the notes panel below and stretch frees the canvas", async ({
    page,
  }) => {
    await open(page);
    const body = page.locator("#body");
    const wrap = page.locator("#canvas-wrap");
    await expect(wrap).toHaveClass(/\baspect-169\b/);
    await page.locator("#mode-select").selectOption("portrait");
    await expect(body).toHaveClass(/\bportrait-mode\b/);
    await expect(wrap).toHaveClass(/\bportrait-169\b/);
    await expect(wrap).not.toHaveClass(/\baspect-169\b/);
    expect(await body.evaluate((el) => (el as HTMLElement).style.gridTemplateRows)).toBe(
      "minmax(0px, 1fr) 280px",
    );
    await page.locator("#mode-select").selectOption("stretch");
    await expect(body).not.toHaveClass(/\bportrait-mode\b/);
    await expect(wrap).not.toHaveClass(/aspect-169|portrait-169/);
    expect(await body.evaluate((el) => (el as HTMLElement).style.gridTemplateRows)).toBe("");
    expect(await page.locator("#canvas").evaluate((el) => el.style.transform)).toBe("");
    await page.locator("#mode-select").selectOption("aspect-169");
    await expect(wrap).toHaveClass(/\baspect-169\b/);
    await expect
      .poll(() => page.locator("#canvas").evaluate((el) => el.style.transform))
      .toMatch(/^scale\(/);
  });

  test("html mode edits the slide's HTML, formats it and saves it", async ({ page }) => {
    await open(page);
    const sid = (await sectionIdOf(page, "Opening"))!;
    await page.locator("#mode-select").selectOption("html");
    await expect(page.locator("#body")).toHaveClass(/\bhtml-mode\b/);
    await expect(page.locator("#canvas-wrap")).toHaveClass(/\bhtml-mode\b/);
    await expect(page.locator(".CodeMirror")).toBeVisible();
    await expect(page.locator(".CodeMirror")).toContainText("Opening");
    await expect(page.locator("#toast")).toHaveText(/HTML formatted|Already formatted/);

    // Typing saves after a pause; the slide's data-title updates its list title.
    const edited = '<section class="slide" data-title="Renamed here"><h1>Hello</h1></section>';
    await page.evaluate((html) => {
      (document.querySelector(".CodeMirror") as any).CodeMirror.setValue(html);
    }, edited);
    await expect(page.locator("#status")).toHaveText(/^HTML saved · /);
    expect((await dbRow(page, "slides", { deck_id: DECK, section_id: sid }))?.content).toBe(edited);
    await expect(items(page).first().locator(".title")).toContainText("Renamed here");

    // Switching slides in html mode shows the other slide's HTML.
    await items(page).filter({ hasText: "Closing" }).click();
    await expect(page.locator(".CodeMirror")).toContainText("Closing");
  });

  test("html without a <section> is refused and kept in the buffer", async ({ page }) => {
    await open(page);
    const sid = (await sectionIdOf(page, "Opening"))!;
    await page.locator("#mode-select").selectOption("html");
    await expect(page.locator(".CodeMirror")).toBeVisible();
    // Entering html mode formats the slide (and saves it if that changed anything).
    await expect(page.locator("#toast")).toHaveText(/HTML formatted|Already formatted/);
    if ((await page.locator("#toast").textContent()) === "HTML formatted") {
      await expect(page.locator("#status")).toHaveText(/^HTML saved · /);
    }
    const before = (await dbRow(page, "slides", { deck_id: DECK, section_id: sid }))?.content;
    await page.evaluate(() => {
      (document.querySelector(".CodeMirror") as any).CodeMirror.setValue("<p>no section</p>");
    });
    await expect(page.locator("#status")).toHaveText("HTML missing <section>");
    await expect(page.locator("#toast")).toHaveText(
      "HTML must contain a single <section>…</section> block.",
    );
    expect((await dbRow(page, "slides", { deck_id: DECK, section_id: sid }))?.content).toBe(before);
  });

  test("leaving html mode saves pending HTML first and shows the slide again", async ({ page }) => {
    await open(page);
    const sid = (await sectionIdOf(page, "Opening"))!;
    await page.locator("#mode-select").selectOption("html");
    await expect(page.locator(".CodeMirror")).toBeVisible();
    const edited = '<section class="slide" data-title="Opening"><h1>Saved on leave</h1></section>';
    await page.evaluate((html) => {
      (document.querySelector(".CodeMirror") as any).CodeMirror.setValue(html);
    }, edited);
    await page.locator("#mode-select").selectOption("aspect-169");
    await expect
      .poll(async () => (await dbRow(page, "slides", { deck_id: DECK, section_id: sid }))?.content)
      .toBe(edited);
    await expect(page.locator("#body")).not.toHaveClass(/\bhtml-mode\b/);
    await expect(frame(page).locator("h1")).toHaveText("Saved on leave");
  });
});
