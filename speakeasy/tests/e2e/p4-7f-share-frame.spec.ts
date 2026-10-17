// P4-7f (part 1): the Share dialog and the frame_html editor. The same
// assertions run against the legacy /edit.html (the oracle) and the new
// /edit-next.html.
import type { Page } from "@playwright/test";
import { dbRow, expect, test } from "../support/app";
import { DECK, PLAIN, TOKEN } from "../support/seed";

const deckRow = (page: Page, id = DECK) => dbRow(page, "decks", { deck_id: id });

for (const path of ["/edit.html", "/edit-next.html"]) {
  test.describe(path, () => {
    // The Share / Frame buttons live in the "⋮ More" menu.
    const clickMore = async (page: Page, id: string) => {
      const more = page.locator("#more-dropdown");
      // (The menu closes by itself after a click: retry if it closes under us.)
      await expect(async () => {
        if ((await more.getAttribute("open")) === null) {
          await more.locator(":scope > summary").click({ timeout: 1000 });
        }
        await page.locator(id).click({ timeout: 1000 });
      }).toPass();
    };
    const load = async (page: Page, deck = DECK) => {
      await page.goto(`${path}?deck=${deck}`);
      await expect(page.locator("#slide-list-items .slide-item").first()).toBeVisible();
      await expect(page.locator("#status")).toHaveText(/^ready · /);
    };
    const openShare = async (page: Page, deck = DECK) => {
      await load(page, deck);
      await clickMore(page, "#share-btn");
      await expect(page.locator("#share-modal-bg")).toHaveClass(/\bshow\b/);
    };

    test("share: shows the audience link, QR and an open link", async ({ page }) => {
      await openShare(page);
      const url = new URL(await page.locator("#share-url").inputValue());
      expect(url.pathname).toBe("/share.html");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        deck: DECK,
        token: TOKEN,
        sync: DECK,
      });
      await expect(page.locator("#share-open")).toHaveAttribute("href", url.href);
      const qr = (await page.locator("#share-qr").getAttribute("src"))!;
      expect(qr).toContain("api.qrserver.com/v1/create-qr-code/");
      expect(decodeURIComponent(qr)).toContain(url.href);
      await expect(page.locator("#share-qr-download")).toHaveAttribute(
        "download",
        "speakeasy-share-qr.png",
      );
    });

    test("share: Copy confirms inline and copies the link", async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await openShare(page);
      const url = await page.locator("#share-url").inputValue();
      await page.locator("#share-copy").click();
      await expect(page.locator("#share-copy")).toHaveText("Copied ✓");
      await expect(page.locator("#share-copy")).toHaveClass(/\bcopied\b/);
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
      await expect(page.locator("#share-copy")).toHaveText("Copy", { timeout: 4000 });
    });

    test("share: New link replaces the token", async ({ page }) => {
      await openShare(page);
      const before = await page.locator("#share-url").inputValue();
      await page.locator("#share-rotate").click(); // the confirm is accepted
      await expect.poll(async () => (await deckRow(page))?.share_token).not.toBe(TOKEN);
      const token = (await deckRow(page))!.share_token as string;
      expect(token).toBeTruthy();
      const after = await page.locator("#share-url").inputValue();
      expect(after).not.toBe(before);
      expect(new URL(after).searchParams.get("token")).toBe(token);
      await expect(page.locator("#toast")).toHaveText("New share link");
    });

    test("share: Stop sharing clears the token and closes the dialog", async ({ page }) => {
      await openShare(page);
      await page.locator("#share-revoke").click();
      await expect.poll(async () => (await deckRow(page))?.share_token).toBeNull();
      await expect(page.locator("#share-modal-bg")).not.toHaveClass(/\bshow\b/);
      await expect(page.locator("#toast")).toHaveText("Share link revoked");
      // Opening again offers a fresh link (the confirm is accepted).
      await clickMore(page, "#share-btn");
      await expect.poll(async () => (await deckRow(page))?.share_token).toBeTruthy();
    });

    test("share: a deck that was never shared gets a token when you open Share", async ({
      page,
    }) => {
      await openShare(page, PLAIN);
      const token = (await deckRow(page, PLAIN))?.share_token as string;
      expect(token).toBeTruthy();
      expect(new URL(await page.locator("#share-url").inputValue()).searchParams.get("token")).toBe(
        token,
      );
    });

    test("share: declining the 'generate one?' prompt leaves the deck unshared", async ({
      page,
    }) => {
      await load(page, PLAIN);
      page.removeAllListeners("dialog");
      page.once("dialog", (d) => {
        expect(d.message()).toBe("No share link yet. Generate one?");
        void d.dismiss();
      });
      await clickMore(page, "#share-btn");
      await page.waitForTimeout(300);
      await expect(page.locator("#share-modal-bg")).not.toHaveClass(/\bshow\b/);
      expect((await deckRow(page, PLAIN))?.share_token).toBeNull();
    });

    test("share: closes with × and by clicking outside", async ({ page }) => {
      await openShare(page);
      await page.locator("#share-close").click();
      await expect(page.locator("#share-modal-bg")).not.toHaveClass(/\bshow\b/);
      await clickMore(page, "#share-btn");
      await page.locator("#share-modal-bg").click({ position: { x: 5, y: 5 } });
      await expect(page.locator("#share-modal-bg")).not.toHaveClass(/\bshow\b/);
    });

    const openFrame = async (page: Page) => {
      await load(page);
      await clickMore(page, "#frame-edit");
      await expect(page.locator("#frame-modal-bg")).toHaveClass(/\bshow\b/);
    };

    test("frame: splits the saved frame into HTML, CSS and JS", async ({ page }) => {
      await openFrame(page);
      const frame = String((await deckRow(page))?.frame_html);
      const html = await page.locator("#frame-textarea").inputValue();
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain("<!-- slides -->");
      expect(html).not.toContain("<style");
      await expect(page.locator("#frame-editor-label")).toHaveText("HTML");
      await expect(page.locator('[data-frame-part="html"]')).toHaveClass(/\bactive\b/);

      await page.locator('[data-frame-part="css"]').click();
      await expect(page.locator("#frame-editor-label")).toHaveText("CSS");
      await expect(page.locator("#frame-editor-help")).toContainText("<style>");
      const css = await page.locator("#frame-textarea").inputValue();
      expect(css.length > 0).toBe(frame.includes("<style"));
      await page.locator('[data-frame-part="js"]').click();
      await expect(page.locator("#frame-editor-label")).toHaveText("JS");
      await expect(page.locator('[data-frame-part="js"]')).toHaveClass(/\bactive\b/);
      await expect(page.locator('[data-frame-part="css"]')).not.toHaveClass(/\bactive\b/);
    });

    test("frame: edits in every part survive switching and are merged on save", async ({
      page,
    }) => {
      await openFrame(page);
      await page.locator('[data-frame-part="css"]').click();
      await page.locator("#frame-textarea").fill("body { outline: 3px solid red; }");
      await page.locator('[data-frame-part="js"]').click();
      await page.locator("#frame-textarea").fill("window.__frameMarker = 7;");
      await page.locator('[data-frame-part="css"]').click();
      await expect(page.locator("#frame-textarea")).toHaveValue("body { outline: 3px solid red; }");
      await page.locator("#frame-save").click();
      await expect(page.locator("#toast")).toHaveText("Frame saved");
      await expect(page.locator("#frame-modal-bg")).not.toHaveClass(/\bshow\b/);
      const frame = String((await deckRow(page))?.frame_html);
      expect(frame).toContain("body { outline: 3px solid red; }");
      expect(frame).toContain("window.__frameMarker = 7;");
      expect(frame).toContain("<!-- slides -->");
      // The canvas is rebuilt with the new frame.
      await expect
        .poll(async () =>
          page
            .frameLocator("#canvas")
            .locator("body")
            .evaluate((el) => getComputedStyle(el).outlineWidth),
        )
        .toBe("3px");
      // Opening again shows what was saved.
      await clickMore(page, "#frame-edit");
      await page.locator('[data-frame-part="js"]').click();
      await expect(page.locator("#frame-textarea")).toHaveValue("window.__frameMarker = 7;");
    });

    test("frame: a frame without the slides placeholder gets one on save", async ({ page }) => {
      await openFrame(page);
      await page
        .locator("#frame-textarea")
        .fill("<!doctype html><html><head></head><body><main></main></body></html>");
      await page.locator("#frame-save").click();
      await expect(page.locator("#toast")).toHaveText("Frame saved");
      const frame = String((await deckRow(page))?.frame_html);
      expect(frame).toMatch(/<!-- slides -->\s*<\/main>/);
    });

    test("frame: Cancel and the backdrop discard the draft", async ({ page }) => {
      await openFrame(page);
      const before = String((await deckRow(page))?.frame_html);
      await page.locator("#frame-textarea").fill("<html>changed</html>");
      await page.locator("#frame-cancel").click();
      await expect(page.locator("#frame-modal-bg")).not.toHaveClass(/\bshow\b/);
      await clickMore(page, "#frame-edit");
      await expect(page.locator("#frame-textarea")).not.toHaveValue(/changed/);
      await page.locator("#frame-modal-bg").click({ position: { x: 5, y: 5 } });
      await expect(page.locator("#frame-modal-bg")).not.toHaveClass(/\bshow\b/);
      expect(String((await deckRow(page))?.frame_html)).toBe(before);
    });
  });
}
