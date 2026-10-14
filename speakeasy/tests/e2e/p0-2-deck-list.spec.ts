// P0-2: the deck list shows the decks (newest first) with links to every
// screen, and a shared-view link only for shared decks.
import { expect, test } from "../support/app";
import { DECK, PLAIN, TOKEN } from "../support/seed";

test("lists decks with working links", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#status, .status").first()).toContainText("2 deck(s)");

  const items = page.locator(".deck-item");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).locator(".deck-title")).toHaveAttribute("title", DECK); // newest first
  await expect(items.nth(1).locator(".deck-title")).toHaveAttribute("title", PLAIN);

  const link = (item: number, text: string) =>
    items.nth(item).getByRole("link", { name: text, exact: true });
  await expect(link(0, "Edit")).toHaveAttribute("href", `./edit.html?deck=${DECK}`);
  await expect(link(0, "Practice")).toHaveAttribute("href", `./pronunciation.html?deck=${DECK}`);
  await expect(link(0, "Present")).toHaveAttribute(
    "href",
    `./present.html?deck=${DECK}&sync=${DECK}`,
  );
  await expect(link(0, "Script")).toHaveAttribute(
    "href",
    `./script.html?deck=${DECK}&sync=${DECK}`,
  );
  await expect(link(0, "Shared view ↗")).toHaveAttribute(
    "href",
    `./view.html?deck=${DECK}&token=${TOKEN}`,
  );
  await expect(items.nth(1).getByRole("link", { name: "Shared view ↗" })).toHaveCount(0);
});
