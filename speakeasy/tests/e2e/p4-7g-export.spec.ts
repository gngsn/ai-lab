// P4-7g: the More menu's Export items (HTML, notes .md download and copy, PDF
// print window) and "Save version". The same assertions run against the legacy
// /edit.html (the oracle) and the new /edit-next.html.
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, readDb, test } from "../support/app";
import { DECK } from "../support/seed";

for (const path of ["/edit.html", "/edit-next.html"]) {
  test.describe(path, () => {
    const open = async (page: Page) => {
      await page.goto(`${path}?deck=${DECK}`);
      await expect(page.locator("#slide-list-items .slide-item")).toHaveCount(6);
      await expect(page.locator("#notes-textarea")).toHaveValue(/안녕하세요/);
      await expect(page.locator("#status")).toHaveText(/^ready · /);
    };
    // Items sit in More (> Export); the menus close by themselves, so retry.
    const clickItem = async (page: Page, selector: string, viaExport: boolean) => {
      const more = page.locator("#more-dropdown");
      const exp = page.locator("#export-dropdown");
      await expect(async () => {
        if ((await more.getAttribute("open")) === null) {
          await more.locator(":scope > summary").click({ timeout: 1000 });
        }
        if (viaExport && (await exp.getAttribute("open")) === null) {
          await exp.locator(":scope > summary").click({ timeout: 1000 });
        }
        await page.locator(selector).click({ timeout: 1000 });
      }).toPass();
    };
    const exportItem = (page: Page, kind: string) =>
      clickItem(page, `[data-export="${kind}"]`, true);
    const downloaded = async (page: Page, kind: string) => {
      const [download] = await Promise.all([page.waitForEvent("download"), exportItem(page, kind)]);
      return {
        name: download.suggestedFilename(),
        text: readFileSync((await download.path())!, "utf8"),
      };
    };

    test("HTML export downloads a clean, self-contained deck", async ({ page }) => {
      await open(page);
      const { name, text } = await downloaded(page, "html");
      expect(name).toBe("controller-deck.html");
      expect(text.startsWith("<!doctype html>") || text.startsWith("<!DOCTYPE html>")).toBe(true);
      expect(text).not.toContain("<!-- slides -->");
      expect(text).not.toContain("data-section-id");
      expect(text).not.toContain("contenteditable");
      expect((text.match(/<section\b/g) ?? []).length).toBe(6);
      await expect(page.locator("#toast")).toHaveText("Saved controller-deck.html");
    });

    test("notes export downloads a Marp file with one section per slide", async ({ page }) => {
      await open(page);
      const { name, text } = await downloaded(page, "md");
      expect(name).toBe("controller-deck-notes.md");
      expect(text.startsWith("---\nmarp: true\ntheme: default\n---\n\n## ")).toBe(true);
      expect(text).toContain("## Opening\n\n");
      expect(text).toMatch(/안녕하세요/);
      expect(text.split("\n---\n\n").length).toBe(7); // the frontmatter's closing --- plus 5 between 6 slides
      await expect(page.locator("#toast")).toHaveText("Saved controller-deck-notes.md");
    });

    test("notes export to the clipboard copies the same Marp text", async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await open(page);
      await exportItem(page, "md-copy");
      await expect(page.locator("#toast")).toHaveText("Copied notes to clipboard");
      const text = await page.evaluate(() => navigator.clipboard.readText());
      expect(text.startsWith("---\nmarp: true")).toBe(true);
      expect(text).toContain("## Opening");
    });

    test("PDF opens the print view of the deck in a new window", async ({ page, context }) => {
      await open(page);
      const popup = context.waitForEvent("page");
      await exportItem(page, "pdf");
      const url = new URL((await popup).url());
      expect(url.pathname).toBe("/present.html");
      expect(Object.fromEntries(url.searchParams)).toMatchObject({ deck: DECK, print: "1" });
      await expect(page.locator("#toast")).toHaveText("Print window opened");
    });

    test("an export closes the Export menu; the notes link points at the notes page", async ({
      page,
    }) => {
      await open(page);
      await exportItem(page, "pdf");
      await expect(page.locator("#export-dropdown")).not.toHaveAttribute("open", "");
      await expect(page.locator("#export-notes-link")).toHaveAttribute(
        "href",
        `./notes.html?deck=${DECK}`,
      );
    });

    test("Save version asks for a message and snapshots every slide, note and the frame", async ({
      page,
    }) => {
      await open(page);
      await clickItem(page, "#save-version", false);
      await expect(page.locator("#__se_prompt_title")).toHaveText("Save Version");
      await page.locator("#__se_prompt_input").fill("before the talk");
      await page.locator("#__se_prompt_ok").click();
      await expect(page.locator("#toast")).toHaveText("Version saved");
      const db = await readDb(page);
      const manual = (rows: Record<string, unknown>[]) =>
        (rows ?? []).filter((r) => r.kind === "manual" && r.message === "before the talk");
      expect(manual(db.slide_history).length).toBe(6);
      expect(manual(db.notes_history).length).toBeGreaterThan(0);
      expect(manual(db.frame_history).length).toBe(1);
    });

    test("cancelling Save version stores nothing", async ({ page }) => {
      await open(page);
      await clickItem(page, "#save-version", false);
      await page.locator("#__se_prompt_cancel").click();
      await page.waitForTimeout(300);
      const db = await readDb(page);
      expect((db.slide_history ?? []).length).toBe(0);
      await expect(page.locator("#toast")).not.toHaveText("Version saved");
    });

    test("an open history drawer shows the new version at once", async ({ page }) => {
      await open(page);
      await page.locator("#history-toggle").dispatchEvent("click");
      await expect(page.locator("#hist-drawer")).toHaveClass(/\bopen\b/);
      await expect(page.locator("#history-panel .hist-empty")).toBeVisible();
      // (The open drawer covers the menu: send the click.)
      await page.locator("#save-version").dispatchEvent("click");
      await page.locator("#__se_prompt_input").fill("shown");
      await page.locator("#__se_prompt_ok").click();
      await expect(page.locator("#history-panel .hist-row .h-msg").first()).toHaveText("shown");
    });

    test("Ctrl/Cmd+S saves a version too", async ({ page }) => {
      await open(page);
      await page.locator("body").press("ControlOrMeta+s");
      await expect(page.locator("#__se_prompt_title")).toHaveText("Save Version");
      await page.locator("#__se_prompt_cancel").click();
    });
  });
}
