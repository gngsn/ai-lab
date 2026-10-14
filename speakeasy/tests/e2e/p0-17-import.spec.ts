// P0-17: importing a deck (HTML + notes + key messages) from files, and
// re-importing parts of an existing deck.
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { dbRow, expect, readDb, test } from "../support/app";

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const NEW = "imported-deck";

async function runImport(page: Page, { notes = true, keys = true } = {}) {
  await page.goto("/index.html");
  await expect(page.locator(".deck-item")).toHaveCount(2);
  await page.locator("#import-html-btn").click();
  await expect(page.locator("#import-modal-bg")).toHaveClass(/\bshow\b/);
  await page.locator("#import-file").setInputFiles(fixture("controller-deck.html"));
  await page.locator("#import-deck-id").fill(NEW);
  await page.locator("#import-title").fill("Imported Deck");
  if (notes)
    await page.locator("#import-notes-file").setInputFiles(fixture("controller-deck.notes.md"));
  if (keys)
    await page.locator("#import-km-file").setInputFiles(fixture("controller-deck.keymessages.md"));
  await page.locator("#import-run-btn").click();
}

test("imports slides, notes and key messages, then opens the editor", async ({ page }) => {
  await runImport(page);
  await page.waitForURL(`**/edit.html?deck=${NEW}`);

  const db = await readDb(page);
  const deck = db.decks.find((d) => d.deck_id === NEW)!;
  expect(deck.title).toBe("Imported Deck");
  expect(String(deck.frame_html)).toContain("<!-- slides -->");

  const slides = db.slides
    .filter((s) => s.deck_id === NEW)
    .sort((a, b) => (a.order as number) - (b.order as number));
  expect(slides.map((s) => s.title)).toEqual([
    "Opening",
    "Saved state",
    "Two steps",
    "Grouped",
    "Plain middle",
    "Closing",
  ]);

  const notes = slides.map(
    (s) => db.notes.find((n) => n.deck_id === NEW && n.section_id === s.section_id)!,
  );
  expect(String(notes[0].content)).toContain("안녕하세요, 오늘 발표를 시작하겠습니다.");
  expect(String(notes[2].content)).toContain("두 단계로 나뉜 슬라이드입니다.");
  expect(notes.map((n) => n.key_message)).toEqual([
    "시작: 오늘의 한 문장",
    "저장된 상태는 숨겨진 채 시작한다",
    "두 단계, 하나의 생각",
    "한 번에 함께",
    "평범한 중간",
    "감사합니다",
  ]);
});

test("notes and key messages are optional", async ({ page }) => {
  await runImport(page, { notes: false, keys: false });
  await page.waitForURL(`**/edit.html?deck=${NEW}`);
  const db = await readDb(page);
  expect(db.slides.filter((s) => s.deck_id === NEW)).toHaveLength(6);
});

test("running without a file explains what is missing", async ({ page }) => {
  await page.goto("/index.html");
  await page.locator("#import-html-btn").click();
  await page.locator("#import-run-btn").click();
  await expect(page.locator("#import-error")).toBeVisible();
  await expect(page.locator("#import-error")).toContainText("Choose an HTML file");
  expect((await readDb(page)).decks).toHaveLength(2);
});

test("re-import replaces only the parts you pick", async ({ page }) => {
  await page.goto("/index.html");
  const item = page
    .locator(".deck-item")
    .filter({ has: page.locator('[title="controller-deck"]') });
  await item.locator("[data-reimport-deck]").click();
  await expect(page.locator("#reimport-modal-bg")).toHaveClass(/\bshow\b/);
  const run = page.locator("#reimport-run");
  await expect(run).toBeDisabled(); // nothing picked yet

  await page
    .locator('.reimport-part[data-part="keys"] input[type="file"]')
    .setInputFiles(fixture("controller-deck.keymessages.md"));
  await expect(run).toBeEnabled();
  await expect(run).toContainText("key messages", { ignoreCase: true });
  const slidesBefore = (await readDb(page)).slides.filter((s) => s.deck_id === "controller-deck");
  await run.click();
  await expect(page.locator("#reimport-modal-bg")).not.toHaveClass(/\bshow\b/);

  const db = await readDb(page);
  const closing = db.slides.find((s) => s.deck_id === "controller-deck" && s.title === "Closing")!;
  expect(
    (await dbRow(page, "notes", { deck_id: "controller-deck", section_id: closing.section_id }))
      ?.key_message,
  ).toBe("감사합니다");
  // slides and notes are untouched
  expect(db.slides.filter((s) => s.deck_id === "controller-deck")).toEqual(slidesBefore);
  expect(
    String(
      (await dbRow(page, "notes", { deck_id: "controller-deck", section_id: closing.section_id }))
        ?.content,
    ),
  ).toContain("들어주셔서 감사합니다");
});
