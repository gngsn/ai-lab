// The deck list page (decks): the status line and the list, deleting a deck, the Import modal (file
// and GitHub-link modes) and the Re-import modal. p0-2 and p0-17 pin the happy paths; these add what
// they leave open.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { dbRow, expect, readDb, test } from "../support/app";
import { DECK, PLAIN } from "../support/seed";

const path = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const read = (name: string) => readFileSync(path(name), "utf8");
const DECK_HTML = read("controller-deck.html");
const NOTES_MD = read("controller-deck.notes.md");
const KEYS_MD = read("controller-deck.keymessages.md");

const open = async (page: Page) => {
  await page.goto("/index.html");
  await expect(page.locator(".deck-item")).toHaveCount(2);
};
const deckItem = (page: Page, id: string) =>
  page.locator(".deck-item").filter({ has: page.locator(`[title="${id}"]`) });
const status = (page: Page) => page.locator("#status");

test.describe("the list", () => {
  test.use({ timezoneId: "Asia/Seoul" });
  test("the status line says connected, with the deck count", async ({ page }) => {
    await open(page);
    await expect(status(page).locator(".ok")).toHaveText("✓ connected");
    await expect(status(page)).toHaveText("✓ connected — 2 deck(s)");
  });

  test("each deck shows its title, id and last edit time", async ({ page }) => {
    await open(page);
    const item = deckItem(page, DECK);
    await expect(item.locator(".deck-title")).toHaveText(/\S/);
    const time = item.locator("time.deck-time");
    await expect(time).toHaveAttribute("datetime", "2026-01-02T00:00:00.000Z");
    await expect(time).toHaveText("2026. 01. 02. 오전 09:00"); // ko-KR, Seoul time
  });

  test("titles are shown as text, not as markup", async ({ page }) => {
    await page.addInitScript(() => {
      const db = JSON.parse(localStorage.getItem("__fakedb") || "{}");
      db.decks[0].title = `<b>Bold</b> & "quoted" 'single'`;
      localStorage.setItem("__fakedb", JSON.stringify(db));
    });
    await open(page);
    await expect(page.locator(".deck-title b")).toHaveCount(0);
    await expect(page.locator(".deck-title").first()).toHaveText(`<b>Bold</b> & "quoted" 'single'`);
  });

  test("with no decks it says how to add one", async ({ page }) => {
    await page.addInitScript(() => {
      const db = JSON.parse(localStorage.getItem("__fakedb") || "{}");
      db.decks = [];
      localStorage.setItem("__fakedb", JSON.stringify(db));
    });
    await page.goto("/index.html");
    await expect(status(page)).toHaveText("✓ connected — 0 deck(s)");
    await expect(page.locator("#deck-list li")).toHaveText(
      "(none — run migrations/seed.sql for a sample deck)",
    );
    await expect(page.locator("#deck-list li code")).toHaveText("migrations/seed.sql");
  });

  test("a failing database shows the error in the status line and a dash in the list", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("__fakedb", "{ broken"));
    await page.goto("/index.html");
    await expect(status(page).locator(".bad")).toBeVisible();
    await expect(status(page).locator(".bad")).toContainText("✗ ");
    await expect(page.locator("#deck-list li")).toHaveText("—");
  });

  test("the Present and Script links carry the deck's sync room", async ({ page }) => {
    await open(page);
    const item = deckItem(page, PLAIN);
    await expect(item.getByRole("link", { name: "Present", exact: true })).toHaveAttribute(
      "href",
      `./present.html?deck=${PLAIN}&sync=${PLAIN}`,
    );
  });
});

test.describe("deleting", () => {
  test("asks first, then removes the deck and its rows, and refreshes the list", async ({
    page,
  }) => {
    await open(page);
    const messages: string[] = [];
    page.removeAllListeners("dialog");
    page.on("dialog", (d) => {
      messages.push(d.message());
      void d.accept();
    });
    await deckItem(page, PLAIN).locator("[data-delete-deck]").click();
    await expect(page.locator(".deck-item")).toHaveCount(1);
    await expect(status(page)).toHaveText("✓ connected — 1 deck(s)");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("덱을 삭제할까요?");
    expect(messages[0]).toContain(`"`);
    const db = await readDb(page);
    expect(db.decks.map((d) => d.deck_id)).toEqual([DECK]);
    expect(db.slides.filter((s) => s.deck_id === PLAIN)).toHaveLength(0);
  });

  test("declining changes nothing", async ({ page }) => {
    await open(page);
    page.removeAllListeners("dialog");
    page.once("dialog", (d) => void d.dismiss());
    const button = deckItem(page, PLAIN).locator("[data-delete-deck]");
    await button.click();
    await page.waitForTimeout(300);
    await expect(page.locator(".deck-item")).toHaveCount(2);
    await expect(button).toBeEnabled();
    await expect(button).toHaveText("Delete");
    expect((await readDb(page)).decks).toHaveLength(2);
  });
});

test.describe("the Import modal", () => {
  const modal = (page: Page) => page.locator("#import-modal-bg");

  test("File and GitHub open it in their own mode", async ({ page }) => {
    await open(page);
    await expect(modal(page)).not.toHaveClass(/\bshow\b/);
    await expect(modal(page)).toHaveAttribute("aria-hidden", "true");
    await page.locator("#import-html-btn").click();
    await expect(modal(page)).toHaveClass(/\bshow\b/);
    await expect(modal(page)).toHaveAttribute("aria-hidden", "false");
    await expect(page.locator("#import-modal-title")).toHaveText("Import HTML deck");
    await expect(page.locator("#import-intro")).toContainText("Choose an HTML presentation file");
    await expect(page.locator("#import-file")).toBeVisible();
    await expect(page.locator("#import-url")).toBeHidden();
    await page.locator("#import-cancel-btn").click();
    await expect(modal(page)).not.toHaveClass(/\bshow\b/);

    await page.locator("#import-url-btn").click();
    await expect(page.locator("#import-modal-title")).toHaveText("Import from GitHub");
    await expect(page.locator("#import-intro")).toContainText("Paste the URL");
    await expect(page.locator("#import-url")).toBeVisible();
    await expect(page.locator("#import-file")).toBeHidden();
    await expect(page.locator("#import-github-token")).toBeVisible();
  });

  test("clicking the backdrop closes it, clicking inside does not", async ({ page }) => {
    await open(page);
    await page.locator("#import-html-btn").click();
    await page.locator("#import-modal-bg .modal h2").click();
    await expect(modal(page)).toHaveClass(/\bshow\b/);
    await modal(page).click({ position: { x: 5, y: 5 } });
    await expect(modal(page)).not.toHaveClass(/\bshow\b/);
  });

  test("opening it again starts empty", async ({ page }) => {
    await open(page);
    await page.locator("#import-html-btn").click();
    await page.locator("#import-file").setInputFiles(path("controller-deck.html"));
    await expect(page.locator("#import-deck-id")).toHaveValue("controller-deck");
    await page.locator("#import-cancel-btn").click();
    await page.locator("#import-html-btn").click();
    await expect(page.locator("#import-deck-id")).toHaveValue("");
    await expect(page.locator("#import-title")).toHaveValue("");
    await expect(page.locator("#import-error")).toBeHidden();
  });

  test("choosing a file fills in the deck id and title, but never over what was typed", async ({
    page,
  }) => {
    await open(page);
    await page.locator("#import-html-btn").click();
    await page.locator("#import-deck-id").fill("mine");
    await page.locator("#import-file").setInputFiles(path("controller-deck.html"));
    await expect(page.locator("#import-title")).toHaveValue("Controller Deck");
    await expect(page.locator("#import-deck-id")).toHaveValue("mine");
  });

  test("a file with no sections says so and nothing is written", async ({ page }) => {
    await open(page);
    await page.locator("#import-html-btn").click();
    await page.locator("#import-file").setInputFiles({
      name: "empty.html",
      mimeType: "text/html",
      buffer: Buffer.from("<html><body><p>nothing</p></body></html>"),
    });
    await page.locator("#import-run-btn").click();
    await expect(page.locator("#import-error")).toContainText("No <section> slides found");
    await expect(page.locator("#import-run-btn")).toBeEnabled();
    await expect(page.locator("#import-run-btn")).toHaveText("Import");
    expect((await readDb(page)).decks).toHaveLength(2);
  });

  test("importing over an existing deck id replaces its slides", async ({ page }) => {
    await open(page);
    await page.locator("#import-html-btn").click();
    await page.locator("#import-file").setInputFiles(path("controller-deck.html"));
    await page.locator("#import-deck-id").fill(PLAIN);
    await page.locator("#import-run-btn").click();
    await page.waitForURL(`**/edit.html?deck=${PLAIN}`);
    const db = await readDb(page);
    expect(db.slides.filter((s) => s.deck_id === PLAIN)).toHaveLength(6);
    expect(db.decks.filter((d) => d.deck_id === PLAIN)).toHaveLength(1);
  });

  test("an import that is only notes-shorter keeps the first notes", async ({ page }) => {
    await open(page);
    await page.locator("#import-html-btn").click();
    await page.locator("#import-file").setInputFiles(path("controller-deck.html"));
    await page.locator("#import-deck-id").fill("short-notes");
    await page.locator("#import-notes-file").setInputFiles({
      name: "n.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("## One\n\nfirst note\n\n---\n\n## Two\n\nsecond note\n"),
    });
    await page.locator("#import-run-btn").click();
    await page.waitForURL("**/edit.html?deck=short-notes");
    const db = await readDb(page);
    const slides = db.slides
      .filter((s) => s.deck_id === "short-notes")
      .sort((a, b) => (a.order as number) - (b.order as number));
    const notes = slides.map((s) =>
      String(
        db.notes.find((n) => n.deck_id === "short-notes" && n.section_id === s.section_id)
          ?.content ?? "",
      ),
    );
    expect(notes[0]).toContain("first note");
    expect(notes[1]).toContain("second note");
    expect(notes[2]).toBe("");
  });

  test.describe("from a GitHub link", () => {
    // the GitHub form is taller than the default window: keep every button on screen
    test.use({ viewport: { width: 1280, height: 1300 } });
    const BLOB = "https://github.com/o/r/blob/main/talk/index.html";
    const RAW = "https://raw.githubusercontent.com/o/r/main/talk/index.html";
    const NOTES = "https://raw.githubusercontent.com/o/r/main/talk/script.md";
    const KEYS = "https://raw.githubusercontent.com/o/r/main/talk/keys.md";
    test.beforeEach(async ({ page }) => {
      await page.route("https://raw.githubusercontent.com/**", (route) => {
        const url = route.request().url();
        const headers = { "access-control-allow-origin": "*" };
        if (url === RAW)
          return route.fulfill({ headers, contentType: "text/html", body: DECK_HTML });
        if (url === NOTES)
          return route.fulfill({ headers, contentType: "text/plain", body: NOTES_MD });
        if (url === KEYS)
          return route.fulfill({ headers, contentType: "text/plain", body: KEYS_MD });
        return route.fulfill({ status: 404, headers, body: "not found" });
      });
      await page.route("https://api.github.com/**", (route) =>
        route.fulfill({
          status: 401,
          headers: { "access-control-allow-origin": "*" },
          body: "{}",
        }),
      );
    });

    test("a pasted link is fetched; the hint says what was found; the id comes from the folder", async ({
      page,
    }) => {
      await open(page);
      await page.locator("#import-url-btn").click();
      await page.locator("#import-url").fill(BLOB);
      await page.locator("#import-url").blur();
      await expect(page.locator("#import-url-hint")).toContainText("✓ 6 slide(s) found");
      await expect(page.locator("#import-deck-id")).toHaveValue("talk");
      await expect(page.locator("#import-title")).toHaveValue("Controller Deck");
    });

    test("notes and key messages links report how many they hold; Import writes everything", async ({
      page,
    }) => {
      await open(page);
      await page.locator("#import-url-btn").click();
      await page.locator("#import-url").fill(BLOB);
      await page.locator("#import-notes-url").fill(NOTES);
      await page.locator("#import-km-url").fill(KEYS);
      await page.locator("#import-km-url").blur();
      await expect(page.locator("#import-notes-url-hint")).toContainText("note(s) found");
      await expect(page.locator("#import-km-url-hint")).toContainText("key message(s) found");
      await page.locator("#import-run-btn").click();
      await page.waitForURL("**/edit.html?deck=talk");
      const db = await readDb(page);
      expect(db.slides.filter((s) => s.deck_id === "talk")).toHaveLength(6);
      expect(
        db.notes.filter((n) => n.deck_id === "talk" && String(n.key_message).length > 0).length,
      ).toBeGreaterThan(0);
    });

    test("a link that cannot be fetched is reported and clears the hint", async ({ page }) => {
      await open(page);
      await page.locator("#import-url-btn").click();
      await page.locator("#import-url").fill("https://github.com/o/r/blob/main/missing.html");
      await page.locator("#import-url").blur();
      await expect(page.locator("#import-error")).toBeVisible();
      await expect(page.locator("#import-url-hint")).toHaveText("");
    });

    test("choosing a file clears the link and the other way round", async ({ page }) => {
      await open(page);
      await page.locator("#import-url-btn").click();
      await page.locator("#import-url").fill(BLOB);
      await page.locator("#import-url").blur();
      await expect(page.locator("#import-url-hint")).toContainText("slide(s) found");
      await page.locator("#import-file").setInputFiles(path("controller-deck.html"));
      await expect(page.locator("#import-url")).toHaveValue("");
      await expect(page.locator("#import-url-hint")).toHaveText("");
    });

    test("the GitHub token is remembered in this browser, and removed when emptied", async ({
      page,
    }) => {
      await open(page);
      await page.locator("#import-url-btn").click();
      await page.locator("#import-github-token").fill("github_pat_x");
      await page.locator("#import-github-token").blur();
      expect(await page.evaluate(() => localStorage.getItem("speakeasy:github-token"))).toBe(
        "github_pat_x",
      );
      await page.reload();
      await page.locator("#import-url-btn").click();
      await expect(page.locator("#import-github-token")).toHaveValue("github_pat_x");
      await page.locator("#import-github-token").fill("");
      await page.locator("#import-github-token").blur();
      expect(await page.evaluate(() => localStorage.getItem("speakeasy:github-token"))).toBeNull();
    });

    test("changing the token re-fetches a link that was already entered", async ({ page }) => {
      const requests: string[] = [];
      page.on("request", (r) => {
        if (/github/.test(new URL(r.url()).hostname)) requests.push(r.url());
      });
      await open(page);
      await page.locator("#import-url-btn").click();
      await page.locator("#import-url").fill(BLOB);
      await page.locator("#import-url").blur();
      await expect(page.locator("#import-url-hint")).toContainText("slide(s) found");
      const before = requests.length;
      await page.locator("#import-github-token").fill("tok");
      await page.locator("#import-github-token").blur();
      // with a token the raw file is asked of the GitHub API instead
      await expect
        .poll(() => requests.some((u) => u.startsWith("https://api.github.com/")))
        .toBe(true);
      expect(requests.length).toBeGreaterThan(before);
    });
  });
});

test.describe("the Re-import modal", () => {
  const modal = (page: Page) => page.locator("#reimport-modal-bg");
  const part = (page: Page, name: string) => page.locator(`.reimport-part[data-part="${name}"]`);
  const openFor = async (page: Page, id = DECK) => {
    await open(page);
    await deckItem(page, id).locator("[data-reimport-deck]").click();
    await expect(modal(page)).toHaveClass(/\bshow\b/);
  };
  const md = (name: string, body: string) => ({
    name,
    mimeType: "text/markdown",
    buffer: Buffer.from(body),
  });

  test("it shows the deck's title and starts with nothing picked", async ({ page }) => {
    await openFor(page);
    await expect(page.locator("#reimport-title")).toHaveText(
      (await deckItem(page, DECK).locator(".deck-title").textContent()) ?? "",
    );
    await expect(page.locator("#reimport-run")).toBeDisabled();
    await expect(page.locator("#reimport-run")).toHaveText("Replace");
    for (const name of ["slides", "script", "keys"])
      await expect(part(page, name).locator(".part-state")).toHaveText("Keep current");
    await expect(page.locator("#reimport-error")).toBeHidden();
  });

  test("Cancel, Escape and the backdrop close it; inside clicks do not", async ({ page }) => {
    await openFor(page);
    await page.locator("#reimport-modal-bg .modal h2").click();
    await expect(modal(page)).toHaveClass(/\bshow\b/);
    await page.locator("#reimport-cancel").click();
    await expect(modal(page)).not.toHaveClass(/\bshow\b/);
    await expect(modal(page)).toHaveAttribute("aria-hidden", "true");
    await deckItem(page, DECK).locator("[data-reimport-deck]").click();
    await page.keyboard.press("Escape");
    await expect(modal(page)).not.toHaveClass(/\bshow\b/);
    await deckItem(page, DECK).locator("[data-reimport-deck]").click();
    await modal(page).click({ position: { x: 5, y: 5 } });
    await expect(modal(page)).not.toHaveClass(/\bshow\b/);
  });

  test("a picked file says what it holds; Clear puts the part back", async ({ page }) => {
    await openFor(page);
    await part(page, "keys")
      .locator('input[type="file"]')
      .setInputFiles(path("controller-deck.keymessages.md"));
    await expect(part(page, "keys")).toHaveAttribute("data-state", "ready");
    await expect(part(page, "keys").locator(".part-state span")).toHaveText(
      /^✓ controller-deck\.keymessages\.md — \d+ key messages?$/,
    );
    await part(page, "keys").locator(".part-clear").click();
    await expect(part(page, "keys")).not.toHaveAttribute("data-state", "ready");
    await expect(part(page, "keys").locator(".part-state")).toHaveText("Keep current");
    await expect(page.locator("#reimport-run")).toBeDisabled();
  });

  test("a file with nothing in it is an error on that part, with Clear", async ({ page }) => {
    await openFor(page);
    await part(page, "script").locator('input[type="file"]').setInputFiles(md("e.md", "   "));
    await expect(part(page, "script")).toHaveAttribute("data-state", "error");
    await expect(part(page, "script").locator(".part-state span")).toHaveText("No notes found.");
    await expect(part(page, "script").locator(".part-clear")).toBeVisible();
    await expect(page.locator("#reimport-run")).toBeDisabled();
  });

  test("the button names what will be replaced", async ({ page }) => {
    await openFor(page);
    const run = page.locator("#reimport-run");
    await part(page, "script")
      .locator('input[type="file"]')
      .setInputFiles(path("controller-deck.notes.md"));
    await expect(run).toHaveText("Replace script");
    await part(page, "keys")
      .locator('input[type="file"]')
      .setInputFiles(path("controller-deck.keymessages.md"));
    await expect(run).toHaveText("Replace script + key messages");
    await part(page, "slides")
      .locator('input[type="file"]')
      .setInputFiles(path("controller-deck.html"));
    await expect(run).toHaveText("Replace all");
    await part(page, "slides").locator(".part-clear").click();
    await expect(run).toHaveText("Replace script + key messages");
  });

  test("replacing slides and script saves the old ones to History first and reports it", async ({
    page,
  }) => {
    await openFor(page);
    const before = await readDb(page);
    await part(page, "slides")
      .locator('input[type="file"]')
      .setInputFiles(path("controller-deck.html"));
    await part(page, "script")
      .locator('input[type="file"]')
      .setInputFiles(path("controller-deck.notes.md"));
    await expect(page.locator("#reimport-run")).toHaveText("Replace slides + script");
    await page.locator("#reimport-run").click();
    await expect(modal(page)).not.toHaveClass(/\bshow\b/);
    await expect(status(page).locator(".ok").last()).toHaveText(
      /^re-imported controller-deck: 6 slide\(s\) \+ script \(\d+ note\(s\)\)$/,
    );
    await expect(status(page)).toContainText("✓ connected — 2 deck(s) · re-imported");
    const db = await readDb(page);
    const snaps = db.slide_history.filter((r) => r.deck_id === DECK);
    expect(snaps.length).toBeGreaterThan(before.slide_history.length);
    expect(snaps.some((r) => r.message === "Before re-import" && r.kind === "manual")).toBe(true);
    expect(db.frame_history.some((r) => r.deck_id === DECK)).toBe(true);
    expect(db.notes_history.some((r) => r.deck_id === DECK)).toBe(true);
  });

  test("replacing only key messages leaves History alone", async ({ page }) => {
    await openFor(page);
    const before = await readDb(page);
    await part(page, "keys")
      .locator('input[type="file"]')
      .setInputFiles(path("controller-deck.keymessages.md"));
    await page.locator("#reimport-run").click();
    await expect(modal(page)).not.toHaveClass(/\bshow\b/);
    const db = await readDb(page);
    expect(db.slide_history).toEqual(before.slide_history);
    expect(db.notes_history).toEqual(before.notes_history);
    const first = db.slides.find((s) => s.deck_id === DECK)!;
    expect(
      (await dbRow(page, "notes", { deck_id: DECK, section_id: first.section_id }))?.key_message,
    ).toBe("시작: 오늘의 한 문장");
  });

  test("opening it again starts clean", async ({ page }) => {
    await openFor(page);
    await part(page, "keys")
      .locator('input[type="file"]')
      .setInputFiles(path("controller-deck.keymessages.md"));
    await page.locator("#reimport-cancel").click();
    await deckItem(page, PLAIN).locator("[data-reimport-deck]").click();
    await expect(part(page, "keys").locator(".part-state")).toHaveText("Keep current");
    await expect(page.locator("#reimport-run")).toBeDisabled();
    await expect(page.locator("#reimport-title")).toHaveText(
      (await deckItem(page, PLAIN).locator(".deck-title").textContent()) ?? "",
    );
  });
});
