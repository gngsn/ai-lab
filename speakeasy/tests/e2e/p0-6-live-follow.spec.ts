// P0-6: the audience page follows the presenter live over the sync room.
import { deckFrame, expect, press, slideState, test } from "../support/app";
import { DECK, TOKEN } from "../support/seed";

const present = `/present.html?deck=${DECK}&sync=r1`;
const share = `/share.html?deck=${DECK}&token=${TOKEN}&sync=r1`;

test("slides and fragments follow the presenter", async ({ page, context }) => {
  await page.goto(present);
  const presenter = await deckFrame(page);
  const audiencePage = await context.newPage();
  await audiencePage.goto(share);
  const audience = await deckFrame(audiencePage);
  await expect(audiencePage.locator("#__se_status")).toHaveText(/Waiting|Live/);

  await page.bringToFront();
  await press(page, "ArrowRight", 4); // Opening → Saved state (2 presses) → Two steps → step one
  const want = await slideState(presenter);
  expect(want.index).toBeGreaterThan(0);
  await expect
    .poll(() => slideState(audience))
    .toMatchObject({ index: want.index, shown: want.shown });

  await press(page, "ArrowRight");
  const next = await slideState(presenter);
  await expect
    .poll(() => slideState(audience))
    .toMatchObject({ index: next.index, shown: next.shown });
  await expect(audiencePage.locator("#__se_status")).toHaveText("● Live");
});

test("a late joiner lands on the presenter's current step", async ({ page, context }) => {
  await page.goto(present);
  const presenter = await deckFrame(page);
  await press(page, "ArrowRight", 4);
  const want = await slideState(presenter);

  const audiencePage = await context.newPage();
  await audiencePage.goto(share);
  const audience = await deckFrame(audiencePage);
  await expect
    .poll(() => slideState(audience), { timeout: 10_000 })
    .toMatchObject({
      index: want.index,
      shown: want.shown,
    });
});
