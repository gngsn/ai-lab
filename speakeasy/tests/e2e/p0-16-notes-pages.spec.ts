// P0-16: the full notes editor (script-edit.html) and the Markdown notes
// view (notes.html).
import type { Page } from "@playwright/test";
import { dbRow, expect, readDb, test } from "../support/app";
import { DECK } from "../support/seed";

const secs = (page: Page) => page.locator("#edit-sections .edit-sec");
const sidOf = (page: Page, title: string) =>
  secs(page).filter({ hasText: title }).first().getAttribute("data-section-id");

async function openEditor(page: Page) {
  await page.goto(`/script-edit.html?deck=${DECK}`);
  await expect(secs(page)).toHaveCount(6);
}

test.describe("script-edit", () => {
  test("lists sections and shows the selected note", async ({ page }) => {
    await openEditor(page);
    await expect(secs(page).first()).toHaveClass(/\bactive\b/);
    await expect(page.locator("#edit-textarea")).toHaveValue(/안녕하세요/);

    await secs(page).filter({ hasText: "Two steps" }).click();
    await expect(page.locator("#edit-heading")).toHaveText("Two steps");
    await expect(page.locator("#edit-textarea")).toHaveValue(/두 단계로 나뉜 슬라이드입니다/);
  });

  test("autosaves, with a status, and records an auto history entry", async ({ page }) => {
    await openEditor(page);
    const sid = (await sidOf(page, "Opening"))!;
    await page.locator("#edit-textarea").fill("고친 대본");
    await expect(page.locator("#status")).toHaveText("saving…");
    await expect(page.locator("#status")).toHaveText(/^saved · /);
    expect((await dbRow(page, "notes", { deck_id: DECK, section_id: sid }))?.content).toBe(
      "고친 대본",
    );
    const history = (await readDb(page)).notes_history.filter(
      (h) => h.section_id === sid && h.kind === "auto",
    );
    expect(history.map((h) => h.content)).toContain("고친 대본");
  });

  test("switching sections saves the pending edit immediately", async ({ page }) => {
    await openEditor(page);
    const sid = (await sidOf(page, "Opening"))!;
    await page.locator("#edit-textarea").fill("바로 저장");
    await secs(page).filter({ hasText: "Closing" }).click(); // no 800ms wait
    await expect
      .poll(async () => (await dbRow(page, "notes", { deck_id: DECK, section_id: sid }))?.content)
      .toBe("바로 저장");
    await expect(page.locator("#edit-heading")).toHaveText("Closing");
  });

  test("the preview can be toggled and shows the rendered note", async ({ page }) => {
    await openEditor(page);
    await page.locator("#edit-textarea").fill("**굵게** 쓴 글");
    await expect(page.locator("#edit-preview strong")).toHaveText("굵게");
    const hidden = () => page.evaluate(() => document.body.classList.contains("hide-preview"));
    const before = await hidden();
    await page.locator("#preview-toggle").click();
    expect(await hidden()).toBe(!before);
  });

  test("Save version snapshots everything, and the history drawer lists it", async ({ page }) => {
    await openEditor(page);
    await page.locator("#save-version").click();
    await page.locator("#__se_prompt_input").fill("v1");
    await page.locator("#__se_prompt_ok").click();
    await expect(page.locator("#status")).toHaveText("version saved");

    const db = await readDb(page);
    expect(db.slide_history.filter((h) => h.kind === "manual" && h.message === "v1")).toHaveLength(
      6,
    );
    expect(db.notes_history.filter((h) => h.kind === "manual" && h.message === "v1")).toHaveLength(
      6,
    );
    expect(db.frame_history.filter((h) => h.kind === "manual" && h.message === "v1")).toHaveLength(
      1,
    );

    await page.locator("#history-toggle").click();
    await expect(page.locator("#hist-drawer")).toHaveClass(/\bopen\b/);
    await expect(page.locator("#history-panel")).toContainText("v1");
  });

  test("cancelling the version prompt saves nothing", async ({ page }) => {
    await openEditor(page);
    await page.locator("#save-version").click();
    await page.locator("#__se_prompt_cancel").click();
    expect((await readDb(page)).notes_history.filter((h) => h.kind === "manual")).toHaveLength(0);
  });
});

test.describe("notes view", () => {
  const open = async (page: Page) => {
    await page.goto(`/notes.html?deck=${DECK}`);
    await expect(page.locator("#content")).not.toBeEmpty();
  };

  test("shows every slide's note as Marp Markdown", async ({ page }) => {
    await open(page);
    await expect(page.locator("#deck-title")).toHaveText("Controller Deck");
    const text = await page.locator("#content").innerText();
    expect(text.startsWith("---\nmarp: true\ntheme: default\n---\n")).toBe(true);
    const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      "Opening",
      "Saved state",
      "Two steps",
      "Grouped",
      "Plain middle",
      "Closing",
    ]);
    expect(text.split("\n---\n").length).toBe(7); // front matter + 6 slides
    expect(text).toContain("두 단계로 나뉜 슬라이드입니다.");
  });

  test("copies the Markdown to the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);
    const shown = await page.locator("#content").innerText();
    await page.locator("#copy-btn").click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(`${shown.replace(/\n$/, "")}\n`);
  });

  test("downloads a .md file named after the deck", async ({ page }) => {
    await open(page);
    const download = page.waitForEvent("download");
    await page.locator("#download-btn").click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("controller-deck-notes.md");
  });
});
