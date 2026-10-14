// P0-8: the public pages check the share token.
import { expect, test } from "../support/app";
import { DECK, PLAIN } from "../support/seed";

const body = (page: import("@playwright/test").Page) =>
  page.frameLocator("#__se_letterbox").locator("body");

test("a wrong token is rejected", async ({ page }) => {
  await page.goto(`/view.html?deck=${DECK}&token=wrong`);
  await expect(body(page)).toContainText("Invalid or revoked share link.");
});

test("a deck that is not shared is rejected", async ({ page }) => {
  await page.goto(`/view.html?deck=${PLAIN}&token=anything`);
  await expect(body(page)).toContainText("This deck is not shared.");
});

test("a missing token is reported", async ({ page }) => {
  await page.goto(`/view.html?deck=${DECK}`);
  await expect(body(page)).toContainText("Missing ?token=<share_token>");
});

test("share.html needs a sync room", async ({ page }) => {
  await page.goto(`/share.html?deck=${DECK}&token=tok`);
  await expect(body(page)).toContainText("Missing ?sync=<room>");
});
