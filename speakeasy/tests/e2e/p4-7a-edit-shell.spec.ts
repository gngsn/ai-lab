// The editor page shell (toolbar, three columns, folding and resizing the side panels, renaming the
// deck).
import { dbRow, expect, test } from "../support/app";
import { DECK } from "../support/seed";

const path = "/edit.html";
test.describe(path, () => {
  const open = async (page: import("@playwright/test").Page) => {
    await page.goto(`${path}?deck=${DECK}`);
    await expect(page.locator("#deck-title")).toHaveText("Controller Deck");
    // The canvas's "ready" status arrives late and would overwrite the statuses asserted below.
    await expect(page.locator("#status")).toHaveText(/^ready · /);
  };

  test("shows the toolbar, the three columns and the deck title", async ({ page }) => {
    await open(page);
    await expect(page).toHaveTitle("Edit · Controller Deck");
    for (const id of ["#toolbar", "#slide-list", "#canvas-wrap", "#props", "#present-link"]) {
      await expect(page.locator(id)).toHaveCount(1);
    }
    const href = await page.locator("#present-link").getAttribute("href");
    expect(href).toContain(`present.html?deck=${DECK}&sync=${DECK}`);
    await expect(page.locator("#export-notes-link")).toHaveAttribute(
      "href",
      `./notes.html?deck=${DECK}`,
    );
    await expect(page.locator("#mode-select option")).toHaveText([
      "16:9",
      "portrait",
      "html",
      "stretch",
    ]);
  });

  test("folds the side panels with the buttons and the [ ] keys, and remembers it", async ({
    page,
  }) => {
    await open(page);
    const body = page.locator("#body");
    const listBtn = page.locator('.aside-toggle[data-aside="slide-list"]');
    const propsBtn = page.locator('.aside-toggle[data-aside="props"]');
    await expect(listBtn).toHaveText("‹");
    await expect(propsBtn).toHaveText("›");

    await listBtn.click();
    await expect(body).toHaveClass(/slide-list-collapsed/);
    await expect(listBtn).toHaveText("›");
    await expect(listBtn).toHaveAttribute("aria-expanded", "false");
    await expect(listBtn).toHaveAttribute("title", "Expand slide list ([)");
    expect(
      await page.evaluate(() => localStorage.getItem("speakeasy:edit:collapsed:slide-list")),
    ).toBe("1");

    await page.keyboard.press("]");
    await expect(body).toHaveClass(/props-collapsed/);
    await expect(propsBtn).toHaveText("‹");
    expect(await page.evaluate(() => localStorage.getItem("speakeasy:edit:collapsed:props"))).toBe(
      "1",
    );

    await page.reload();
    await expect(page.locator("#body")).toHaveClass(/slide-list-collapsed/);
    await expect(page.locator("#body")).toHaveClass(/props-collapsed/);

    await page.keyboard.press("[");
    await page.keyboard.press("]");
    await expect(page.locator("#body")).not.toHaveClass(/collapsed/);
    expect(
      await page.evaluate(() => localStorage.getItem("speakeasy:edit:collapsed:slide-list")),
    ).toBeNull();
  });

  test("the training section folds and remembers it", async ({ page }) => {
    await open(page);
    const key = "speakeasy:edit:collapsed:training";
    await page.locator("#training-toggle").click();
    await expect(page.locator("#training-section")).toHaveClass(/collapsed/);
    await expect(page.locator("#training-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe("1");
    await page.locator("#training-toggle").click();
    expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
  });

  test("dragging the resizers changes and stores the panel sizes", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await open(page);
    const stored = (k: string) => page.evaluate((key) => localStorage.getItem(key), k);
    const css = (v: string) =>
      page.evaluate((name) => document.documentElement.style.getPropertyValue(name), v);
    expect(await stored("slidesEditor.slideListWidth")).toBe("240");
    expect(await stored("slidesEditor.propsPanelWidth")).toBe("280");
    expect(await stored("slidesEditor.propsPanelHeight")).toBe("280");

    const drag = async (selector: string, toX: number, grabX: "left" | "right") => {
      const box = (await page.locator(selector).boundingBox())!;
      // Half of each handle sticks out of its (clipping) panel: grab the visible half.
      await page.mouse.move(grabX === "left" ? box.x + 2 : box.x + box.width - 2, box.y + 40);
      await page.mouse.down();
      await page.mouse.move(toX, box.y + 40, { steps: 5 });
      await page.mouse.up();
    };
    await drag("#slide-list-resizer", 330, "left");
    expect(await css("--slide-list-width")).toBe("330px");
    expect(await stored("slidesEditor.slideListWidth")).toBe("330");

    await drag("#props-resizer", 1400 - 400, "right");
    expect(await css("--props-width")).toBe("400px");
    expect(await stored("slidesEditor.propsPanelWidth")).toBe("400");

    await drag("#slide-list-resizer", 5, "left"); // clamps to the minimum
    expect(await stored("slidesEditor.slideListWidth")).toBe("180");
  });

  test("renames the deck in place; empty and Escape keep the old title", async ({ page }) => {
    await open(page);
    const title = page.locator("#deck-title");
    await title.click();
    await title.press("ControlOrMeta+A");
    await page.keyboard.type("Renamed Deck");
    await page.keyboard.press("Enter");
    await expect(title).toHaveText("Renamed Deck");
    await expect(page).toHaveTitle("Edit · Renamed Deck");
    await expect(page.locator("#status")).toHaveText("saved");
    expect((await dbRow(page, "decks", { deck_id: DECK }))?.title).toBe("Renamed Deck");

    await title.click();
    await title.press("ControlOrMeta+A");
    await page.keyboard.type("Discarded");
    await page.keyboard.press("Escape");
    await expect(title).toHaveText("Renamed Deck");
    expect((await dbRow(page, "decks", { deck_id: DECK }))?.title).toBe("Renamed Deck");

    await title.click();
    await title.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");
    await expect(title).toHaveText("Renamed Deck");
    await expect(page.locator("#toast")).toHaveText("Deck title can't be empty");
  });

  test("an open menu closes on an outside press and on Escape", async ({ page }) => {
    await open(page);
    const more = page.locator("#more-dropdown");
    await more.locator(":scope > summary").click();
    await expect(more).toHaveAttribute("open", "");
    await page.locator("#deck-title").click();
    await expect(more).not.toHaveAttribute("open", "");
    await more.locator(":scope > summary").click();
    await expect(more).toHaveAttribute("open", "");
    await page.keyboard.press("Escape");
    await expect(more).not.toHaveAttribute("open", "");
  });
});
