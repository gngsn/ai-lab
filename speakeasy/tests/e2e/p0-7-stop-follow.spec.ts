// The audience can pause following the presenter and browse alone, then follow again. Status and
// button labels are English ("Pause" / "Follow", the rest of the label only appears on hover); the
// hint text follows the browser language.
import { deckFrame, expect, press, slideState, test } from "../support/app";
import { DECK, TOKEN } from "../support/seed";

const present = `/present.html?deck=${DECK}&sync=r1`;
const share = `/share.html?deck=${DECK}&token=${TOKEN}&sync=r1`;

async function open(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
) {
  await page.goto(present);
  const presenter = await deckFrame(page);
  const audiencePage = await context.newPage();
  await audiencePage.goto(share);
  const audience = await deckFrame(audiencePage);
  await expect(audiencePage.locator("#__se_status"))
    .toHaveText("● Live", { timeout: 10_000 })
    .catch(async () => {
      await page.bringToFront();
      await press(page, "ArrowRight");
      await expect(audiencePage.locator("#__se_status")).toHaveText("● Live");
    });
  return { presenter, audiencePage, audience };
}

test.describe("english", () => {
  test("Pause freezes the audience, Follow catches up", async ({ page, context }) => {
    const { presenter, audiencePage, audience } = await open(page, context);
    const toggle = audiencePage.locator("#__se_follow_toggle .lbl");
    const status = audiencePage.locator("#__se_status");
    await expect(toggle).toHaveText("Pause");

    await toggle.click();
    await expect(status).toHaveText("Paused");
    await expect(toggle).toHaveText("Follow");
    await expect(audiencePage.locator("#__se_follow_hint")).toHaveText(
      "Paused — browse at your own pace with the arrow keys. Click Follow to catch up.",
    );

    // the presenter moves on; the audience stays
    await page.bringToFront();
    const before = (await slideState(audience)).index;
    await press(page, "ArrowRight", 4);
    const presenterAt = (await slideState(presenter)).index;
    expect(presenterAt).toBeGreaterThan(before);
    await audiencePage.waitForTimeout(500);
    expect((await slideState(audience)).index).toBe(before);

    // the audience browses on its own
    await audiencePage.bringToFront();
    await press(audiencePage, "End");
    await expect.poll(() => slideState(audience)).toMatchObject({ index: 5 });

    // Follow jumps back to the presenter
    await toggle.click();
    await expect(status).toHaveText("● Live");
    await expect(toggle).toHaveText("Pause");
    await expect.poll(() => slideState(audience)).toMatchObject({ index: presenterAt });
    await expect(audiencePage.locator("#__se_follow_hint")).toHaveText(
      "Following the presenter — slides change along with the talk.",
    );
  });
});

test.describe("korean", () => {
  test.use({ locale: "ko-KR" });

  test("hints are Korean while labels stay English", async ({ page, context }) => {
    const { audiencePage } = await open(page, context);
    const toggle = audiencePage.locator("#__se_follow_toggle");
    await toggle.click();
    await expect(toggle.locator(".lbl")).toHaveText("Follow");
    await expect(audiencePage.locator("#__se_status")).toHaveText("Paused");
    await expect(audiencePage.locator("#__se_follow_hint")).toContainText("일시정지했어요");
    await toggle.click();
    await expect(audiencePage.locator("#__se_follow_hint")).toContainText("발표자를 따라가요");
  });
});
