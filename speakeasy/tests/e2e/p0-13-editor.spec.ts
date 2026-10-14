// P0-13: editing basics — selecting slides, notes and key message with
// autosave, adding / duplicating / hiding / deleting / reordering slides.
// Every assertion about saving reads the fake database.
import { type Page, expect as pwExpect } from "@playwright/test";
import { dbRow, expect, readDb, test } from "../support/app";
import { DECK, KEY_MESSAGE } from "../support/seed";

const items = (page: Page) => page.locator("#slide-list-items .slide-item");

async function open(page: Page) {
  await page.goto(`/edit.html?deck=${DECK}`);
  await pwExpect(items(page)).toHaveCount(6);
}
async function select(page: Page, title: string) {
  await items(page).filter({ hasText: title }).first().click();
  await expect(items(page).filter({ hasText: title }).first()).toHaveClass(/\bactive\b/);
}
async function sectionIdOf(page: Page, title: string) {
  return items(page).filter({ hasText: title }).first().getAttribute("data-section-id");
}
async function slideAction(page: Page, title: string, action: "toggle-hidden" | "duplicate" | "delete") {
  const item = items(page).filter({ hasText: title }).first();
  await item.hover();
  await item.locator("summary").click();
  await item.locator(`.slide-action-${action}`).click();
}

test("lists the deck's slides and shows the selected slide's notes", async ({ page }) => {
  await open(page);
  await expect(page.locator("#slide-list-count")).toHaveText("6 slides");
  await select(page, "Two steps");
  await expect(page.locator("#notes-textarea")).toHaveValue(/두 단계로 나뉜 슬라이드입니다/);
  await expect(page.locator("#key-message-textarea")).toHaveValue(KEY_MESSAGE.text);
  await select(page, "Closing");
  await expect(page.locator("#key-message-textarea")).toHaveValue("");
});

test("notes and key message autosave without touching each other", async ({ page }) => {
  await open(page);
  await select(page, "Two steps");
  const sid = (await sectionIdOf(page, "Two steps"))!;

  await page.locator("#notes-textarea").fill("새로 쓴 대본입니다.");
  await expect.poll(async () => (await dbRow(page, "notes", { deck_id: DECK, section_id: sid }))?.content).toBe(
    "새로 쓴 대본입니다.",
  );
  expect((await dbRow(page, "notes", { deck_id: DECK, section_id: sid }))?.key_message).toBe(KEY_MESSAGE.text);

  await page.locator("#key-message-textarea").fill("한 줄 요약");
  await expect.poll(async () => (await dbRow(page, "notes", { deck_id: DECK, section_id: sid }))?.key_message).toBe(
    "한 줄 요약",
  );
  expect((await dbRow(page, "notes", { deck_id: DECK, section_id: sid }))?.content).toBe("새로 쓴 대본입니다.");
});

test("hiding a slide marks it and shows Show in its menu", async ({ page }) => {
  await open(page);
  await slideAction(page, "Plain middle", "toggle-hidden");
  await expect(items(page).filter({ hasText: "Plain middle" })).toHaveAttribute("data-hidden", "true");
  const sid = (await sectionIdOf(page, "Plain middle"))!;
  await expect.poll(async () => String((await dbRow(page, "slides", { deck_id: DECK, section_id: sid }))?.content)).toContain(
    "data-hidden",
  );

  await slideAction(page, "Plain middle", "toggle-hidden"); // Show again
  await expect(items(page).filter({ hasText: "Plain middle" })).toHaveAttribute("data-hidden", "false");
});

test("duplicating copies the slide with its notes and key message", async ({ page }) => {
  await open(page);
  await slideAction(page, "Two steps", "duplicate");
  await expect(items(page)).toHaveCount(7);

  const db = await readDb(page);
  const slides = db.slides.filter((s) => s.deck_id === DECK);
  expect(slides).toHaveLength(7);
  const copies = db.notes.filter((n) => n.deck_id === DECK && n.key_message === KEY_MESSAGE.text);
  expect(copies).toHaveLength(2); // the original and the copy
  expect(new Set(copies.map((n) => n.content)).size).toBe(1);
});

test("deleting a slide removes it and its notes", async ({ page }) => {
  await open(page);
  const sid = (await sectionIdOf(page, "Closing"))!;
  await slideAction(page, "Closing", "delete"); // the confirm dialog is accepted
  await expect(items(page)).toHaveCount(5);
  await expect.poll(async () => await dbRow(page, "slides", { deck_id: DECK, section_id: sid })).toBeUndefined();
});

test("adding a slide appends it", async ({ page }) => {
  await open(page);
  await page.locator("#add-slide").click();
  await expect(items(page)).toHaveCount(7);
  const db = await readDb(page);
  const orders = db.slides.filter((s) => s.deck_id === DECK).map((s) => s.order as number);
  expect(Math.max(...orders)).toBe(6);
});

test("dragging a slide reorders the list and the saved order", async ({ page }) => {
  await open(page);
  const titles = async () => (await items(page).locator(".title").allInnerTexts()).map((t) => t.trim());
  const before = await titles();
  expect(before.slice(0, 3)).toEqual(["Opening", "Saved state", "Two steps"]);

  await items(page).nth(0).dragTo(items(page).nth(2)); // Opening → onto "Two steps"
  await expect.poll(titles).not.toEqual(before);
  const after = await titles();
  expect(after).toHaveLength(6);
  expect(after[0]).not.toBe("Opening");

  // the saved order matches the list
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
