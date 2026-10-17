// P4-7d: the notes panel — notes and key message with autosave, the notes font
// size, and importing key messages.
import { type Page, expect as pwExpect } from "@playwright/test";
import { dbRow, expect, test } from "../support/app";
import { DECK, KEY_MESSAGE } from "../support/seed";

const items = (page: Page) => page.locator("#slide-list-items .slide-item");
const sectionIdOf = (page: Page, title: string) =>
  items(page).filter({ hasText: title }).first().getAttribute("data-section-id");
const note = (page: Page, sid: string) => dbRow(page, "notes", { deck_id: DECK, section_id: sid });

const path = "/edit.html";
test.describe(path, () => {
  const open = async (page: Page) => {
    await page.goto(`${path}?deck=${DECK}`);
    await pwExpect(items(page)).toHaveCount(6);
    await expect(page.locator("#notes-textarea")).toHaveValue(/안녕하세요/);
    // The inline editor reports in once it is up; its status would race ours.
    await expect(page.locator("#status")).toHaveText(/^ready · /);
  };
  const select = async (page: Page, title: string) => {
    await items(page).filter({ hasText: title }).click();
    await expect(items(page).filter({ hasText: title })).toHaveClass(/\bactive\b/);
  };

  test("shows the selected slide's notes and key message", async ({ page }) => {
    await open(page);
    await expect(page.locator("#key-message-textarea")).toHaveValue("");
    await select(page, "Two steps");
    await expect(page.locator("#notes-textarea")).toHaveValue(/두 단계로 나뉜 슬라이드입니다/);
    await expect(page.locator("#key-message-textarea")).toHaveValue(KEY_MESSAGE.text);
    await expect(page.locator("#notes-textarea")).toBeEnabled();
  });

  test("autosaves the notes after a pause, with a status", async ({ page }) => {
    await open(page);
    const sid = (await sectionIdOf(page, "Opening"))!;
    await page.locator("#notes-textarea").fill("새 대본");
    await expect(page.locator("#status")).toHaveText("notes: saving…");
    await expect(page.locator("#status")).toHaveText(/^notes saved · /);
    expect((await note(page, sid))?.content).toBe("새 대본");
    // The cache is current: leaving and coming back shows the new text.
    await select(page, "Closing");
    await select(page, "Opening");
    await expect(page.locator("#notes-textarea")).toHaveValue("새 대본");
  });

  test("autosaves the key message without touching the notes", async ({ page }) => {
    await open(page);
    // (Stay on the first slide: a freshly selected slide's inline editor reports in later.)
    const sid = (await sectionIdOf(page, "Opening"))!;
    const notesBefore = (await note(page, sid))?.content;
    await page.locator("#key-message-textarea").fill("한 줄");
    await expect(page.locator("#status")).toHaveText("key message: saving…");
    await expect(page.locator("#status")).toHaveText(/^key message saved · /);
    expect((await note(page, sid))?.key_message).toBe("한 줄");
    expect((await note(page, sid))?.content).toBe(notesBefore);
  });

  test("switching slides saves pending notes and key message at once", async ({ page }) => {
    await open(page);
    const sid = (await sectionIdOf(page, "Opening"))!;
    await page.locator("#notes-textarea").fill("바로 저장 노트");
    await page.locator("#key-message-textarea").fill("바로 저장 요약");
    await items(page).filter({ hasText: "Closing" }).click();
    await expect.poll(async () => (await note(page, sid))?.content).toBe("바로 저장 노트");
    await expect.poll(async () => (await note(page, sid))?.key_message).toBe("바로 저장 요약");
  });

  test("the notes font size steps within 11–20 px and is remembered", async ({ page }) => {
    await open(page);
    const size = () =>
      page.evaluate(() => document.documentElement.style.getPropertyValue("--notes-font-size"));
    const stored = () => page.evaluate(() => localStorage.getItem("slidesEditor.notesFontSize"));
    expect(await size()).toBe("14px");
    await page.locator("#notes-size-up").click();
    expect(await size()).toBe("15px");
    expect(await stored()).toBe("15");
    for (let i = 0; i < 10; i++) await page.locator("#notes-size-up").click();
    expect(await size()).toBe("20px");
    for (let i = 0; i < 12; i++) await page.locator("#notes-size-down").click();
    expect(await size()).toBe("11px");
    await page.reload();
    await expect(page.locator("#notes-textarea")).toHaveValue(/안녕하세요/);
    expect(await size()).toBe("11px");
  });

  test("imports key messages by slide order, asking before replacing", async ({ page }) => {
    await open(page);
    const md = ["## A", "", "첫째", "", "---", "", "## B", "", "둘째"].join("\n");
    await page
      .locator("#key-message-import-file")
      .setInputFiles({ name: "keys.md", mimeType: "text/markdown", buffer: Buffer.from(md) });
    await expect(page.locator("#toast")).toHaveText(
      "Imported 2 key message(s) (file has 2, deck has 6 slides)",
    );
    const ids = await items(page).evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-section-id")),
    );
    expect((await note(page, ids[0]!))?.key_message).toBe("첫째");
    expect((await note(page, ids[1]!))?.key_message).toBe("둘째");
    expect((await note(page, ids[2]!))?.key_message).toBe(""); // replaced by "nothing"
    // The visible field follows the import.
    await expect(page.locator("#key-message-textarea")).toHaveValue("첫째");
    await expect(page.locator("#status")).toHaveText(/^key messages imported · /);
  });

  test("an import file without key messages is refused", async ({ page }) => {
    await open(page);
    await page.locator("#key-message-import-file").setInputFiles({
      name: "empty.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("   \n"),
    });
    await expect(page.locator("#toast")).toHaveText("No key messages found in empty.md");
  });
});
