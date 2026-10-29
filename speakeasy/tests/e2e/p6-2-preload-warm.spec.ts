// The pronunciation page warms the HTTP cache with every asset of the deck (src/lib/preload-
// assets.ts, "warm" mode: fetch() only, no URL is rewritten).
import type { Page, Request } from "@playwright/test";
import { expect, test } from "../support/app";
import { DECK, PLAIN } from "../support/seed";

const FAKE = "https://fake.supabase.test/";

const watch = (page: Page) => {
  const fetches: Request[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith(FAKE) && r.resourceType() === "fetch") fetches.push(r);
  });
  return fetches;
};

test("fetches each asset of the deck once, and leaves the slide HTML alone", async ({ page }) => {
  const fetches = watch(page);
  await page.goto(`/pronunciation.html?deck=${DECK}`);
  await expect(page.locator("#training-panel")).toBeAttached();
  await expect.poll(() => fetches.length).toBeGreaterThan(0);
  const urls = fetches.map((r) => r.url());
  expect(new Set(urls).size).toBe(urls.length);
  // warm mode never swaps URLs for blob: ones
  const srcs = await page
    .frameLocator("#slide-stage iframe")
    .locator("img")
    .evaluateAll((imgs) => imgs.map((i) => i.getAttribute("src") || ""));
  expect(srcs.some((s) => s.startsWith("blob:"))).toBe(false);
});

test("a deck with no remote assets fetches nothing", async ({ page }) => {
  const fetches = watch(page);
  await page.goto(`/pronunciation.html?deck=${PLAIN}`);
  await expect(page.locator("#training-panel")).toBeAttached();
  await page.waitForTimeout(800);
  expect(fetches).toHaveLength(0);
});
