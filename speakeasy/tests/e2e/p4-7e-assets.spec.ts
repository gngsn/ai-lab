// P4-7e: the asset library — upload, filter, copy URL, insert into the slide,
// rename (with every reference rewritten) and delete. The same assertions run
// against the legacy /edit.html (the oracle) and the new /edit-next.html.
import { type Page, expect as pwExpect } from "@playwright/test";
import { dbRow, expect, test } from "../support/app";
import { DECK } from "../support/seed";

const items = (page: Page) => page.locator("#slide-list-items .slide-item");
const cards = (page: Page) => page.locator("#images-grid .img-card");
const card = (page: Page, name: string) => cards(page).filter({ hasText: name });
const bytes = (text: string) => Buffer.from(text);

for (const path of ["/edit.html", "/edit-next.html"]) {
  test.describe(path, () => {
    const open = async (page: Page) => {
      await page.goto(`${path}?deck=${DECK}`);
      await pwExpect(items(page)).toHaveCount(6);
      await expect(page.locator("#notes-textarea")).toHaveValue(/안녕하세요/);
      await expect(page.locator("#status")).toHaveText(/^ready · /);
    };
    // The Assets button lives in the More menu.
    const clickAssets = async (page: Page) => {
      const more = page.locator("#more-dropdown");
      if ((await more.getAttribute("open")) === null) {
        await more.locator(":scope > summary").click();
      }
      await page.click("#images-btn");
    };
    const openLibrary = async (page: Page) => {
      await clickAssets(page);
      await expect(page.locator("#images-modal-bg")).toHaveClass(/\bshow\b/);
      await expect(page.locator("#images-grid")).not.toContainText("loading…");
    };
    const upload = async (page: Page, files: { name: string; mimeType: string }[]) => {
      await page.setInputFiles(
        "#images-upload-input",
        files.map((f) => ({ ...f, buffer: bytes(`data of ${f.name}`) })),
      );
    };
    const seedAssets = async (page: Page) => {
      await openLibrary(page);
      await upload(page, [
        { name: "Hero Image.png", mimeType: "image/png" },
        { name: "clip.mp4", mimeType: "video/mp4" },
        { name: "notes.pdf", mimeType: "application/pdf" },
      ]);
      await expect(cards(page)).toHaveCount(3);
    };

    test("opens from the toolbar button and the I key, closes three ways", async ({ page }) => {
      await open(page);
      const modal = page.locator("#images-modal-bg");
      await expect(modal).not.toHaveClass(/\bshow\b/);
      await clickAssets(page);
      await expect(modal).toHaveClass(/\bshow\b/);
      await page.click("#images-close");
      await expect(modal).not.toHaveClass(/\bshow\b/);
      await page.keyboard.press("i");
      await expect(modal).toHaveClass(/\bshow\b/);
      await modal.click({ position: { x: 5, y: 5 } }); // the backdrop
      await expect(modal).not.toHaveClass(/\bshow\b/);
      await clickAssets(page);
      await page.locator("#images-modal-bg .modal").click({ position: { x: 300, y: 300 } });
      await expect(modal).toHaveClass(/\bshow\b/); // a click inside keeps it open
    });

    test("an empty library says so", async ({ page }) => {
      await open(page);
      await openLibrary(page);
      await expect(page.locator("#images-grid")).toContainText("No assets yet");
      await expect(cards(page)).toHaveCount(0);
    });

    test("uploads files and lists them with kind, size and source", async ({ page }) => {
      await open(page);
      await seedAssets(page);
      await expect(page.locator("#status")).toHaveText("uploaded 3");
      await expect(page.locator("#toast")).toHaveText("Uploaded 3 file(s)");
      // The stored name is slugified, the upload timestamp is hidden.
      const hero = card(page, "hero-image.png");
      await expect(hero).toHaveAttribute("data-kind", "image");
      await expect(hero.locator("img")).toHaveCount(1);
      await expect(hero.locator(".src")).toHaveText("shared");
      await expect(hero).toContainText("1KB");
      await expect(card(page, "clip.mp4")).toHaveAttribute("data-kind", "video");
      await expect(card(page, "clip.mp4").locator("video")).toHaveCount(1);
      await expect(card(page, "notes.pdf")).toHaveAttribute("data-kind", "file");
      await expect(card(page, "notes.pdf").locator(".asset-icon")).toContainText("PDF");
    });

    test("filters by file name and by source", async ({ page }) => {
      await open(page);
      await seedAssets(page);
      await page.fill("#images-filter", "CLIP");
      await expect(cards(page).locator("visible=true")).toHaveCount(1);
      await expect(card(page, "clip.mp4")).toBeVisible();
      await page.fill("#images-filter", "shared");
      await expect(cards(page).locator("visible=true")).toHaveCount(3);
      await page.fill("#images-filter", "no-such-file");
      await expect(cards(page).locator("visible=true")).toHaveCount(0);
      await page.fill("#images-filter", "");
      await expect(cards(page).locator("visible=true")).toHaveCount(3);
    });

    test("copies an asset's URL to the clipboard", async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await open(page);
      await seedAssets(page);
      const hero = card(page, "hero-image.png");
      const url = await hero.getAttribute("data-url");
      expect(url).toContain("/slides-images/_library/");
      await hero.hover();
      // (The leftmost button is half-clipped by the narrow card on both pages,
      // so a pointer click would land on the grid: send the click itself.)
      await hero.locator(".act-copy").dispatchEvent("click");
      await expect(page.locator("#toast")).toContainText("Copied URL: …/");
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    });

    test("inserts an asset into the current slide", async ({ page }) => {
      await open(page);
      await seedAssets(page);
      const hero = card(page, "hero-image.png");
      const url = (await hero.getAttribute("data-url"))!;
      await hero.hover();
      await hero.locator(".act-insert").click();
      await expect(page.locator("#images-modal-bg")).not.toHaveClass(/\bshow\b/);
      await expect(page.locator("#toast")).toHaveText("Inserted into current slide");
      const inserted = page.frameLocator("#canvas").locator(`img[src="${url}"]`);
      await expect(inserted).toHaveCount(1);
      // ...and the slide is saved with it.
      await expect
        .poll(async () => {
          const sid = await items(page).first().getAttribute("data-section-id");
          return String((await dbRow(page, "slides", { deck_id: DECK, section_id: sid }))?.content);
        })
        .toContain(url);
    });

    test("renames an asset and rewrites every reference to it", async ({ page }) => {
      await open(page);
      await seedAssets(page);
      const hero = card(page, "hero-image.png");
      const oldUrl = (await hero.getAttribute("data-url"))!;
      await hero.hover();
      await hero.locator(".act-insert").click();
      const sid = (await items(page).first().getAttribute("data-section-id"))!;
      const content = async () =>
        String((await dbRow(page, "slides", { deck_id: DECK, section_id: sid }))?.content);
      await expect.poll(content).toContain(oldUrl);

      await openLibrary(page);
      page.removeAllListeners("dialog");
      page.once("dialog", (d) => {
        expect(d.type()).toBe("prompt");
        expect(d.defaultValue()).toBe("hero-image.png");
        void d.accept("Cover Photo");
      });
      const again = card(page, "hero-image.png");
      await again.hover();
      await again.locator(".act-rename").click();
      await expect(page.locator("#toast")).toHaveText("Renamed to cover-photo.png");
      await expect(card(page, "cover-photo.png")).toHaveCount(1);
      await expect(card(page, "hero-image.png")).toHaveCount(0);
      const newUrl = (await card(page, "cover-photo.png").getAttribute("data-url"))!;
      expect(newUrl).not.toBe(oldUrl);
      const after = await content();
      expect(after).toContain(newUrl);
      expect(after).not.toContain(oldUrl);
    });

    test("renaming to the same name, or cancelling, changes nothing", async ({ page }) => {
      await open(page);
      await seedAssets(page);
      page.removeAllListeners("dialog");
      page.once("dialog", (d) => void d.dismiss());
      await card(page, "clip.mp4").hover();
      await card(page, "clip.mp4").locator(".act-rename").click();
      page.once("dialog", (d) => void d.accept("clip.mp4"));
      await card(page, "clip.mp4").locator(".act-rename").click();
      await page.waitForTimeout(300);
      await expect(cards(page)).toHaveCount(3);
      await expect(card(page, "clip.mp4")).toHaveCount(1);
    });

    test("deletes an asset after a confirmation", async ({ page }) => {
      await open(page);
      await seedAssets(page);
      page.removeAllListeners("dialog");
      page.once("dialog", (d) => {
        expect(d.type()).toBe("confirm");
        expect(d.message()).toContain("Delete 'notes.pdf' from the shared library?");
        void d.dismiss();
      });
      const pdf = card(page, "notes.pdf");
      await pdf.hover();
      await pdf.locator(".act-del").click();
      await page.waitForTimeout(300);
      await expect(cards(page)).toHaveCount(3); // declined: still there

      page.once("dialog", (d) => void d.accept());
      await pdf.hover();
      await pdf.locator(".act-del").click();
      await expect(page.locator("#toast")).toHaveText("Deleted");
      await expect(cards(page)).toHaveCount(2);
      await expect(card(page, "notes.pdf")).toHaveCount(0);
    });

    test("lists assets uploaded earlier, from this deck's folder too", async ({ page }) => {
      await open(page);
      await page.evaluate((deck) => {
        localStorage.setItem(
          "__fakestorage",
          JSON.stringify({
            "slides-images": {
              [`${deck}/lm1-old.png`]: {
                size: 4096,
                mimetype: "image/png",
                created_at: "2026-01-01",
              },
              "other-deck/lm2-theirs.png": {
                size: 10,
                mimetype: "image/png",
                created_at: "2026-01-02",
              },
            },
          }),
        );
      }, DECK);
      await openLibrary(page);
      await expect(card(page, "old.png").locator(".src")).toHaveText("this deck");
      await expect(card(page, "theirs.png").locator(".src")).toHaveText("other-deck");
      await page.fill("#images-filter", "other-deck");
      await expect(cards(page).locator("visible=true")).toHaveCount(1);
    });
  });
}
