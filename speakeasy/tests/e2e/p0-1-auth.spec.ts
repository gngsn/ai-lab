// P0-1: every owner page is gated by the passphrase. Dismissing the dialog
// (cancel, Esc, click outside) or entering a wrong passphrase must NOT open
// the page. (Regression: five pages once forgot to `await ensureAuthed()`,
// and a Promise is always truthy.)
import { AUTH_KEY, PASSPHRASE, expect, test } from "../support/app";
import { DECK } from "../support/seed";

test.use({ authed: false });

const PAGES = [
  { name: "index", url: "/index.html", opened: "#deck-list" },
  { name: "edit", url: `/edit.html?deck=${DECK}`, opened: "#share-btn" },
  { name: "script", url: `/script.html?deck=${DECK}`, opened: "#script" },
  { name: "script-edit", url: `/script-edit.html?deck=${DECK}`, opened: "#toolbar" },
  { name: "notes", url: `/notes.html?deck=${DECK}`, opened: "#tts-btn" },
  { name: "pronunciation", url: `/pronunciation.html?deck=${DECK}`, opened: "#toolbar" },
  { name: "present", url: `/present.html?deck=${DECK}`, opened: "[data-section-id]", framed: true },
  { name: "captions", url: `/captions.html?deck=${DECK}`, opened: "#mic" },
] as const;

const DENIED = /denied|auth failed/i;

for (const p of PAGES) {
  test.describe(p.name, () => {
    const setup = async (page: import("@playwright/test").Page) => {
      await page.goto(p.url);
      // present hosts the page in an iframe, and the dialog opens inside it
      const scope = "framed" in p ? page.frameLocator("#__se_letterbox") : page;
      await expect(scope.locator("#__se_prompt_input")).toBeVisible();
      return scope;
    };
    const stayedClosed = async (scope: Awaited<ReturnType<typeof setup>>) => {
      await expect(scope.locator("body")).toContainText(DENIED);
      await expect(scope.locator(p.opened)).toHaveCount(0);
    };

    test("cancel keeps it closed", async ({ page }) => {
      const scope = await setup(page);
      await scope.locator("#__se_prompt_cancel").click();
      await stayedClosed(scope);
    });

    test("Escape keeps it closed", async ({ page }) => {
      const scope = await setup(page);
      await scope.locator("#__se_prompt_input").press("Escape");
      await stayedClosed(scope);
    });

    test("clicking outside keeps it closed", async ({ page }) => {
      const scope = await setup(page);
      await scope.locator("#__se_prompt_layer").dispatchEvent("mousedown");
      await stayedClosed(scope);
    });

    test("a wrong passphrase keeps it closed", async ({ page }) => {
      const scope = await setup(page);
      await scope.locator("#__se_prompt_input").fill("nope");
      await scope.locator("#__se_prompt_ok").click();
      await stayedClosed(scope);
      expect(await page.evaluate((k) => localStorage.getItem(k), AUTH_KEY)).toBeNull();
    });

    test("the right passphrase opens it and is remembered", async ({ page }) => {
      const scope = await setup(page);
      await scope.locator("#__se_prompt_input").fill(PASSPHRASE);
      await scope.locator("#__se_prompt_ok").click();
      await expect(scope.locator(p.opened).first()).toBeAttached({ timeout: 10_000 });
      await expect(scope.locator("body")).not.toContainText(DENIED);
      expect(await page.evaluate((k) => localStorage.getItem(k), AUTH_KEY)).toBe(PASSPHRASE);
    });
  });
}
