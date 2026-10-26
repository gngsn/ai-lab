// P6-6: the presenter page (present). The older specs pin stepping (p0-3/4/5),
// the panel's follow / hide / font (p0-11), captions to the audience (p0-12),
// the auth gate (p0-1), print mode and the letterbox geometry (p6-0). These add
// what they leave open: the overlay of a plain deck (counter, progress, dots,
// sync badge, audience link), the start slide (?section=), the error pages, the
// se:slide messages, the panel's width / font limits / timer, the caption
// button and its script file, and the narrow layout. They pass on the legacy
// page first and must keep passing on the port.
import type { BrowserContext, Page } from "@playwright/test";
import { deckFrame, expect, press, slideState, test } from "../support/app";
import { BILINGUAL, DECK, PLAIN } from "../support/seed";

const HID = "hidden-deck";
const NOFRAME = "noframe-deck";
const NOVISIBLE = "novisible-deck";

/** Decks the seed does not have, built from the plain deck. */
const addDecks = (page: Page) =>
  page.addInitScript(
    ({ hid, noframe, novisible }) => {
      const db = JSON.parse(localStorage.getItem("__fakedb") || "{}");
      const ids = db.decks.map((d: { deck_id: string }) => d.deck_id);
      const plain = db.decks.find((d: { deck_id: string }) => d.deck_id === "plain-deck");
      plain.share_token = "ptok";
      const plainSlides = db.slides.filter((s: { deck_id: string }) => s.deck_id === "plain-deck");
      if (!ids.includes(hid)) {
        db.decks.push({ ...plain, deck_id: hid, title: "Hidden deck" });
        db.slides.push(
          ...plainSlides.map((s: { content: string }, i: number) => ({
            ...s,
            deck_id: hid,
            section_id: `h-${i + 1}`,
            content:
              i === 1 ? s.content.replace("<section", '<section data-hidden="true"') : s.content,
          })),
        );
      }
      if (!ids.includes(noframe)) {
        db.decks.push({ ...plain, deck_id: noframe, title: "No frame", frame_html: "" });
      }
      if (!ids.includes(novisible)) {
        db.decks.push({ ...plain, deck_id: novisible, title: "No visible" });
        db.slides.push(
          ...plainSlides.slice(0, 1).map((s: { content: string }) => ({
            ...s,
            deck_id: novisible,
            section_id: "nv-1",
            content: s.content.replace("<section", '<section data-hidden="true"'),
          })),
        );
      }
      localStorage.setItem("__fakedb", JSON.stringify(db));
    },
    { hid: HID, noframe: NOFRAME, novisible: NOVISIBLE },
  );

const open = async (page: Page, deck: string, query = "") => {
  await addDecks(page);
  await page.goto(`/present.html?deck=${deck}${query}`);
  return deckFrame(page);
};

const body = (page: Page) => page.frameLocator("#__se_letterbox").locator("body");

test.describe("error pages", () => {
  test("a missing deck id", async ({ page }) => {
    await page.goto("/present.html");
    await expect(body(page)).toContainText("Missing ?deck=<deck_id> in URL.");
    await expect(page.frameLocator("#__se_letterbox").locator("body > pre")).toHaveCount(1);
  });

  test("an unknown deck", async ({ page }) => {
    await page.goto("/present.html?deck=nope");
    await expect(body(page)).toContainText("Failed to load deck 'nope':");
  });

  test("a deck without frame_html", async ({ page }) => {
    await addDecks(page);
    await page.goto(`/present.html?deck=${NOFRAME}`);
    await expect(body(page)).toContainText(`Deck '${NOFRAME}' has no frame_html.`);
  });

  test("a deck with only hidden slides", async ({ page }) => {
    await addDecks(page);
    await page.goto(`/present.html?deck=${NOVISIBLE}`);
    await expect(body(page)).toContainText(`Deck '${NOVISIBLE}' has no visible slides.`);
  });
});

test.describe("the overlay of a plain deck", () => {
  test("counter, progress bar and the slide dots follow the slide", async ({ page }) => {
    const frame = await open(page, PLAIN);
    await expect(frame.locator("#__se_counter")).toHaveText("1 / 4");
    await expect(frame.locator("#__se_progress")).toHaveCSS("width", "320px"); // 25% of 1280
    const dots = frame.locator("#__se_navdots button");
    await expect(dots).toHaveCount(4);
    await expect(dots.nth(0)).toHaveAttribute("aria-label", "Slide 1: Plain one");
    await expect(dots.nth(0)).toHaveAttribute("title", "Plain one");
    await expect(dots.nth(0)).toHaveClass(/\bactive\b/);
    await expect(dots.nth(0)).toHaveAttribute("aria-current", "true");
    await expect(dots.nth(1)).toHaveAttribute("aria-current", "false");
    await press(page, "ArrowRight");
    await expect(frame.locator("#__se_counter")).toHaveText("2 / 4");
    await expect(frame.locator("#__se_progress")).toHaveCSS("width", "640px");
    await expect(dots.nth(1)).toHaveClass(/\bactive\b/);
    await expect(dots.nth(0)).not.toHaveClass(/\bactive\b/);
  });

  test("the dots show when the pointer is in the right part, and jump on click", async ({
    page,
  }) => {
    const frame = await open(page, PLAIN);
    const nav = frame.locator("#__se_navdots");
    await expect(nav).toHaveCSS("opacity", "0");
    await expect(nav).toHaveCSS("pointer-events", "none");
    await frame.locator("body").evaluate(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 1100, bubbles: true }));
    });
    await expect(nav).toHaveCSS("opacity", "1");
    await expect(nav).toHaveCSS("pointer-events", "auto");
    // in the middle (between 30% and 62% of the width) it stays away
    await frame.locator("body").evaluate(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 500, bubbles: true }));
    });
    await expect(nav).toHaveCSS("opacity", "0");
    await frame.locator("body").evaluate(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 1100, bubbles: true }));
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 200, bubbles: true }));
    });
    await expect(nav).toHaveCSS("opacity", "0");
    await frame
      .locator("#__se_navdots button")
      .nth(2)
      .evaluate((b) => (b as HTMLButtonElement).click());
    await expect(frame.locator("#__se_counter")).toHaveText("3 / 4");
    await expect.poll(() => slideState(frame)).toMatchObject({ index: 2 });
  });

  test("the sync badge shows the room; no badge without one", async ({ page }) => {
    const frame = await open(page, PLAIN, "&sync=room9");
    await expect(frame.locator("#__se_sync")).toBeVisible();
    await expect(frame.locator("#__se_sync")).toHaveText("● sync: room9");
  });

  test("no sync room, no badge", async ({ page }) => {
    const frame = await open(page, PLAIN);
    await expect(frame.locator("#__se_sync")).toBeHidden();
    await expect(frame.locator("#__se_audience")).toBeHidden();
  });

  test("the audience link needs a share token and a room, and copies the share URL", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    // sharing on for the plain deck, through the editor's own way: the DB
    await page.addInitScript(() => {
      const db = JSON.parse(localStorage.getItem("__fakedb") || "{}");
      db.decks.find((d: { deck_id: string }) => d.deck_id === "plain-deck").share_token = "ptok";
      localStorage.setItem("__fakedb", JSON.stringify(db));
    });
    await page.goto(`/present.html?deck=${PLAIN}&sync=room9`);
    const frame = await deckFrame(page);
    const link = frame.locator("#__se_audience");
    await expect(link).toBeVisible();
    await expect(link).toHaveText("🔗 copy audience link");
    await expect(link).toHaveAttribute(
      "title",
      "Copy a link your audience can open to follow along live",
    );
    await link.click();
    await expect(link).toHaveText("✓ audience link copied");
    const origin = new URL(page.url()).origin;
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `${origin}/share.html?deck=${PLAIN}&token=ptok&sync=room9`,
    );
    await expect(link).toHaveText("🔗 copy audience link", { timeout: 4000 });
  });

  test("clicking the badge copies the room name", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const frame = await open(page, PLAIN, "&sync=room9");
    await frame.locator("#__se_sync").click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("room9");
  });

  test("a deck with its own controller has no overlay, no dots and no help", async ({ page }) => {
    const frame = await open(page, DECK);
    await expect(frame.locator("#__se_overlay")).toHaveJSProperty("hidden", true);
    await expect(frame.locator("#__se_navdots button")).toHaveCount(0);
    await page.keyboard.press("Shift+?");
    await page.waitForTimeout(300);
    await expect(frame.locator("#__se_shortcuts_modal")).toHaveCount(0);
  });

  test("? opens the keyboard help titled Present", async ({ page }) => {
    await open(page, PLAIN);
    await page.keyboard.press("Shift+?");
    const modal = page.frameLocator("#__se_letterbox").locator("#__se_shortcuts_modal");
    await expect(modal).toContainText("Present");
    await expect(modal).toContainText("Jump to first slide");
    await expect(modal).toContainText("Jump to last slide");
  });
});

test.describe("the start slide", () => {
  const sectionIds = (page: Page, deck: string) =>
    page.evaluate((d) => {
      const db = JSON.parse(localStorage.getItem("__fakedb") || "{}");
      return db.slides
        .filter((s: { deck_id: string }) => s.deck_id === d)
        .sort((a: { order: number }, b: { order: number }) => a.order - b.order)
        .map((s: { section_id: string }) => s.section_id);
    }, deck);

  test("?section= opens that slide, ?slide= is the same", async ({ page }) => {
    await addDecks(page);
    await page.goto("/index.html");
    const ids = await sectionIds(page, DECK);
    await page.goto(`/present.html?deck=${DECK}&section=${ids[2]}`);
    let frame = await deckFrame(page);
    await expect.poll(() => slideState(frame)).toMatchObject({ mode: "deck", index: 2 });
    await expect(page.locator("#__se_panel .pp-count")).toHaveText("3 / 6");
    await page.goto(`/present.html?deck=${DECK}&slide=${ids[4]}`);
    frame = await deckFrame(page);
    await expect.poll(() => slideState(frame)).toMatchObject({ index: 4 });
  });

  test("an unknown section opens the first slide", async ({ page }) => {
    const frame = await open(page, DECK, "&section=nope");
    await expect.poll(() => slideState(frame)).toMatchObject({ index: 0 });
  });

  test("a hidden section opens the next visible slide", async ({ page }) => {
    const frame = await open(page, HID, "&section=h-2");
    await expect.poll(() => slideState(frame)).toMatchObject({ index: 1 });
    await expect(frame.locator("#__se_counter")).toHaveText("2 / 3");
  });

  test("a hidden last section opens the last visible slide", async ({ page }) => {
    await addDecks(page);
    await page.addInitScript(() => {
      const db = JSON.parse(localStorage.getItem("__fakedb") || "{}");
      const last = db.slides.find(
        (s: { deck_id: string; section_id: string }) =>
          s.deck_id === "hidden-deck" && s.section_id === "h-4",
      );
      if (last) last.content = last.content.replace("<section", '<section data-hidden="true"');
      localStorage.setItem("__fakedb", JSON.stringify(db));
    });
    await page.goto(`/present.html?deck=${HID}&section=h-4`);
    const frame = await deckFrame(page);
    await expect(frame.locator("#__se_counter")).toHaveText("2 / 2");
  });
});

test.describe("what the page tells its panel", () => {
  test("se:slide messages carry the slide and its steps, once at start and on every change", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { __msgs: unknown[] }).__msgs = [];
      window.addEventListener("message", (e) => {
        if (e.data?.type === "se:slide")
          (window as unknown as { __msgs: unknown[] }).__msgs.push(e.data);
      });
    });
    await open(page, PLAIN);
    await press(page, "ArrowRight");
    await press(page, "ArrowRight"); // Plain two: fragment reveal
    const msgs = (await page.evaluate(
      () => (window as unknown as { __msgs: Record<string, unknown>[] }).__msgs,
    )) as Record<string, unknown>[];
    expect(msgs.length).toBeGreaterThanOrEqual(3);
    expect(msgs[0]).toMatchObject({ type: "se:slide", index: 0, fragments: [], stepper: -1 });
    expect(typeof msgs[0].section_id).toBe("string");
    expect(msgs.at(-1)).toMatchObject({ index: 1, fragments: [0] });
  });
});

test.describe("the panel", () => {
  test("loads the deck title and the notes of the current slide", async ({ page }) => {
    await open(page, DECK);
    await expect(page.locator("#__se_panel")).toHaveAttribute("data-deck-title", /.+/);
    await expect(page.locator("#__se_panel .pp-script p").first()).toBeVisible();
  });

  test("the width can be dragged and is remembered, within 20–70%", async ({ page }) => {
    await open(page, DECK);
    const handle = page.locator(".pp-resize");
    const box = (await handle.boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 4, y);
    await page.mouse.down();
    await page.mouse.move(1280 * 0.6, y, { steps: 4 }); // panel = 40%
    await page.mouse.up();
    const saved = Number(
      await page.evaluate(() => localStorage.getItem("speakeasy:present:panel-width")),
    );
    expect(saved).toBeGreaterThan(38);
    expect(saved).toBeLessThan(42);
    // far to the right: clamped to 20%
    const box2 = (await handle.boundingBox())!;
    await page.mouse.move(box2.x + 4, box2.y + 50);
    await page.mouse.down();
    await page.mouse.move(1270, box2.y + 50, { steps: 4 });
    await page.mouse.up();
    expect(await page.evaluate(() => localStorage.getItem("speakeasy:present:panel-width"))).toBe(
      "20.0",
    );
    // far to the left: clamped to 70%
    const box3 = (await handle.boundingBox())!;
    await page.mouse.move(box3.x + 4, box3.y + 50);
    await page.mouse.down();
    await page.mouse.move(10, box3.y + 50, { steps: 4 });
    await page.mouse.up();
    expect(await page.evaluate(() => localStorage.getItem("speakeasy:present:panel-width"))).toBe(
      "70.0",
    );
    // a saved width is used on the next visit
    await page.reload();
    await deckFrame(page);
    const w = (await page.locator("#__se_panel").boundingBox())!.width;
    expect(w).toBeCloseTo(1280 * 0.7, -1);
  });

  test("text size steps by 1.5px between 11 and 30", async ({ page }) => {
    await open(page, DECK);
    const size = () =>
      page.locator("#__se_panel").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(await size()).toBe(15);
    await page.locator('.pp-bar [data-font="1"]').click();
    expect(await size()).toBe(16.5);
    await page.locator('.pp-bar [data-font="-1"]').click();
    await page.locator('.pp-bar [data-font="-1"]').click();
    expect(await size()).toBe(13.5);
    for (let i = 0; i < 12; i++) await page.locator('.pp-bar [data-font="-1"]').click();
    expect(await size()).toBe(11);
    for (let i = 0; i < 20; i++) await page.locator('.pp-bar [data-font="1"]').click();
    expect(await size()).toBe(30);
    await page.reload();
    await deckFrame(page);
    expect(await size()).toBe(30);
  });

  test("the timer counts seconds and a click resets it", async ({ page }) => {
    await open(page, DECK);
    const timer = page.locator(".pp-timer");
    await expect(timer).toHaveText(/^0:0[0-9]$/);
    await page.waitForTimeout(2200);
    await expect(timer).toHaveText(/^0:0[2-9]$/);
    await timer.click();
    await expect(timer).toHaveText("0:00");
    await expect(timer).toHaveAttribute("title", "Elapsed — click to reset");
  });

  test("the script is formatted: paragraphs, bold, code, cues and memos", async ({ page }) => {
    await page.addInitScript(() => {
      const db = JSON.parse(localStorage.getItem("__fakedb") || "{}");
      const first = db.slides.find((s: { deck_id: string }) => s.deck_id === "controller-deck");
      const note = db.notes.find(
        (n: { deck_id: string; section_id: string }) =>
          n.deck_id === "controller-deck" && n.section_id === first.section_id,
      );
      note.content =
        "첫 줄 **굵게** 와 `코드` <b>태그</b>\n(클릭)\n/* 메모 */\n\n둘째 문단\n(click — 또 하나)";
      localStorage.setItem("__fakedb", JSON.stringify(db));
    });
    await page.goto(`/present.html?deck=${DECK}`);
    await deckFrame(page);
    const script = page.locator("#__se_panel .pp-script");
    await expect(script.locator("p")).toHaveCount(2);
    expect(await script.locator("p").first().innerHTML()).toBe(
      '첫 줄 <strong>굵게</strong> 와 <code>코드</code> &lt;b&gt;태그&lt;/b&gt;<br><span class="cue next" data-cue="0">(클릭)</span><br><span class="memo">/* 메모 */</span>',
    );
    await expect(script.locator(".cue[data-cue]")).toHaveCount(2);
    await expect(script.locator('.cue[data-cue="1"]')).toHaveText("(click — 또 하나)");
  });

  test("a slide without notes says so", async ({ page }) => {
    await open(page, PLAIN);
    await expect(page.locator("#__se_panel .pp-script .pp-empty")).toHaveText(
      "No script for this slide.",
    );
    await expect(page.locator(".pp-next")).toContainText("Next · Plain two");
  });

  test("on a narrow screen the panel goes under the slide", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await open(page, DECK);
    const stage = (await page.locator("#__se_stage").boundingBox())!;
    const panel = (await page.locator("#__se_panel").boundingBox())!;
    expect(stage.width).toBeCloseTo(600, 0);
    expect(stage.height).toBeCloseTo(405, 0);
    expect(panel.y).toBeGreaterThan(stage.y + stage.height - 2);
  });
});

test.describe("the caption button in the panel", () => {
  test("without a script it asks for one", async ({ page }) => {
    await open(page, DECK);
    const cc = page.locator(".pp-cc");
    await expect(cc).toBeVisible();
    await expect(cc).toHaveText("CC");
    await expect(cc).toHaveAttribute("data-state", "none");
    await expect(cc).toHaveAttribute("title", "Live captions: load a bilingual script (.md)");
    await expect(page.locator(".pp-caption")).toBeHidden();
  });

  test("a script file loaded through the button is reported and saved", async ({ page }) => {
    await open(page, DECK);
    const chooser = page.waitForEvent("filechooser");
    await page.locator(".pp-cc").click();
    (await chooser).setFiles({
      name: "script.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(BILINGUAL),
    });
    await expect(page.locator(".pp-caption")).toBeVisible();
    await expect(page.locator(".pp-cap-meta")).toHaveText("Captions script: 10 lines on 6 slides");
    await expect(page.locator(".pp-cc")).toHaveAttribute("data-state", "ready");
    await expect(page.locator(".pp-cc")).toHaveAttribute(
      "title",
      "Start live captions (Shift-click: load another script)",
    );
    expect(
      await page.evaluate(
        (k) => localStorage.getItem(k)?.length ?? 0,
        `speakeasy:captions:script:${DECK}`,
      ),
    ).toBeGreaterThan(50);
  });

  test("Shift-click opens the file chooser again when not listening", async ({ page, context }) => {
    await context.addInitScript(({ md, key }) => localStorage.setItem(key, md), {
      md: BILINGUAL,
      key: `speakeasy:captions:script:${DECK}`,
    });
    await open(page, DECK);
    await expect(page.locator(".pp-cc")).toHaveAttribute("data-state", "ready");
    const chooser = page.waitForEvent("filechooser");
    await page.locator(".pp-cc").click({ modifiers: ["Shift"] });
    await chooser;
  });

  test("a sent line is shown in the strip, marked when machine-translated", async ({
    page,
    context,
  }) => {
    await context.addInitScript(({ md, key }) => localStorage.setItem(key, md), {
      md: BILINGUAL,
      key: `speakeasy:captions:script:${DECK}`,
    });
    await open(page, DECK, "&sync=pc1");
    await press(page, "ArrowRight", 3);
    await expect(page.locator("#__se_panel .pp-title")).toHaveText("Two steps");
    await page.evaluate(() =>
      (
        window as unknown as { __seCaptions: { feed(t: string, f: boolean): void } }
      ).__seCaptions.feed("두단계로나뉜슬라이드입니다", true),
    );
    await expect(page.locator(".pp-cap-en")).toHaveText("This slide is split into two steps.");
    await expect(page.locator(".pp-cap-en")).not.toHaveClass(/\bmt\b/);
    await expect(page.locator(".pp-cap-meta")).toHaveText(/^CC · line \d+ · \d\.\d\d$/);
  });
});

test.describe("print mode and the deck's own scripts", () => {
  const withScript = (page: Page) =>
    page.addInitScript(() => {
      const db = JSON.parse(localStorage.getItem("__fakedb") || "{}");
      const d = db.decks.find((x: { deck_id: string }) => x.deck_id === "plain-deck");
      if (d.frame_html.includes('id="probe"')) return; // the script runs in every document
      d.frame_html = d.frame_html.replace(
        /<\/body>/i,
        '<script>window.__deckScript = 1;</script><div id="probe" onclick="window.__clicked = 1">x</div></body>',
      );
      localStorage.setItem("__fakedb", JSON.stringify(db));
    });

  test("the deck's own scripts and handlers run as written when presenting", async ({ page }) => {
    await withScript(page);
    await page.goto(`/present.html?deck=${PLAIN}`);
    const frame = await deckFrame(page);
    expect(
      await frame.evaluate(() => (window as unknown as { __deckScript?: number }).__deckScript),
    ).toBe(1);
    await expect(frame.locator("#probe")).toHaveAttribute("onclick", /__clicked/);
  });

  test("print mode strips them", async ({ page }) => {
    await withScript(page);
    await page.addInitScript(() => {
      window.print = () => {};
    });
    await page.goto(`/present.html?deck=${PLAIN}&print=1`);
    await expect(page.locator("[data-section-id]").first()).toBeAttached();
    expect(
      await page.evaluate(() => (window as unknown as { __deckScript?: number }).__deckScript),
    ).toBeUndefined();
    await expect(page.locator("#probe")).not.toHaveAttribute("onclick", /.*/);
  });
});

test.describe("live captions with a microphone", () => {
  test("Shift-click while listening stops instead of loading another script", async ({
    page,
    context,
  }) => {
    await context.addInitScript(({ md, key }) => localStorage.setItem(key, md), {
      md: BILINGUAL,
      key: `speakeasy:captions:script:${DECK}`,
    });
    await page.addInitScript(() => {
      class FakeRecognition {
        lang = "";
        continuous = false;
        interimResults = false;
        onresult: unknown = null;
        onerror: unknown = null;
        onend: (() => void) | null = null;
        start() {}
        stop() {
          this.onend?.();
        }
      }
      Object.assign(window, {
        webkitSpeechRecognition: FakeRecognition,
        SpeechRecognition: FakeRecognition,
      });
    });
    await open(page, DECK);
    const cc = page.locator(".pp-cc");
    await expect(cc).toHaveAttribute("data-state", "ready");
    await cc.click();
    await expect(cc).toHaveAttribute("data-state", "live");
    await expect(cc).toHaveText("● CC");
    await expect(cc).toHaveAttribute("title", "Stop live captions");
    await expect(page.locator(".pp-cap-meta")).toHaveText("Listening (ko-KR)…");
    let chooser = false;
    page.once("filechooser", () => {
      chooser = true;
    });
    await cc.click({ modifiers: ["Shift"] });
    await expect(cc).toHaveAttribute("data-state", "ready");
    await expect(cc).toHaveText("CC");
    await expect(page.locator(".pp-cap-meta")).toHaveText("Stopped");
    await page.waitForTimeout(300);
    expect(chooser).toBe(false);
  });
});

test.describe("messages to the owner", () => {
  test("a wrong key does not leak: print mode needs the owner too", async ({ page }) => {
    await page.goto(`/present.html?deck=${DECK}&print=1`);
    await expect(page.locator("[data-section-id]").first()).toBeAttached();
    // the plain document: no letterbox, no overlay
    await expect(page.locator("#__se_letterbox")).toHaveCount(0);
    await expect(page.locator("#__se_overlay")).toHaveCount(0);
  });
});
