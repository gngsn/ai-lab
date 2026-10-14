// P0-12: live captions. The speaker's recognized speech is matched to a line
// of the bilingual script, and that line's reviewed English goes to the
// audience page (CC toggle there). Microphone and Chrome's translator are
// not available to tests, so speech is fed in through window.__seCaptions.
import type { Page } from "@playwright/test";
import { deckFrame, expect, press, test } from "../support/app";
import { BILINGUAL, DECK, TOKEN } from "../support/seed";

const room = "cc1";
const LINE = "This slide is split into two steps."; // "두 단계로 나뉜 슬라이드입니다."
const HEARD = "두단계로나뉜슬라이드입니다"; // spaces lost, as speech recognition often does

test.beforeEach(async ({ context }) => {
  await context.addInitScript(({ md, key }) => localStorage.setItem(key, md), {
    md: BILINGUAL,
    key: `speakeasy:captions:script:${DECK}`,
  });
});

async function goToTwoSteps(page: Page) {
  await page.goto(`/present.html?deck=${DECK}&sync=${room}`);
  await deckFrame(page);
  await press(page, "ArrowRight", 3); // Opening → Saved state (+ its fragment) → Two steps
  await expect(page.locator("#__se_panel .pp-title")).toHaveText("Two steps");
}

test("a heard line is sent to the audience, and CC hides it", async ({ page, context }) => {
  await goToTwoSteps(page);
  await expect(page.locator(".pp-cc")).toHaveAttribute("data-state", "ready");

  const audience = await context.newPage();
  await audience.goto(`/share.html?deck=${DECK}&token=${TOKEN}&sync=${room}`);
  await deckFrame(audience);

  await page.bringToFront();
  await page.evaluate((t) => (window as any).__seCaptions.feed(t, true), HEARD);

  const box = audience.locator("#__se_cc_box");
  await expect(box).toHaveText(LINE);
  await expect(box).toHaveClass(/\bshow\b/);
  await expect(page.locator(".pp-cap-en")).toHaveText(LINE); // also shown in the panel

  const toggle = audience.locator("#__se_cc_toggle");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(box).not.toHaveClass(/\bshow\b/);

  // turning CC back on shows nothing until the next caption arrives
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(box).not.toHaveClass(/\bshow\b/);
  await page.evaluate(() =>
    (window as any).__seCaptions.feed("첫번째단계를보여드리겠습니다", true),
  );
  await expect(box).toHaveText("Let me show you the first step.");
  await expect(box).toHaveClass(/\bshow\b/);
});

test("speech that is not in the script sends nothing", async ({ page, context }) => {
  await goToTwoSteps(page);
  const audience = await context.newPage();
  await audience.goto(`/share.html?deck=${DECK}&token=${TOKEN}&sync=${room}`);
  await deckFrame(audience);

  await page.bringToFront();
  await page.evaluate(() =>
    (window as any).__seCaptions.feed("잠깐 물 좀 마시고 하겠습니다", true),
  );
  await page.waitForTimeout(800);
  await expect(audience.locator("#__se_cc_box")).toHaveText("");
});

test("the caption console follows the presenter and can send a line by hand", async ({
  page,
  context,
}) => {
  await goToTwoSteps(page);
  const audience = await context.newPage();
  await audience.goto(`/share.html?deck=${DECK}&token=${TOKEN}&sync=${room}`);
  await deckFrame(audience);

  const consolePage = await context.newPage();
  await consolePage.goto(`/captions.html?deck=${DECK}&sync=${room}`);
  await expect(consolePage.locator("#script-status")).toContainText(
    "6/6 slides have lines · 10 lines",
  );

  // nudge the presenter so the console receives the current slide
  await page.bringToFront();
  await press(page, "ArrowRight");
  await press(page, "ArrowLeft");
  await expect(consolePage.locator("#slide-title")).toHaveText("3. Two steps", { timeout: 10_000 });

  await consolePage.locator('#lines li[data-line="1"]').click();
  await expect(audience.locator("#__se_cc_box")).toHaveText("Let me show you the first step.");
  await expect(consolePage.locator("#sent .en")).toHaveText("Let me show you the first step.");
});
