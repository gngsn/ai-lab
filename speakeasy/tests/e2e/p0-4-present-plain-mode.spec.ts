// Presenting a plain deck ("speakeasy mode": Speakeasy's own runtime, overlay counter, header /
// footer chrome).
import { deckFrame, expect, press, slideState, test } from "../support/app";
import { DECK, PLAIN } from "../support/seed";

test("keys step through the plain deck and the counter follows", async ({ page }) => {
  await page.goto(`/present.html?deck=${PLAIN}`);
  const frame = await deckFrame(page);
  const counter = frame.locator("#__se_counter");

  await expect(counter).toHaveText("1 / 4");
  expect(await slideState(frame)).toMatchObject({ mode: "speakeasy", index: 0 });

  await press(page, "ArrowRight");
  await expect(counter).toHaveText("2 / 4");

  // "Plain two" has one fragment: the next press reveals it, then moves on
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 1, shown: 0 });
  await press(page, "ArrowRight");
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 1, shown: 1 });
  await press(page, "ArrowRight");
  await expect(counter).toHaveText("3 / 4");

  await press(page, "ArrowLeft");
  await expect(counter).toHaveText("2 / 4");
});

test("the overlay is shown in speakeasy mode only", async ({ page }) => {
  // (the overlay <div> itself has no box — its children are fixed — so the
  // contract is its `hidden` property)
  await page.goto(`/present.html?deck=${PLAIN}`);
  let frame = await deckFrame(page);
  await expect(frame.locator("#__se_overlay")).toHaveJSProperty("hidden", false);

  await page.goto(`/present.html?deck=${DECK}`);
  frame = await deckFrame(page);
  await expect(frame.locator("#__se_overlay")).toHaveJSProperty("hidden", true);
});
