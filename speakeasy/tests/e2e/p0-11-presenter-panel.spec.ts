// P0-11: the presenter view (present.html) shows a side panel with the
// current slide's key message and script, click cues that follow the
// fragments, the next slide, and can be hidden.
import { deckFrame, expect, press, test } from "../support/app";
import { DECK, KEY_MESSAGE } from "../support/seed";

test("the panel follows slides, cues and the key message", async ({ page }) => {
  await page.goto(`/present.html?deck=${DECK}`);
  await deckFrame(page);
  const panel = page.locator("#__se_panel");

  await expect(panel.locator(".pp-count")).toHaveText("1 / 6");
  await expect(panel.locator(".pp-title")).toHaveText("Opening");
  await expect(panel.locator(".pp-script")).toContainText("안녕하세요");
  await expect(panel.locator(".pp-next")).toContainText("Saved state");
  await expect(panel.locator(".pp-key")).toBeHidden();

  await press(page, "ArrowRight");
  await expect(panel.locator(".pp-count")).toHaveText("2 / 6");
  await expect(panel.locator(".pp-title")).toHaveText("Saved state");
  await expect(panel.locator(".pp-script")).toContainText("저장된 상태");

  // go to "Two steps" (one fragment on the way through "Saved state")
  await press(page, "ArrowRight", 2);
  await expect(panel.locator(".pp-title")).toHaveText(KEY_MESSAGE.title);
  await expect(panel.locator(".pp-key")).toBeVisible();
  await expect(panel.locator(".pp-key")).toContainText(KEY_MESSAGE.text);

  // two click cues: the next one is highlighted, passed ones dim
  const cues = panel.locator(".cue[data-cue]");
  await expect(cues).toHaveCount(2);
  await expect(cues.nth(0)).toHaveClass(/\bnext\b/);
  await expect(cues.nth(1)).not.toHaveClass(/\b(next|done)\b/);
  await press(page, "ArrowRight");
  await expect(cues.nth(0)).toHaveClass(/\bdone\b/);
  await expect(cues.nth(1)).toHaveClass(/\bnext\b/);
  await press(page, "ArrowRight");
  await expect(cues.nth(1)).toHaveClass(/\bdone\b/);

  await press(page, "End");
  await expect(panel.locator(".pp-count")).toHaveText("6 / 6");
  await expect(panel.locator(".pp-next")).toHaveText("Last slide");
});

test("the panel can be hidden and shown again", async ({ page }) => {
  await page.goto(`/present.html?deck=${DECK}`);
  await deckFrame(page);
  const stage = page.locator("#__se_stage");

  const shown = (await stage.boundingBox())!.width;
  expect(shown).toBeLessThan(1000);

  await page.locator(".pp-hide").click();
  await expect(page.locator("#__se_presenter")).toHaveClass(/panel-hidden/);
  await expect.poll(async () => (await stage.boundingBox())!.width).toBeGreaterThan(1270);
  await expect(page.locator(".pp-show")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("speakeasy:present:panel-hidden"))).toBe("1");

  await page.locator(".pp-show").click();
  await expect(page.locator("#__se_presenter")).not.toHaveClass(/panel-hidden/);
  expect(await page.evaluate(() => localStorage.getItem("speakeasy:present:panel-hidden"))).toBe("0");
});

test("text size is adjustable and remembered", async ({ page }) => {
  await page.goto(`/present.html?deck=${DECK}`);
  await deckFrame(page);
  const size = () => page.locator("#__se_panel").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const before = await size();
  await page.locator('.pp-bar [data-font="1"]').click();
  expect(await size()).toBeGreaterThan(before);
  expect(await page.evaluate(() => localStorage.getItem("speakeasy:present:fontsize"))).not.toBeNull();
});
