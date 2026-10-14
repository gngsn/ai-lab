// P0-10: view / present download every asset first (blob: URLs); share does
// not (it is mostly opened on phones, where that risks the tab being killed).
import { deckFrame, expect, test } from "../support/app";
import { DECK, TOKEN } from "../support/seed";

const imgSrcs = (frame: import("@playwright/test").Frame) =>
  frame.evaluate(() =>
    [...document.querySelectorAll("img")].map((i) => i.getAttribute("src") || ""),
  );

test("view preloads assets into blob: URLs", async ({ page }) => {
  await page.goto(`/view.html?deck=${DECK}&token=${TOKEN}`);
  const srcs = await imgSrcs(await deckFrame(page));
  expect(srcs.some((s) => s.startsWith("blob:"))).toBe(true);
});

test("share keeps the original asset URLs", async ({ page }) => {
  await page.goto(`/share.html?deck=${DECK}&token=${TOKEN}&sync=r1`);
  const srcs = await imgSrcs(await deckFrame(page));
  expect(srcs.length).toBeGreaterThan(0);
  expect(srcs.some((s) => s.startsWith("blob:"))).toBe(false);
  expect(srcs.some((s) => s.startsWith("https://fake.supabase.test/"))).toBe(true);
});
