// P0-14: the editor's Share dialog — audience link, QR, open link, copy,
// new link (rotate) and stop sharing (revoke).
import { type Page } from "@playwright/test";
import { dbRow, expect, test } from "../support/app";
import { DECK, PLAIN, TOKEN } from "../support/seed";

const deckRow = (page: Page, id = DECK) => dbRow(page, "decks", { deck_id: id });

async function openShare(page: Page, deck = DECK) {
  await page.goto(`/edit.html?deck=${deck}`);
  await expect(page.locator("#slide-list-items .slide-item").first()).toBeVisible();
  await clickShare(page);
  await expect(page.locator("#share-modal-bg")).toHaveClass(/\bshow\b/);
}
/** Share is in the "⋮ More" menu. */
async function clickShare(page: Page) {
  await page.locator("#more-dropdown > summary").click();
  await page.locator("#share-btn").click();
}

test("shows the audience link, QR and an open link", async ({ page }) => {
  await openShare(page);
  const url = new URL(await page.locator("#share-url").inputValue());
  expect(url.pathname).toBe("/share.html");
  expect(Object.fromEntries(url.searchParams)).toEqual({ deck: DECK, token: TOKEN, sync: DECK });

  await expect(page.locator("#share-open")).toHaveAttribute("href", url.href);
  const qr = (await page.locator("#share-qr").getAttribute("src"))!;
  expect(qr).toContain("api.qrserver.com/v1/create-qr-code/");
  expect(decodeURIComponent(qr)).toContain(url.href);
  await expect(page.locator("#share-qr-download")).toHaveAttribute("download", "speakeasy-share-qr.png");
});

test("Copy confirms inline and copies the link", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openShare(page);
  const url = await page.locator("#share-url").inputValue();
  await page.locator("#share-copy").click();
  await expect(page.locator("#share-copy")).toHaveText("Copied ✓");
  await expect(page.locator("#share-copy")).toHaveClass(/\bcopied\b/);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await expect(page.locator("#share-copy")).toHaveText("Copy", { timeout: 4000 }); // reverts
});

test("New link replaces the token", async ({ page }) => {
  await openShare(page);
  const before = await page.locator("#share-url").inputValue();
  await page.locator("#share-rotate").click(); // confirm is accepted
  await expect.poll(async () => (await deckRow(page))?.share_token).not.toBe(TOKEN);
  const token = (await deckRow(page))!.share_token as string;
  expect(token).toBeTruthy();
  const after = await page.locator("#share-url").inputValue();
  expect(after).not.toBe(before);
  expect(new URL(after).searchParams.get("token")).toBe(token);
});

test("Stop sharing clears the token and closes the dialog", async ({ page }) => {
  await openShare(page);
  await page.locator("#share-revoke").click();
  await expect.poll(async () => (await deckRow(page))?.share_token).toBeNull();
  await expect(page.locator("#share-modal-bg")).not.toHaveClass(/\bshow\b/);
});

test("a deck that was never shared gets a token when you open Share", async ({ page }) => {
  await openShare(page, PLAIN); // the "generate one?" confirm is accepted
  const token = (await deckRow(page, PLAIN))?.share_token as string;
  expect(token).toBeTruthy();
  expect(new URL(await page.locator("#share-url").inputValue()).searchParams.get("token")).toBe(token);
});

test("the dialog closes with × and by clicking outside", async ({ page }) => {
  await openShare(page);
  await page.locator("#share-close").click();
  await expect(page.locator("#share-modal-bg")).not.toHaveClass(/\bshow\b/);
  await clickShare(page);
  await page.locator("#share-modal-bg").click({ position: { x: 5, y: 5 } });
  await expect(page.locator("#share-modal-bg")).not.toHaveClass(/\bshow\b/);
});
