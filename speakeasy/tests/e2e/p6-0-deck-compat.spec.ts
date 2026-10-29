// Deck-runtime compatibility. These tests pin behaviour that decks and shared
// links already depend on and that the older p0 specs do not cover: letterbox geometry, the tab
// title, print mode, the relative URLs a stored frame_html can use, and the token-only view page.
import { deckFrame, expect, press, readDb, slideState, test } from "../support/app";
import { DECK, PLAIN, TOKEN } from "../support/seed";

const REL = "relative-deck";

test.describe("letterbox", () => {
  test("view.html scales a 1280x720 frame to fit the window, centred", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 1000 });
    await page.goto(`/view.html?deck=${DECK}&token=${TOKEN}`);
    await deckFrame(page);
    const box = await page.locator("#__se_letterbox").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        w: r.width,
        h: r.height,
        x: r.x,
        y: r.y,
        cssW: el.clientWidth,
        cssH: el.clientHeight,
      };
    });
    expect(box.cssW).toBe(1280);
    expect(box.cssH).toBe(720);
    expect(box.w).toBeCloseTo(1000, 0);
    expect(box.h).toBeCloseTo(562.5, 0);
    expect(box.x).toBeCloseTo(0, 0);
    expect(box.y).toBeCloseTo(218.75, 0);
  });

  test("a wider window letterboxes at the sides", async ({ page }) => {
    await page.setViewportSize({ width: 2000, height: 720 });
    await page.goto(`/view.html?deck=${DECK}&token=${TOKEN}`);
    await deckFrame(page);
    const box = await page.locator("#__se_letterbox").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, x: r.x, y: r.y };
    });
    expect(box.h).toBeCloseTo(720, 0);
    expect(box.w).toBeCloseTo(1280, 0);
    expect(box.x).toBeCloseTo(360, 0);
    expect(box.y).toBeCloseTo(0, 0);
  });

  test("present.html fits the slide into the stage beside the panel", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/present.html?deck=${DECK}`);
    await deckFrame(page);
    await expect(page.locator("#__se_stage #__se_letterbox")).toHaveCount(1);
    await expect(page.locator("#__se_panel")).toHaveCount(1);
    const { stage, frame } = await page.evaluate(() => {
      const r = (id: string) => document.getElementById(id)?.getBoundingClientRect();
      const s = r("__se_stage");
      const f = r("__se_letterbox");
      return {
        stage: { w: s?.width ?? 0, x: s?.x ?? 0 },
        frame: { w: f?.width ?? 0, x: f?.x ?? 0 },
      };
    });
    expect(stage.w).toBeGreaterThan(900);
    expect(frame.w).toBeLessThanOrEqual(stage.w + 1);
    expect(frame.x).toBeGreaterThanOrEqual(stage.x - 1);
  });
});

test("the tab title mirrors the deck's title", async ({ page }) => {
  const title = (
    await (async () => {
      await page.goto(`/index.html`);
      return readDb(page);
    })()
  ).decks.find((d) => d.deck_id === DECK)?.title as string;
  expect(title).toBeTruthy();
  await page.goto(`/present.html?deck=${DECK}`);
  await deckFrame(page);
  await expect.poll(() => page.title()).toBe(title);
});

test.describe("print mode (?print=1)", () => {
  test("shows every slide in the plain document with everything revealed", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __prints: number }).__prints = 0;
      window.print = () => {
        (window as unknown as { __prints: number }).__prints++;
      };
    });
    await page.goto(`/present.html?deck=${DECK}&print=1`);
    await expect(page.locator("#__se_letterbox")).toHaveCount(0);
    await expect(page.locator("section.slide")).toHaveCount(6);
    // slides carry their ids and the runtime-only chrome is absent
    await expect(page.locator("section.slide[data-section-id]")).toHaveCount(6);
    await expect(page.locator("#__se_overlay")).toHaveCount(0);
    // every slide and fragment is revealed
    await expect
      .poll(() =>
        page.evaluate(() => ({
          hiddenSlides: document.querySelectorAll("section.slide:not(.visible)").length,
          hiddenFragments: document.querySelectorAll(".fragment:not(.show)").length,
          fragments: document.querySelectorAll(".fragment").length,
        })),
      )
      .toEqual({ hiddenSlides: 0, hiddenFragments: 0, fragments: expect.any(Number) });
    expect(
      await page.evaluate(() => document.querySelectorAll(".fragment").length),
    ).toBeGreaterThan(0);
    // the deck's own scripts are stripped, so its controller class never exists here
    expect(
      await page.evaluate(
        () =>
          [...document.scripts].filter((script) =>
            script.textContent?.includes("SlidePresentation"),
          ).length,
      ),
    ).toBe(0);
    // print() is called once, after a short delay
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __prints: number }).__prints), {
        timeout: 4000,
      })
      .toBe(1);
  });

  test("works for a plain deck too", async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {};
    });
    await page.goto(`/present.html?deck=${PLAIN}&print=1`);
    await expect(page.locator("section.slide").first()).toBeVisible();
    await expect(page.locator("#__se_letterbox")).toHaveCount(0);
    expect(
      await page.evaluate(() => document.querySelectorAll("section.slide:not(.visible)").length),
    ).toBe(0);
  });
});

test.describe("relative URLs in a stored frame_html", () => {
  // A deck that loads root-relative files the way stored decks do.
  const addRelativeDeck = (page: import("@playwright/test").Page) =>
    page.addInitScript((id) => {
      const db = JSON.parse(localStorage.getItem("__fakedb") || "{}");
      if ((db.decks ?? []).some((d: { deck_id: string }) => d.deck_id === id)) return;
      const src = db.decks.find((d: { deck_id: string }) => d.deck_id === "plain-deck");
      const probe =
        "<script>window.__rel={};" +
        "fetch('./sync.js').then(r=>window.__rel.sync=r.status);" +
        "fetch('./css/theme.css').then(r=>window.__rel.theme=r.status);" +
        "fetch('./js/deck-host.js').then(r=>window.__rel.host=r.status);</script>";
      db.decks.push({
        ...src,
        deck_id: id,
        title: "Relative deck",
        share_token: null,
        frame_html: src.frame_html.replace(/<\/body>/i, `${probe}</body>`),
      });
      db.slides.push(
        ...db.slides
          .filter((s: { deck_id: string }) => s.deck_id === "plain-deck")
          .map((s: object) => ({ ...s, deck_id: id })),
      );
      localStorage.setItem("__fakedb", JSON.stringify(db));
    }, REL);

  test("./sync.js, ./css/ and ./js/ resolve from the site root", async ({ page }) => {
    await addRelativeDeck(page);
    await page.goto(`/present.html?deck=${REL}`);
    const frame = await deckFrame(page);
    await expect
      .poll(() =>
        frame.evaluate(() => (window as unknown as { __rel?: Record<string, number> }).__rel),
      )
      .toEqual({ sync: 200, theme: 200, host: 200 });
    expect((await slideState(frame)).mode).toBe("speakeasy");
  });
});

test.describe("view.html with only a share token", () => {
  test.use({ authed: false });

  test("opens without the passphrase and steps with the keys", async ({ page }) => {
    await page.goto(`/view.html?deck=${DECK}&token=${TOKEN}`);
    const frame = await deckFrame(page);
    expect(await slideState(frame)).toMatchObject({ mode: "deck", index: 0, title: "Opening" });
    await press(page, "ArrowRight");
    expect(await slideState(frame)).toMatchObject({ index: 1, title: "Saved state" });
    await press(page, "End");
    expect(await slideState(frame)).toMatchObject({ index: 5, title: "Closing" });
    // a viewer has no presenter panel
    await expect(page.locator("#__se_panel")).toHaveCount(0);
    await expect(page.locator("#__se_presenter")).toHaveCount(0);
  });

  test("a plain deck opens in speakeasy mode", async ({ page }) => {
    // share the plain deck through the fake DB first
    await page.addInitScript(() => {
      const db = JSON.parse(localStorage.getItem("__fakedb") || "{}");
      const d = db.decks.find((x: { deck_id: string }) => x.deck_id === "plain-deck");
      if (d && !d.share_token) {
        d.share_token = "ptok";
        localStorage.setItem("__fakedb", JSON.stringify(db));
      }
    });
    await page.goto(`/view.html?deck=${PLAIN}&token=ptok`);
    const frame = await deckFrame(page);
    expect((await slideState(frame)).mode).toBe("speakeasy");
  });
});
