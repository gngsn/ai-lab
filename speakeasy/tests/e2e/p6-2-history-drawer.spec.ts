// P6-2: the history drawer on the script editor (the editor's own is pinned by
// p4-7f), plus the drawer details both pages share: the row content viewer and
// its 6000-character cut, the section label that only follows the section when
// the list is redrawn, and the error line.
import type { Page } from "@playwright/test";
import { expect, readDb, test } from "../support/app";
import { DECK } from "../support/seed";

const secs = (page: Page) => page.locator("#edit-sections .edit-sec");
const rows = (page: Page) => page.locator("#history-panel .hist-row");
const drawer = (page: Page) => page.locator("#hist-drawer");

const open = async (page: Page) => {
  await page.goto(`/script-edit.html?deck=${DECK}`);
  await expect(secs(page)).toHaveCount(6);
  await expect(page.locator("#edit-textarea")).toHaveValue(/안녕하세요/);
  const first = (await secs(page).nth(0).getAttribute("data-section-id"))!;
  const second = (await secs(page).nth(1).getAttribute("data-section-id"))!;
  await page.evaluate(
    ({ deck, first, second }) => {
      const db = JSON.parse(localStorage.getItem("__fakedb") || "{}");
      const at = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m)).toISOString();
      db.slide_history = [
        {
          id: 1,
          deck_id: deck,
          section_id: first,
          kind: "manual",
          message: "first <draft> & more",
          created_at: at(1),
          content: `<section data-section-id="${first}"><h1>Old & "heading"</h1></section>`,
        },
      ];
      db.notes_history = [
        {
          id: 2,
          deck_id: deck,
          section_id: second,
          kind: "auto",
          message: null,
          created_at: at(2),
          content: "옛날 노트",
        },
        {
          id: 3,
          deck_id: deck,
          section_id: first,
          kind: "auto",
          message: null,
          created_at: at(3),
          content: "첫 슬라이드의 옛 노트",
        },
        {
          id: 5,
          deck_id: deck,
          section_id: first,
          kind: "auto",
          message: null,
          created_at: at(5),
          content: `<${"a".repeat(2500)}>`,
        },
      ];
      db.frame_history = [
        {
          id: 4,
          deck_id: deck,
          section_id: "frame",
          kind: "auto",
          message: null,
          created_at: at(4),
          content: "<!doctype html><title>old</title><main><!-- slides --></main>",
        },
      ];
      localStorage.setItem("__fakedb", JSON.stringify(db));
    },
    { deck: DECK, first, second },
  );
  return { first, second };
};
const openDrawer = async (page: Page) => {
  await page.locator("#history-toggle").click();
  await expect(drawer(page)).toHaveClass(/\bopen\b/);
  await expect(rows(page).first()).toBeVisible();
};

test("the button and the H key open and close the drawer, and the button shows it", async ({
  page,
}) => {
  await open(page);
  await expect(drawer(page)).not.toHaveClass(/\bopen\b/);
  await page.locator("#history-toggle").click();
  await expect(drawer(page)).toHaveClass(/\bopen\b/);
  await expect(page.locator("#history-toggle")).toHaveClass(/\bactive\b/);
  await page.locator("#history-toggle").dispatchEvent("click");
  await expect(drawer(page)).not.toHaveClass(/\bopen\b/);
  await expect(page.locator("#history-toggle")).not.toHaveClass(/\bactive\b/);
  await page.locator("body").press("h");
  await expect(drawer(page)).toHaveClass(/\bopen\b/);
  await page.locator("body").press("h");
  await expect(drawer(page)).not.toHaveClass(/\bopen\b/);
});

test("× closes the drawer and the next click on the button reopens it", async ({ page }) => {
  await open(page);
  await openDrawer(page);
  await page.locator('#history-panel [data-act="close"]').click();
  await expect(drawer(page)).not.toHaveClass(/\bopen\b/);
  await expect(page.locator("#history-toggle")).not.toHaveClass(/\bactive\b/);
  await page.locator("#history-toggle").click();
  await expect(drawer(page)).toHaveClass(/\bopen\b/);
  await expect(page.locator("#history-toggle")).toHaveClass(/\bactive\b/);
});

test("nothing is drawn until the first open, then rows list newest first with their markers", async ({
  page,
}) => {
  await open(page);
  await expect(page.locator("#history-panel")).toBeEmpty();
  await openDrawer(page);
  await expect(rows(page)).toHaveCount(5);
  await expect(
    rows(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id)),
  ).resolves.toEqual(["5", "4", "3", "2", "1"]);
  const manual = rows(page).filter({ has: page.locator(".h-kind.manual") });
  await expect(manual).toHaveCount(1);
  await expect(manual.locator(".h-src")).toHaveText("slide");
  await expect(manual.locator(".h-msg")).toHaveText("first <draft> & more");
  await expect(
    rows(page)
      .filter({ has: page.locator(".h-src.frame") })
      .locator(".h-sec"),
  ).toHaveText("frame");
  await expect(page.locator("#history-panel .hist-head strong")).toHaveText("History");
});

test("'current section only' narrows the list; the label shows the section", async ({ page }) => {
  const { first } = await open(page);
  await openDrawer(page);
  await expect(page.locator(".hist-filter")).toContainText(`current section only (${first})`);
  await page.locator('#history-panel [data-act="filter"]').check();
  // the frame row has its own section ("frame"), so it stays in the list
  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).filter({ hasText: "옛날 노트" })).toHaveCount(0);
  await page.locator('#history-panel [data-act="filter"]').uncheck();
  await expect(rows(page)).toHaveCount(5);
});

test("the section label follows the selected section only when the list is redrawn", async ({
  page,
}) => {
  const { first, second } = await open(page);
  await openDrawer(page);
  await secs(page).nth(1).click();
  await expect(page.locator("#edit-sections .edit-sec.active")).toHaveAttribute(
    "data-section-id",
    second,
  );
  await expect(page.locator(".hist-filter code")).toHaveText(first);
  await page.locator('#history-panel [data-act="refresh"]').click();
  await expect(page.locator(".hist-filter code")).toHaveText(second);
});

test("view shows a row's content (escaped), hide closes it, one row at a time", async ({
  page,
}) => {
  await open(page);
  await openDrawer(page);
  const slideRow = rows(page).filter({ has: page.locator(".h-src.slide") });
  await slideRow.locator(".h-view").click();
  await expect(slideRow.locator(".hist-content")).toContainText('<h1>Old & "heading"</h1>');
  await expect(slideRow.locator(".h-view")).toHaveText("hide");
  const noteRow = page.locator('.hist-row[data-id="2"]');
  await noteRow.locator(".h-view").click();
  await expect(noteRow.locator(".hist-content")).toHaveText("옛날 노트");
  await expect(page.locator("#history-panel .hist-content")).toHaveCount(1);
  await noteRow.locator(".h-view").click();
  await expect(page.locator("#history-panel .hist-content")).toHaveCount(0);
});

test("a long row is cut at 6000 characters of the escaped text", async ({ page }) => {
  await open(page);
  const addRow = (id: number, content: string) =>
    page.evaluate(
      ({ id, content }) => {
        const db = JSON.parse(localStorage.getItem("__fakedb") || "{}");
        db.notes_history.push({
          id,
          deck_id: db.decks[0].deck_id,
          section_id: db.slides[0].section_id,
          kind: "auto",
          message: null,
          created_at: new Date(Date.UTC(2026, 0, 1, 1, id)).toISOString(),
          content,
        });
        localStorage.setItem("__fakedb", JSON.stringify(db));
      },
      { id, content },
    );
  // 2502 raw characters, 2510 once escaped: shown whole
  await openDrawer(page);
  const whole = page.locator('.hist-row[data-id="5"]');
  await whole.locator(".h-view").click();
  expect(await whole.locator(".hist-content").innerText()).toBe(`<${"a".repeat(2500)}>`);
  // 5000 raw characters, 8000 escaped: cut at 6000 escaped characters (1500 of the "<"),
  // and no note, because the note only follows the RAW length (legacy behavior)
  await addRow(9, `${"<".repeat(2000)}${"x".repeat(3000)}`);
  // 7000 raw characters: cut, with the note
  await addRow(10, `${"<".repeat(2000)}${"x".repeat(5000)}`);
  await page.locator('#history-panel [data-act="refresh"]').click();
  const silent = page.locator('.hist-row[data-id="9"]');
  await silent.locator(".h-view").click();
  expect(await silent.locator(".hist-content").innerText()).toBe("<".repeat(1500));
  const noted = page.locator('.hist-row[data-id="10"]');
  await noted.locator(".h-view").click();
  expect(await noted.locator(".hist-content").innerText()).toBe(
    `${"<".repeat(1500)}\n… (truncated)`,
  );
});

test("restoring a notes row rewrites the note, redraws the list and shows it in the editor", async ({
  page,
}) => {
  const { first, second } = await open(page);
  await openDrawer(page);
  // Move to the second section: the label keeps the first one until the list is redrawn,
  // so a changed label after the restore proves the redraw. The restore targets the
  // first section's row while another section is selected.
  await secs(page).nth(1).click();
  await expect(page.locator(".hist-filter code")).toHaveText(first);
  await page.locator('.hist-row[data-id="3"]').locator(".h-restore").click();
  await expect(page.locator("#status")).toHaveText("restored");
  await expect(page.locator(".hist-filter code")).toHaveText(second);
  expect((await readDb(page)).notes.find((n) => n.section_id === first)?.content).toBe(
    "첫 슬라이드의 옛 노트",
  );
  // coming back to the first section shows the restored text
  await secs(page).nth(0).click();
  await expect(page.locator("#edit-textarea")).toHaveValue("첫 슬라이드의 옛 노트");
});

test("restoring the open section's notes row updates the editor at once", async ({ page }) => {
  await open(page);
  await openDrawer(page);
  await page.locator('.hist-row[data-id="3"]').locator(".h-restore").click();
  await expect(page.locator("#edit-textarea")).toHaveValue("첫 슬라이드의 옛 노트");
  await expect(page.locator("#status")).toHaveText("restored");
});

test("declining the confirmation changes nothing", async ({ page }) => {
  const { first } = await open(page);
  await openDrawer(page);
  page.removeAllListeners("dialog");
  page.once("dialog", (d) => void d.dismiss());
  const before = await page.locator("#edit-textarea").inputValue();
  await page.locator('.hist-row[data-id="3"]').locator(".h-restore").click();
  await page.waitForTimeout(300);
  await expect(page.locator("#edit-textarea")).toHaveValue(before);
  expect((await readDb(page)).notes.find((n) => n.section_id === first)?.content).toBe(before);
});

test("Save version refreshes an open drawer", async ({ page }) => {
  await open(page);
  await openDrawer(page);
  await page.locator("#save-version").click();
  await page.locator("#__se_prompt_input").fill("snap");
  await page.locator("#__se_prompt_ok").click();
  await expect(page.locator("#status")).toHaveText("version saved");
  await expect(page.locator("#history-panel .h-msg", { hasText: "snap" }).first()).toBeVisible();
});

test("a failed load shows only the error, and the next open recovers", async ({ page }) => {
  await open(page);
  const good = await page.evaluate(() => localStorage.getItem("__fakedb") ?? "");
  await page.evaluate(() => localStorage.setItem("__fakedb", "{ not json"));
  await page.locator("#history-toggle").click();
  await expect(page.locator("#history-panel .hist-err")).toBeVisible();
  await expect(page.locator("#history-panel .hist-head")).toHaveCount(0);
  await expect(rows(page)).toHaveCount(0);
  await page.evaluate((db) => localStorage.setItem("__fakedb", db), good);
  await page.locator("#history-toggle").dispatchEvent("click"); // close
  await page.locator("#history-toggle").dispatchEvent("click"); // reopen: reloads
  await expect(rows(page)).toHaveCount(5);
  await expect(page.locator("#history-panel .hist-err")).toHaveCount(0);
});
