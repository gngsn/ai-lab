// P4-7b: the slide list (selecting, renaming, adding, duplicating, hiding,
// deleting and dragging slides). The same assertions run against the legacy
// /edit.html (the oracle) and the new /edit-next.html.
import { type Page, expect as pwExpect } from "@playwright/test";
import { dbRow, expect, readDb, test } from "../support/app";
import { DECK, KEY_MESSAGE } from "../support/seed";

const items = (page: Page) => page.locator("#slide-list-items .slide-item");
const titles = async (page: Page) =>
  (await items(page).locator(".title").allInnerTexts()).map((t) => t.trim());
const sectionIdOf = (page: Page, title: string) =>
  items(page).filter({ hasText: title }).first().getAttribute("data-section-id");
async function slideAction(
  page: Page,
  title: string,
  action: "toggle-hidden" | "duplicate" | "delete",
) {
  const item = items(page).filter({ hasText: title }).first();
  await item.hover();
  await item.locator("summary").click();
  await item.locator(`.slide-action-${action}`).click();
}

for (const path of ["/edit.html", "/edit-next.html"]) {
  test.describe(path, () => {
    const open = async (page: Page) => {
      await page.goto(`${path}?deck=${DECK}`);
      await pwExpect(items(page)).toHaveCount(6);
      // Let the canvas finish loading: it takes the focus when it does.
      await page.frameLocator("#canvas").locator("section").first().waitFor();
      // Its "ready" status arrives late and would overwrite the statuses asserted below.
      await expect(page.locator("#status")).toHaveText(/^ready · /);
    };

    test("lists the slides in order, numbered, with the first one selected", async ({ page }) => {
      await open(page);
      await expect(page.locator("#slide-list-count")).toHaveText("6 slides");
      expect(await titles(page)).toEqual([
        "Opening",
        "Saved state",
        "Two steps",
        "Grouped",
        "Plain middle",
        "Closing",
      ]);
      await expect(items(page).nth(0).locator(".order")).toHaveText("1");
      await expect(items(page).nth(0)).toHaveClass(/\bactive\b/);
      await expect(page.locator("#slide-list-title")).toHaveValue("Opening");
      await expect(page.locator("#canvas")).toHaveAttribute(
        "src",
        new RegExp(`edit-frame\\.html\\?deck=${DECK}&section=.+&edit=1`),
      );
    });

    test("selecting a slide marks it, loads it in the canvas and updates Present", async ({
      page,
    }) => {
      await open(page);
      const sid = (await sectionIdOf(page, "Two steps"))!;
      await items(page).filter({ hasText: "Two steps" }).click();
      await expect(items(page).filter({ hasText: "Two steps" })).toHaveClass(/\bactive\b/);
      await expect(items(page).nth(0)).not.toHaveClass(/\bactive\b/);
      await expect(page.locator("#slide-list-title")).toHaveValue("Two steps");
      await expect(page.locator("#canvas")).toHaveAttribute("src", new RegExp(`section=${sid}`));
      await expect(page.locator("#present-link")).toHaveAttribute(
        "href",
        new RegExp(`section=${sid}`),
      );
      expect(
        await page.evaluate((k) => localStorage.getItem(k), `slidesEditor.lastSectionId:${DECK}`),
      ).toBe(sid);

      await page.reload();
      await pwExpect(items(page)).toHaveCount(6);
      await expect(items(page).filter({ hasText: "Two steps" })).toHaveClass(/\bactive\b/);
    });

    test("renaming a slide saves the title after a pause and shows it in the list", async ({
      page,
    }) => {
      await open(page);
      const sid = (await sectionIdOf(page, "Opening"))!;
      await page.locator("#slide-list-title").fill("First words");
      await expect(page.locator("#status")).toHaveText("title: saving…");
      await expect(page.locator("#status")).toHaveText("title saved");
      expect((await dbRow(page, "slides", { deck_id: DECK, section_id: sid }))?.title).toBe(
        "First words",
      );
      expect((await titles(page))[0]).toBe("First words");
    });

    test("Enter saves the title at once; switching slides saves a pending title", async ({
      page,
    }) => {
      await open(page);
      const first = (await sectionIdOf(page, "Opening"))!;
      await page.locator("#slide-list-title").fill("Quick");
      await page.locator("#slide-list-title").press("Enter");
      await expect
        .poll(
          async () => (await dbRow(page, "slides", { deck_id: DECK, section_id: first }))?.title,
        )
        .toBe("Quick");

      await page.locator("#slide-list-title").fill("Before switching");
      await items(page).filter({ hasText: "Closing" }).click();
      await expect
        .poll(
          async () => (await dbRow(page, "slides", { deck_id: DECK, section_id: first }))?.title,
        )
        .toBe("Before switching");
      // (Not asserted: which slide is selected after that click. The old page redraws its list
      // when the blur save finishes, which can swallow the click; the new page keeps it.)
    });

    test("hiding a slide marks it and shows Show in its menu", async ({ page }) => {
      await open(page);
      await slideAction(page, "Plain middle", "toggle-hidden");
      const item = items(page).filter({ hasText: "Plain middle" });
      await expect(item).toHaveAttribute("data-hidden", "true");
      await expect(item.locator(".hidden-slide-icon")).toHaveCount(1);
      await expect(page.locator("#toast")).toHaveText("Slide hidden in presentation");
      const sid = (await sectionIdOf(page, "Plain middle"))!;
      await expect
        .poll(async () =>
          String((await dbRow(page, "slides", { deck_id: DECK, section_id: sid }))?.content),
        )
        .toContain("data-hidden");
      await item.hover();
      await item.locator("summary").click();
      await expect(item.locator(".slide-action-toggle-hidden")).toHaveText("Show");
      await item.locator(".slide-action-toggle-hidden").click();
      await expect(item).toHaveAttribute("data-hidden", "false");
      await expect(item.locator(".hidden-slide-icon")).toHaveCount(0);
    });

    test("duplicating copies the slide with its notes and key message", async ({ page }) => {
      await open(page);
      await slideAction(page, "Two steps", "duplicate");
      await expect(items(page)).toHaveCount(7);
      await expect(page.locator("#slide-list-count")).toHaveText("7 slides");
      expect((await titles(page))[3]).toBe("Two steps (copy)");
      await expect(items(page).nth(3)).toHaveClass(/\bactive\b/);
      await expect(page.locator("#toast")).toHaveText("Duplicated");

      const db = await readDb(page);
      const rows = db.slides.filter((s) => s.deck_id === DECK);
      expect(rows).toHaveLength(7);
      expect(rows.map((s) => s.order).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
      const copies = db.notes.filter(
        (n) => n.deck_id === DECK && n.key_message === KEY_MESSAGE.text,
      );
      expect(copies).toHaveLength(2);
      expect(new Set(copies.map((n) => n.content)).size).toBe(1);
    });

    test("deleting a slide removes it and selects its neighbour", async ({ page }) => {
      await open(page);
      await items(page).filter({ hasText: "Grouped" }).click();
      const sid = (await sectionIdOf(page, "Grouped"))!;
      await slideAction(page, "Grouped", "delete"); // the confirm dialog is accepted
      await expect(items(page)).toHaveCount(5);
      await expect(page.locator("#slide-list-count")).toHaveText("5 slides");
      await expect(items(page).filter({ hasText: "Plain middle" })).toHaveClass(/\bactive\b/);
      await expect
        .poll(async () => await dbRow(page, "slides", { deck_id: DECK, section_id: sid }))
        .toBeUndefined();
    });

    test("adding a slide appends and selects it", async ({ page }) => {
      await open(page);
      await page.locator("#add-slide").click();
      await expect(items(page)).toHaveCount(7);
      await expect(items(page).nth(6)).toHaveClass(/\bactive\b/);
      await expect(page.locator("#slide-list-title")).toHaveValue("Untitled");
      await expect(page.locator("#toast")).toHaveText("Slide added");
      const db = await readDb(page);
      const orders = db.slides.filter((s) => s.deck_id === DECK).map((s) => s.order as number);
      expect(Math.max(...orders)).toBe(6);
    });

    test("dragging a slide reorders the list and the saved order", async ({ page }) => {
      await open(page);
      const before = await titles(page);
      await items(page).nth(0).dragTo(items(page).nth(2));
      await expect.poll(() => titles(page)).not.toEqual(before);
      const after = await titles(page);
      expect(after).toHaveLength(6);
      expect(after[0]).not.toBe("Opening");
      await expect(page.locator("#toast")).toHaveText("Reordered");
      await expect
        .poll(async () => {
          const db = await readDb(page);
          return db.slides
            .filter((s) => s.deck_id === DECK)
            .sort((a, b) => (a.order as number) - (b.order as number))
            .map((s) => s.title);
        })
        .toEqual(after);
    });
  });
}
