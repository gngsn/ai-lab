// A deck starts unrevealed even if slides were saved with playback state ("visible" on a slide,
// "show" on a fragment), and slides play their reveal transition when reached.
import { deckFrame, expect, test } from "../support/app";
import { DECK } from "../support/seed";

test("starts with one visible slide and no shown fragments", async ({ page }) => {
  await page.goto(`/present.html?deck=${DECK}`);
  const frame = await deckFrame(page);

  expect(await frame.locator(".slide.visible").count()).toBe(1);
  expect(await frame.locator(".fragment.show").count()).toBe(0);
});

test("reaching a slide plays its reveal transition", async ({ page }) => {
  await page.goto(`/present.html?deck=${DECK}`);
  const frame = await deckFrame(page);

  await page.keyboard.press("End");
  const opacities = await frame.evaluate(async () => {
    const h1 = document.querySelector<HTMLElement>('.slide[data-title="Closing"] .reveal')!;
    const out: number[] = [];
    for (let i = 0; i < 8; i++) {
      out.push(Number(getComputedStyle(h1).opacity));
      await new Promise((r) => setTimeout(r, 90));
    }
    return out;
  });

  expect(opacities[0]).toBeLessThan(0.5); // starts transparent
  expect(opacities.at(-1)).toBeGreaterThan(0.95); // ends opaque
  // in between there is at least one partial value: it animates
  expect(opacities.some((o) => o > 0.05 && o < 0.95)).toBe(true);
});
