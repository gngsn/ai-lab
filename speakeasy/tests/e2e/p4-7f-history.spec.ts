// P4-7f (part 2): the history drawer in the editor — open/close, the timeline,
// the current-section filter, viewing a row and restoring slide / notes / frame
// rows. The same assertions run against the legacy /edit.html (the oracle) and
// the new /edit-next.html.
import type { Page } from "@playwright/test";
import { dbRow, expect, test } from "../support/app";
import { DECK } from "../support/seed";

const items = (page: Page) => page.locator("#slide-list-items .slide-item");
const rows = (page: Page) => page.locator("#history-panel .hist-row");

for (const path of ["/edit.html", "/edit-next.html"]) {
  test.describe(path, () => {
    const sidOf = (page: Page, index: number) =>
      items(page).nth(index).getAttribute("data-section-id");

    // Loads the editor with a few history rows already in the fake DB.
    const open = async (page: Page) => {
      await page.goto(`${path}?deck=${DECK}`);
      await expect(items(page)).toHaveCount(6);
      await expect(page.locator("#notes-textarea")).toHaveValue(/안녕하세요/);
      await expect(page.locator("#status")).toHaveText(/^ready · /);
      const first = (await sidOf(page, 0))!;
      const second = (await sidOf(page, 1))!;
      await page.evaluate(
        ({ deck, first, second }) => {
          const db = JSON.parse(localStorage.getItem("__fakedb") || "{}");
          const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes)).toISOString();
          db.slide_history = [
            {
              id: 1,
              deck_id: deck,
              section_id: first,
              kind: "manual",
              message: "first draft",
              created_at: at(1),
              content: `<section class="slide" data-section-id="${first}"><h1>Old heading</h1></section>`,
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
          ];
          db.frame_history = [
            {
              id: 4,
              deck_id: deck,
              section_id: "frame",
              kind: "auto",
              message: null,
              created_at: at(4),
              content:
                "<!doctype html><html><head><title>old frame</title></head><body><main><!-- slides --></main></body></html>",
            },
          ];
          localStorage.setItem("__fakedb", JSON.stringify(db));
        },
        { deck: DECK, first, second },
      );
      return { first, second };
    };
    // The open drawer covers the History button (and the More menu it lives in
    // closes itself), so a pointer click is unreliable on both pages: send the click.
    const clickToggle = (page: Page) => page.locator("#history-toggle").dispatchEvent("click");
    const openDrawer = async (page: Page) => {
      await clickToggle(page);
      await expect(page.locator("#hist-drawer")).toHaveClass(/\bopen\b/);
      await expect(page.locator("#history-panel .hist-list")).toBeVisible();
    };

    test("the toggle button and the H key open and close the drawer", async ({ page }) => {
      await open(page);
      const drawer = page.locator("#hist-drawer");
      const toggle = page.locator("#history-toggle");
      await expect(drawer).not.toHaveClass(/\bopen\b/);
      await clickToggle(page);
      await expect(drawer).toHaveClass(/\bopen\b/);
      await expect(toggle).toHaveClass(/\bactive\b/);
      await clickToggle(page);
      await expect(drawer).not.toHaveClass(/\bopen\b/);
      await expect(toggle).not.toHaveClass(/\bactive\b/);
      await page.locator("body").press("h");
      await expect(drawer).toHaveClass(/\bopen\b/);
      await page.locator("body").press("h");
      await expect(drawer).not.toHaveClass(/\bopen\b/);
    });

    test("× closes the drawer, and the next click on the button reopens it", async ({ page }) => {
      await open(page);
      await openDrawer(page);
      await page.locator('#history-panel [data-act="close"]').click();
      await expect(page.locator("#hist-drawer")).not.toHaveClass(/\bopen\b/);
      await expect(page.locator("#history-toggle")).not.toHaveClass(/\bactive\b/);
      await clickToggle(page);
      await expect(page.locator("#hist-drawer")).toHaveClass(/\bopen\b/);
      await expect(page.locator("#history-toggle")).toHaveClass(/\bactive\b/);
    });

    test("lists slide, notes and frame rows newest first", async ({ page }) => {
      const { first } = await open(page);
      await openDrawer(page);
      await expect(rows(page)).toHaveCount(4);
      await expect(rows(page).nth(0).locator(".h-src")).toHaveText("frame");
      await expect(rows(page).nth(0).locator(".h-sec")).toHaveText("frame");
      await expect(rows(page).nth(1).locator(".h-src")).toHaveText("notes");
      await expect(rows(page).nth(1).locator(".h-sec")).toHaveText(first);
      await expect(rows(page).nth(3).locator(".h-src")).toHaveText("slide");
      await expect(rows(page).nth(3).locator(".h-kind")).toHaveText("★");
      await expect(rows(page).nth(3).locator(".h-msg")).toHaveText("first draft");
      await expect(rows(page).nth(0).locator(".h-kind")).toHaveText("·");
    });

    test("'current section only' narrows the list to the selected slide", async ({ page }) => {
      const { first } = await open(page);
      await openDrawer(page);
      await expect(page.locator('#history-panel [data-act="filter"]')).toBeEnabled();
      await page.locator('#history-panel [data-act="filter"]').check();
      // The first slide's slide + notes rows, and the frame row (which belongs to no slide).
      await expect(rows(page)).toHaveCount(3);
      for (const code of await rows(page).locator(".h-sec").allTextContents()) {
        expect([first, "frame"]).toContain(code);
      }
    });

    test("view shows a row's content and hide closes it", async ({ page }) => {
      await open(page);
      await openDrawer(page);
      const slideRow = rows(page).nth(3);
      await slideRow.locator(".h-view").click();
      await expect(slideRow.locator(".hist-content")).toContainText("Old heading");
      await expect(slideRow.locator(".h-view")).toHaveText("hide");
      await slideRow.locator(".h-view").click();
      await expect(slideRow.locator(".hist-content")).toHaveCount(0);
    });

    test("restoring a slide row rewrites the slide and redraws the canvas", async ({ page }) => {
      const { first } = await open(page);
      await openDrawer(page);
      await rows(page).nth(3).locator(".h-restore").click(); // the confirm is accepted
      await expect(page.locator("#toast")).toHaveText("Restored");
      await expect
        .poll(async () =>
          String((await dbRow(page, "slides", { deck_id: DECK, section_id: first }))?.content),
        )
        .toContain("Old heading");
      await expect(page.frameLocator("#canvas").locator("h1")).toHaveText("Old heading");
    });

    test("restoring the current slide's notes row reloads the notes box", async ({ page }) => {
      const { first } = await open(page);
      await openDrawer(page);
      await rows(page).nth(1).locator(".h-restore").click();
      await expect(page.locator("#toast")).toHaveText("Restored");
      await expect(page.locator("#notes-textarea")).toHaveValue("첫 슬라이드의 옛 노트");
      expect((await dbRow(page, "notes", { deck_id: DECK, section_id: first }))?.content).toBe(
        "첫 슬라이드의 옛 노트",
      );
    });

    test("restoring another slide's notes row updates its cached notes", async ({ page }) => {
      const { second } = await open(page);
      await openDrawer(page);
      await rows(page).nth(2).locator(".h-restore").click();
      await expect(page.locator("#toast")).toHaveText("Restored");
      await expect
        .poll(
          async () => (await dbRow(page, "notes", { deck_id: DECK, section_id: second }))?.content,
        )
        .toBe("옛날 노트");
      await items(page).nth(1).click();
      await expect(items(page).nth(1)).toHaveClass(/\bactive\b/);
      await expect(page.locator("#notes-textarea")).toHaveValue("옛날 노트");
    });

    test("restoring a frame row rewrites frame_html", async ({ page }) => {
      await open(page);
      await openDrawer(page);
      await rows(page).nth(0).locator(".h-restore").click();
      await expect(page.locator("#toast")).toHaveText("Restored");
      await expect
        .poll(async () => String((await dbRow(page, "decks", { deck_id: DECK }))?.frame_html))
        .toContain("<title>old frame</title>");
    });

    test("declining the restore confirmation changes nothing", async ({ page }) => {
      const { first } = await open(page);
      await openDrawer(page);
      const before = (await dbRow(page, "slides", { deck_id: DECK, section_id: first }))?.content;
      page.removeAllListeners("dialog");
      page.once("dialog", (d) => {
        expect(d.message()).toContain(`Restore slide for '${first}'`);
        void d.dismiss();
      });
      await rows(page).nth(3).locator(".h-restore").click();
      await page.waitForTimeout(300);
      expect((await dbRow(page, "slides", { deck_id: DECK, section_id: first }))?.content).toBe(
        before,
      );
    });
  });
}
