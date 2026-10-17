// P4-7h: the Training panel at the bottom of the props column (shared
// public/js/training-panel.js). The same assertions run against the legacy
// /edit.html (the oracle) and the new /edit-next.html. The local TTS server is stubbed.
import type { Page } from "@playwright/test";
import { expect, test } from "../support/app";
import { DECK } from "../support/seed";

// A tiny valid WAV so the <audio> element accepts it.
const WAV = Buffer.from("UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA=", "base64");

// The panel collapses blank lines before speaking.
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

for (const path of ["/edit.html", "/edit-next.html"]) {
  test.describe(path, () => {
    const bodies: { input: string }[] = [];
    const open = async (page: Page) => {
      bodies.length = 0;
      await page.route("http://localhost:8880/v1/audio/speech", async (route) => {
        bodies.push(JSON.parse(route.request().postData() ?? "{}"));
        await route.fulfill({ status: 200, contentType: "audio/wav", body: WAV });
      });
      await page.goto(`${path}?deck=${DECK}`);
      await expect(page.locator("#slide-list-items .slide-item")).toHaveCount(6);
      await expect(page.locator("#notes-textarea")).toHaveValue(/안녕하세요|\w/);
      await expect(page.locator("#status")).toHaveText(/^ready · /);
    };

    test("the panel mounts with its controls and hint", async ({ page }) => {
      await open(page);
      const panel = page.locator("#training-mount .training-panel");
      await expect(panel).toHaveCount(1);
      await expect(panel.locator("#listen-btn")).toHaveText("🔄 Generate");
      await expect(panel.locator("#record-btn")).toHaveText("🎙 Record");
      await expect(panel.locator("#save-btn")).toBeVisible();
      await expect(panel.locator("#feedback-hint")).toBeVisible();
      await expect(panel.locator("#fb-score")).toBeHidden();
    });

    test("Generate speaks the selected slide's notes and shows the player", async ({ page }) => {
      await open(page);
      const notes = await page.locator("#notes-textarea").inputValue();
      await page.locator("#listen-btn").click();
      await expect.poll(() => bodies.length).toBeGreaterThan(0);
      expect(squash(bodies[0].input)).toBe(squash(notes));
      await expect(page.locator("#section-audio")).toHaveClass(/show/);
    });

    test("switching slides hands the panel the new section and clears the player", async ({
      page,
    }) => {
      await open(page);
      const first = await page.locator("#notes-textarea").inputValue();
      await page.locator("#listen-btn").click();
      await expect(page.locator("#section-audio")).toHaveClass(/show/);
      await page.locator("#slide-list-items .slide-item").nth(1).click();
      await expect(page.locator("#notes-textarea")).not.toHaveValue(first);
      await expect(page.locator("#section-audio")).not.toHaveClass(/show/);
      const second = (await page.locator("#notes-textarea").inputValue()).trim();
      bodies.length = 0;
      await page.locator("#listen-btn").click();
      await expect.poll(() => bodies.length).toBeGreaterThan(0);
      expect(squash(bodies[0].input)).toBe(squash(second));
    });
  });
}
