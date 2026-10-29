// P6-5: the public pages (view, share). The older specs pin the happy paths
// (p0-6/7 follow, p0-8 token checks, p0-10 preload, p0-12 captions, p6-0 print
// mode and letterbox geometry). These add what they leave open: the error
// pages, hidden slides, the speakeasy-mode chrome, the keyboard help, the
// follow control's labels, the CC preference and key forwarding. They pass on
// the legacy pages first and must keep passing on the port.
import type { Page } from "@playwright/test";
import { deckFrame, expect, press, slideState, test } from "../support/app";
import { BILINGUAL, DECK, PLAIN, TOKEN } from "../support/seed";

const HID = "hidden-deck";
const EMPTY = "empty-deck";
const room = "v5";

/** Decks the seed does not have: a shared plain deck, one with a hidden slide, one with no slides. */
const addDecks = (page: Page) =>
  page.addInitScript(
    ({ hid, empty }) => {
      const db = JSON.parse(localStorage.getItem("__fakedb") || "{}");
      const ids = (db.decks ?? []).map((d: { deck_id: string }) => d.deck_id);
      const plain = db.decks.find((d: { deck_id: string }) => d.deck_id === "plain-deck");
      if (!plain.share_token) plain.share_token = "ptok";
      if (!ids.includes(hid)) {
        db.decks.push({ ...plain, deck_id: hid, title: "Hidden deck", share_token: "tok" });
        const rows = db.slides
          .filter((s: { deck_id: string }) => s.deck_id === "plain-deck")
          .map((s: { content: string }, i: number) => ({
            ...s,
            deck_id: hid,
            content:
              i === 1 ? s.content.replace("<section", '<section data-hidden="true"') : s.content,
          }));
        db.slides.push(...rows);
      }
      if (!ids.includes(empty)) {
        db.decks.push({ ...plain, deck_id: empty, title: "Empty deck", share_token: "tok" });
      }
      localStorage.setItem("__fakedb", JSON.stringify(db));
    },
    { hid: HID, empty: EMPTY },
  );

const frameBody = (page: Page) => page.frameLocator("#__se_letterbox").locator("body");

test.describe("error pages", () => {
  test.use({ authed: false });

  test("a missing deck id is reported in a <pre>, escaped", async ({ page }) => {
    await page.goto("/view.html");
    await expect(frameBody(page)).toContainText("Missing ?deck=<deck_id>");
    const pre = page.frameLocator("#__se_letterbox").locator("body > pre");
    await expect(pre).toHaveCount(1);
    expect(await pre.innerHTML()).toContain("&lt;deck_id&gt;");
    // the message replaces the whole page
    await expect(page.frameLocator("#__se_letterbox").locator("body > p")).toHaveCount(0);
  });

  test("an unknown deck says it cannot be opened", async ({ page }) => {
    await page.goto(`/view.html?deck=nope&token=${TOKEN}`);
    await expect(frameBody(page)).toContainText("Cannot open deck:");
  });

  test("a deck with no slides says so", async ({ page }) => {
    await addDecks(page);
    await page.goto(`/view.html?deck=${EMPTY}&token=tok`);
    await expect(frameBody(page)).toContainText(`Deck '${EMPTY}' has no slides.`);
  });

  test("the error page keeps the viewer without a presenter panel", async ({ page }) => {
    await page.goto("/view.html");
    await expect(frameBody(page)).toContainText("Missing");
    await expect(page.locator("#__se_follow")).toHaveCount(0);
  });
});

test.describe("what the page shows", () => {
  test.use({ authed: false });

  test("slides hidden in the editor are left out", async ({ page }) => {
    await addDecks(page);
    await page.goto(`/view.html?deck=${HID}&token=tok`);
    const frame = await deckFrame(page);
    const ids = await frame.evaluate(() =>
      [...document.querySelectorAll("section[data-section-id]")].map((s) =>
        s.getAttribute("data-section-id"),
      ),
    );
    expect(ids.length).toBe(3);
    expect(ids).not.toContain(null);
    await expect(frame.locator("#__se_counter")).toHaveCount(0);
  });

  test("a plain deck gets the read-only note and a Home link, and the layout fallback", async ({
    page,
  }) => {
    await addDecks(page);
    await page.goto(`/view.html?deck=${PLAIN}&token=ptok`);
    const frame = await deckFrame(page);
    const overlay = frame.locator("#__se_overlay");
    await expect(overlay).toHaveJSProperty("hidden", false);
    await expect(overlay).toContainText("read-only · shared view");
    const home = overlay.locator('a[href="./index.html"]');
    await expect(home).toHaveAttribute("target", "_top");
    await expect(home).toHaveText("⌂ Home");
    await expect(frame.locator("#__se_fallback")).toHaveJSProperty("media", "all");
  });

  test("a deck with its own controller keeps the overlay hidden and no fallback", async ({
    page,
  }) => {
    await page.goto(`/view.html?deck=${DECK}&token=${TOKEN}`);
    const frame = await deckFrame(page);
    await expect(frame.locator("#__se_overlay")).toHaveJSProperty("hidden", true);
    await expect(frame.locator("#__se_fallback")).toHaveJSProperty("media", "not all");
  });

  test("share has no overlay and no Home link", async ({ page }) => {
    await addDecks(page);
    await page.goto(`/share.html?deck=${PLAIN}&token=ptok&sync=${room}`);
    const frame = await deckFrame(page);
    await expect(frame.locator("#__se_overlay")).toHaveCount(0);
    await expect(frame.locator('a[href="./index.html"]')).toHaveCount(0);
  });

  test("? opens the keyboard help for a plain deck, titled View (shared)", async ({ page }) => {
    await addDecks(page);
    await page.goto(`/view.html?deck=${PLAIN}&token=ptok`);
    await deckFrame(page);
    await page.keyboard.press("Shift+?");
    const modal = page.frameLocator("#__se_letterbox").locator("#__se_shortcuts_modal");
    await expect(modal).toContainText("View (shared)");
    await expect(modal).toContainText("Next slide / advance fragment");
    await expect(modal).toContainText("Jump to first / last slide");
  });

  test("a deck with its own controller has no keyboard help", async ({ page }) => {
    await page.goto(`/view.html?deck=${DECK}&token=${TOKEN}`);
    await deckFrame(page);
    await page.keyboard.press("Shift+?");
    await page.waitForTimeout(300);
    await expect(page.frameLocator("#__se_letterbox").locator("#__se_shortcuts_modal")).toHaveCount(
      0,
    );
  });

  test("the view page ignores ?sync: no follow control, no captions", async ({ page }) => {
    await page.goto(`/view.html?deck=${DECK}&token=${TOKEN}&sync=${room}`);
    await deckFrame(page);
    await page.waitForTimeout(500);
    await expect(page.locator("#__se_follow")).toHaveCount(0);
    await expect(page.locator("#__se_cc_box")).toHaveCount(0);
  });

  test("the follow control is not on the view page", async ({ page }) => {
    await page.goto(`/view.html?deck=${DECK}&token=${TOKEN}`);
    await deckFrame(page);
    await expect(page.locator("#__se_follow")).toHaveCount(0);
    await expect(page.locator("#__se_follow_hint")).toHaveCount(0);
    await expect(page.locator("#__se_cc_toggle")).toHaveCount(0);
  });
});

test.describe("the follow control", () => {
  test.use({ authed: false });
  const open = async (page: Page) => {
    await page.goto(`/share.html?deck=${DECK}&token=${TOKEN}&sync=${room}`);
    await deckFrame(page);
  };

  test("starts as Waiting…, following, with the long labels in the page and not the slide", async ({
    page,
  }) => {
    await open(page);
    await expect(page.locator("#__se_status")).toHaveText("Waiting…");
    const toggle = page.locator("#__se_follow_toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveAttribute(
      "aria-label",
      "Stop following the presenter and browse on your own",
    );
    await expect(toggle.locator(".lbl")).toHaveText("Pause");
    await expect(toggle.locator(".more")).toHaveText(" · manual control");
    // lives in the page around the slide, not inside the deck document
    await expect(page.frameLocator("#__se_letterbox").locator("#__se_follow")).toHaveCount(0);
    await expect(page.locator("#__se_follow_hint")).toHaveAttribute("role", "status");
  });

  test("Pause then Follow flips the labels and the hint fades", async ({ page }) => {
    await open(page);
    const toggle = page.locator("#__se_follow_toggle");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle.locator(".more")).toHaveText(" the presenter");
    await expect(toggle).toHaveAttribute(
      "aria-label",
      "Jump back to the presenter's slide and follow along",
    );
    await expect(page.locator("#__se_status")).toHaveCSS("color", "rgb(154, 154, 156)");
    const hint = page.locator("#__se_follow_hint");
    await expect(hint).toHaveClass(/\bshow\b/);
    await expect(hint).not.toHaveClass(/\bshow\b/, { timeout: 5000 });
    // the text stays after it fades
    await expect(hint).toContainText("Paused");
  });

  test("a new page load starts following again", async ({ page }) => {
    await open(page);
    await page.locator("#__se_follow_toggle").click();
    await page.reload();
    await deckFrame(page);
    await expect(page.locator("#__se_follow_toggle")).toHaveAttribute("aria-pressed", "true");
  });

  test("a second follow control is never added", async ({ page }) => {
    await open(page);
    await expect(page.locator("#__se_follow")).toHaveCount(1);
    await expect(page.locator("#__se_follow_hint")).toHaveCount(1);
  });
});

test.describe("captions on the audience page", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(({ md, key }) => localStorage.setItem(key, md), {
      md: BILINGUAL,
      key: `speakeasy:captions:script:${DECK}`,
    });
  });
  const LINE = "This slide is split into two steps.";
  const HEARD = "두단계로나뉜슬라이드입니다";

  async function withCaption(page: Page, context: import("@playwright/test").BrowserContext) {
    await page.goto(`/present.html?deck=${DECK}&sync=${room}`);
    await deckFrame(page);
    await press(page, "ArrowRight", 3);
    await expect(page.locator("#__se_panel .pp-title")).toHaveText("Two steps");
    await expect(page.locator(".pp-cc")).toHaveAttribute("data-state", "ready");
    const audience = await context.newPage();
    await audience.goto(`/share.html?deck=${DECK}&token=${TOKEN}&sync=${room}`);
    await deckFrame(audience);
    // the caption box is drawn once the audience page has loaded its caption module;
    // a line sent before that has nobody listening
    await expect(audience.locator("#__se_cc_box")).toBeAttached();
    await page.bringToFront();
    return audience;
  }
  const feed = (page: Page, text: string) =>
    page.evaluate((t) => (window as any).__seCaptions.feed(t, true), text);

  test("nothing is drawn until the first caption: no CC button, caption box empty", async ({
    page,
    context,
  }) => {
    const audience = await withCaption(page, context);
    await expect(audience.locator("#__se_cc_toggle")).toBeHidden();
    await expect(audience.locator("#__se_cc_box")).toBeEmpty();
    await expect(audience.locator("#__se_cc_box")).toHaveAttribute("aria-live", "polite");
    await expect(audience.locator("#__se_cc_box")).toHaveAttribute("role", "status");
    await feed(page, HEARD);
    await expect(audience.locator("#__se_cc_toggle")).toBeVisible();
    await expect(audience.locator("#__se_cc_toggle")).toHaveText("CC");
  });

  test("switching CC off is remembered for the next visit", async ({ page, context }) => {
    const audience = await withCaption(page, context);
    await feed(page, HEARD);
    await expect(audience.locator("#__se_cc_box")).toHaveText(LINE);
    await audience.locator("#__se_cc_toggle").click();
    expect(await audience.evaluate(() => localStorage.getItem("speakeasy:captions:on"))).toBe("0");
    await audience.reload();
    await deckFrame(audience);
    await page.bringToFront();
    await feed(page, "첫번째단계를보여드리겠습니다");
    await expect(audience.locator("#__se_cc_toggle")).toBeVisible();
    await expect(audience.locator("#__se_cc_toggle")).toHaveAttribute("aria-pressed", "false");
    // the text is kept but not shown
    await expect(audience.locator("#__se_cc_box")).toHaveText("Let me show you the first step.");
    await expect(audience.locator("#__se_cc_box")).not.toHaveClass(/\bshow\b/);
  });

  test("a caption fades away on its own", async ({ page, context }) => {
    const audience = await withCaption(page, context);
    await feed(page, HEARD);
    await expect(audience.locator("#__se_cc_box")).toHaveClass(/\bshow\b/);
    await expect(audience.locator("#__se_cc_box")).not.toHaveClass(/\bshow\b/, {
      timeout: 16_000,
    });
  });
});

test.describe("keys on the letterbox page", () => {
  test.use({ authed: false });

  test("a key typed on the bars goes to the slides; Ctrl/Cmd/Alt combinations do not", async ({
    page,
  }) => {
    await page.goto(`/view.html?deck=${DECK}&token=${TOKEN}`);
    const frame = await deckFrame(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.locator("body").evaluate((b) => b.focus());
    await page.keyboard.press("Control+ArrowRight");
    await page.waitForTimeout(300);
    expect(await slideState(frame)).toMatchObject({ index: 0 });
    await page.keyboard.press("Alt+ArrowRight");
    await page.waitForTimeout(300);
    expect(await slideState(frame)).toMatchObject({ index: 0 });
    await press(page, "ArrowRight");
    await expect.poll(() => slideState(frame)).toMatchObject({ index: 1 });
  });

  test("the deck is the document's only top-level frame and takes focus", async ({ page }) => {
    await page.goto(`/view.html?deck=${DECK}&token=${TOKEN}`);
    await deckFrame(page);
    await expect(page.locator("iframe")).toHaveCount(1);
    await expect(page.locator("iframe")).toHaveAttribute("title", "Slides");
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("__se_letterbox");
  });
});
