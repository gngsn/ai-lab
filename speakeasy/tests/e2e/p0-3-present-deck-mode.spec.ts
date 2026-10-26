// P0-3: presenting a deck that brings its own controller ("deck mode").
import { deckFrame, expect, press, slideState, test } from "../support/app";
import { DECK } from "../support/seed";

test("keys step through fragments, groups and slides, and back", async ({ page }) => {
  await page.goto(`/present.html?deck=${DECK}`);
  const frame = await deckFrame(page);

  expect(await slideState(frame)).toMatchObject({ mode: "deck", index: 0, title: "Opening" });

  await press(page, "ArrowRight");
  expect(await slideState(frame)).toMatchObject({ index: 1, title: "Saved state", shown: 0 });

  // this slide's fragment was saved as shown, but starts hidden (see P0-5):
  // the first press reveals it, the second leaves the slide
  await press(page, "ArrowRight");
  expect(await slideState(frame)).toMatchObject({ index: 1, shown: 1 });
  await press(page, "ArrowRight");
  expect(await slideState(frame)).toMatchObject({ index: 2, title: "Two steps", shown: 0 });

  // two single fragments, one per key press
  await press(page, "ArrowRight");
  expect((await slideState(frame)).shown).toBe(1);
  await press(page, "ArrowRight");
  expect((await slideState(frame)).shown).toBe(2);

  // the next press leaves the slide; the grouped fragments appear together
  await press(page, "ArrowRight");
  expect(await slideState(frame)).toMatchObject({ index: 3, title: "Grouped", shown: 0 });
  await press(page, "ArrowRight");
  expect((await slideState(frame)).shown).toBe(2);

  // going back hides the whole group at once, then returns to the previous slide
  await press(page, "ArrowLeft");
  expect((await slideState(frame)).shown).toBe(0);
  await press(page, "ArrowLeft");
  expect(await slideState(frame)).toMatchObject({ index: 2, shown: 2 });
});

test("Home and End jump to the first and last slide", async ({ page }) => {
  await page.goto(`/present.html?deck=${DECK}`);
  const frame = await deckFrame(page);
  // the page is fully up once the panel has read the deck
  await expect(page.locator("#__se_panel .pp-count")).toHaveText("1 / 6");

  await press(page, "End");
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 5, title: "Closing" });
  await press(page, "Home");
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 0, title: "Opening" });
});
