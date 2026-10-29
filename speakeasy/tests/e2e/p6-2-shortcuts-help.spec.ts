// The "?" keyboard-help modal (src/lib/shortcuts-help.ts), bound by the editor, the script editor
// and the script reader.
import type { Page } from "@playwright/test";
import { expect, test } from "../support/app";
import { DECK } from "../support/seed";

const modal = (page: Page) => page.locator("#__se_shortcuts_modal");

const PAGES = [
  {
    name: "editor",
    url: `/edit.html?deck=${DECK}`,
    ready: "#slide-list-items .slide-item",
    title: "Edit",
    keys: [["H"], ["⌘S", "Ctrl+S"]],
  },
  {
    name: "script editor",
    url: `/script-edit.html?deck=${DECK}`,
    ready: "#edit-textarea",
    title: "Notes (script-edit)",
    keys: [["H"], ["⌘S", "Ctrl+S"]],
  },
  {
    name: "script reader",
    url: `/script.html?deck=${DECK}`,
    ready: "#script",
    title: "Script",
    keys: [],
  },
];

for (const spec of PAGES) {
  test.describe(spec.name, () => {
    const open = async (page: Page) => {
      await page.goto(spec.url);
      await expect(page.locator(spec.ready).first()).toBeAttached();
      await page.waitForTimeout(400); // the page binds the help after its first render
    };

    test("? opens the list for the page and ? again closes it", async ({ page }) => {
      await open(page);
      await expect(modal(page)).toHaveCount(0);
      await page.locator("body").press("?");
      await expect(modal(page)).toHaveClass(/\bshow\b/);
      await expect(modal(page).locator("h2")).toHaveText(`${spec.title} · Keyboard shortcuts`);
      await expect(modal(page).locator('[role="dialog"]')).toHaveAttribute(
        "aria-label",
        "Keyboard shortcuts",
      );
      await expect(modal(page).locator("footer")).toHaveText("? toggle · Esc close");
      expect(await modal(page).locator("tr").count()).toBeGreaterThan(0);
      for (const keys of spec.keys) {
        const row = modal(page).locator("tr", { has: page.locator(`kbd:text-is("${keys[0]}")`) });
        await expect(row.locator(".sh-keys kbd")).toHaveText(keys);
      }
      await page.locator("body").press("?");
      await expect(modal(page)).not.toHaveClass(/\bshow\b/);
    });

    test("Escape, the × button and a click on the backdrop close it; a click inside does not", async ({
      page,
    }) => {
      await open(page);
      await page.locator("body").press("?");
      await expect(modal(page)).toHaveClass(/\bshow\b/);
      await modal(page).locator("h2").click();
      await expect(modal(page)).toHaveClass(/\bshow\b/);
      await page.keyboard.press("Escape");
      await expect(modal(page)).not.toHaveClass(/\bshow\b/);

      await page.locator("body").press("?");
      await modal(page).locator(".sh-close").click();
      await expect(modal(page)).not.toHaveClass(/\bshow\b/);

      await page.locator("body").press("?");
      await page.mouse.click(4, 4);
      await expect(modal(page)).not.toHaveClass(/\bshow\b/);
    });

    test("it is built again on every open, and one element is reused", async ({ page }) => {
      await open(page);
      for (let i = 0; i < 3; i++) {
        await page.locator("body").press("?");
        await expect(modal(page)).toHaveClass(/\bshow\b/);
        await page.keyboard.press("Escape");
        await expect(modal(page)).not.toHaveClass(/\bshow\b/);
      }
      await expect(page.locator("#__se_shortcuts_modal")).toHaveCount(1);
      await expect(page.locator("#__se_shortcuts_modal .sh-modal")).toHaveCount(1);
    });
  });
}

test("? typed into a text field does not open the help", async ({ page }) => {
  await page.goto(`/script-edit.html?deck=${DECK}`);
  await expect(page.locator("#edit-textarea")).toBeAttached();
  await page.waitForTimeout(400);
  await page.locator("#edit-textarea").click();
  await page.keyboard.type("what?");
  await expect(modal(page)).toHaveCount(0);
  await expect(page.locator("#edit-textarea")).toHaveValue(/what\?$/);
});

test("? typed into the editor's deck title is text, not the help", async ({ page }) => {
  await page.goto(`/edit.html?deck=${DECK}`);
  await expect(page.locator("#slide-list-items .slide-item").first()).toBeAttached();
  await page.waitForTimeout(400);
  await page.locator("#deck-title").click();
  await page.keyboard.type("?");
  await expect(modal(page)).toHaveCount(0);
  await expect(page.locator("#deck-title")).toContainText("?");
});
