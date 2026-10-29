// The in-page text prompt (src/lib/dom-prompt.ts, used by "Save version"). Opened with Ctrl/Cmd+S on
// the editor; checks every way it can end.
import type { Page } from "@playwright/test";
import { expect, readDb, test } from "../support/app";
import { DECK } from "../support/seed";

const open = async (page: Page) => {
  await page.goto(`/edit.html?deck=${DECK}`);
  await expect(page.locator("#slide-list-items .slide-item")).toHaveCount(6);
  await expect(page.locator("#status")).toHaveText(/^ready · /);
};
const ask = async (page: Page) => {
  await page.locator("body").press("ControlOrMeta+s");
  await expect(page.locator("#__se_prompt_layer")).toBeVisible();
};
const manualMessages = async (page: Page) => [
  ...new Set(
    ((await readDb(page)).slide_history ?? [])
      .filter((r) => r.kind === "manual")
      .map((r) => r.message),
  ),
];

test("the prompt shows its title and hint, with the input focused and empty", async ({ page }) => {
  await open(page);
  await ask(page);
  await expect(page.locator("#__se_prompt_title")).toHaveText("Save Version");
  await expect(page.locator("#__se_prompt_message")).toHaveText("Snapshot message (optional)");
  await expect(page.locator("#__se_prompt_input")).toBeFocused();
  await expect(page.locator("#__se_prompt_input")).toHaveValue("");
  await expect(page.locator("#__se_prompt_input")).toHaveAttribute("type", "text");
  await page.locator("#__se_prompt_cancel").click();
  await expect(page.locator("#__se_prompt_layer")).toBeHidden();
});

test("Enter submits the typed message", async ({ page }) => {
  await open(page);
  await ask(page);
  await page.locator("#__se_prompt_input").fill("by enter");
  await page.keyboard.press("Enter");
  await expect(page.locator("#toast")).toHaveText("Version saved");
  await expect(page.locator("#__se_prompt_layer")).toBeHidden();
  expect(await manualMessages(page)).toEqual(["by enter"]);
});

test("an empty message is still a version", async ({ page }) => {
  await open(page);
  await ask(page);
  await page.locator("#__se_prompt_ok").click();
  await expect(page.locator("#toast")).toHaveText("Version saved");
  expect(await manualMessages(page)).toEqual([""]);
});

test("Escape cancels and stores nothing", async ({ page }) => {
  await open(page);
  await ask(page);
  await page.locator("#__se_prompt_input").fill("never saved");
  await page.keyboard.press("Escape");
  await expect(page.locator("#__se_prompt_layer")).toBeHidden();
  await page.waitForTimeout(300);
  expect(await manualMessages(page)).toEqual([]);
});

test("a click on the backdrop cancels, a click inside the box does not", async ({ page }) => {
  await open(page);
  await ask(page);
  await page.locator("#__se_prompt_title").click();
  await expect(page.locator("#__se_prompt_layer")).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(page.locator("#__se_prompt_layer")).toBeHidden();
  await page.waitForTimeout(300);
  expect(await manualMessages(page)).toEqual([]);
});

test("asked twice, the second prompt starts empty and the layer is reused", async ({ page }) => {
  await open(page);
  await ask(page);
  await page.locator("#__se_prompt_input").fill("first");
  await page.locator("#__se_prompt_ok").click();
  await expect(page.locator("#toast")).toHaveText("Version saved");
  await ask(page);
  await expect(page.locator("#__se_prompt_input")).toHaveValue("");
  await expect(page.locator("#__se_prompt_layer")).toHaveCount(1);
  await page.locator("#__se_prompt_input").fill("second");
  await page.keyboard.press("Enter");
  await expect.poll(() => manualMessages(page)).toEqual(["first", "second"]);
});
