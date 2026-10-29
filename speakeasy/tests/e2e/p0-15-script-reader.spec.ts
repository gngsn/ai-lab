// The script reader (teleprompter) follows the presenter, can switch to manual control, and has text
// size and highlight controls.
import { deckFrame, expect, press, test } from "../support/app";
import { DECK } from "../support/seed";

const room = "sr1";
const script = `/script.html?deck=${DECK}&sync=${room}`;

test("shows every slide's script with the current one active", async ({ page }) => {
  await page.goto(script);
  await expect(page.locator(".sec")).toHaveCount(6);
  await expect(page.locator("#slide-counter")).toHaveText("1 / 6");
  await expect(page.locator(".sec.active .sec-label")).toHaveText("Opening");
  await expect(page.locator(".sec.active .sec-body")).toContainText("안녕하세요");
});

test("follows the presenter, and manual mode ignores them", async ({ page, context }) => {
  await page.goto(script);
  await expect(page.locator(".sec")).toHaveCount(6);

  const presenterPage = await context.newPage();
  await presenterPage.goto(`/present.html?deck=${DECK}&sync=${room}`);
  await deckFrame(presenterPage);
  await press(presenterPage, "ArrowRight", 3); // Opening → Saved state → Two steps
  await expect(page.locator(".sec.active .sec-label")).toHaveText("Two steps", { timeout: 10_000 });
  await expect(page.locator("#slide-counter")).toHaveText("3 / 6");

  // manual mode: the badge toggles it and the presenter no longer moves us
  await page.locator("#sync-badge").click();
  await expect(page.locator("#mode-label")).toHaveText("· 수동");
  await presenterPage.bringToFront();
  await press(presenterPage, "ArrowRight", 2); // → Grouped, then its fragments
  await page.waitForTimeout(600);
  await expect(page.locator(".sec.active .sec-label")).toHaveText("Two steps");

  // keys move by hand (and switch to manual mode)
  await page.bringToFront();
  await page.keyboard.press("j");
  await expect(page.locator(".sec.active .sec-label")).toHaveText("Grouped");
  await page.keyboard.press("k");
  await page.keyboard.press("k");
  await expect(page.locator(".sec.active .sec-label")).toHaveText("Saved state");

  // clicking a section jumps to it
  await page.locator(".sec", { hasText: "Closing" }).click();
  await expect(page.locator("#slide-counter")).toHaveText("6 / 6");

  // back to automatic
  await page.locator("#sync-badge").click();
  await expect(page.locator("#mode-label")).toHaveText("");
});

test("text size and highlight controls", async ({ page }) => {
  await page.goto(script);
  const size = () =>
    page
      .locator(".sec-body")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const before = await size();
  await page.locator("#increaseFont").click();
  expect(await size()).toBeGreaterThan(before);
  await page.locator("#decreaseFont").click();
  await page.locator("#decreaseFont").click();
  expect(await size()).toBeLessThan(before);
  expect(
    await page.evaluate(() => localStorage.getItem("speakeasy:notes:fontsize")),
  ).not.toBeNull();

  await page.locator("#toggleHL").click();
  await expect(page.locator("#script")).toHaveClass(/\bno-hl\b/);
  await page.locator("#toggleHL").click();
  await expect(page.locator("#script")).not.toHaveClass(/\bno-hl\b/);
});
