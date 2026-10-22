// P6-4: the deck runtime inside the deck document (Speakeasy's own
// slide-runtime and deck-host, loaded from ./js/deck-host.js). The older specs
// pin stepping through fragments and the host modes; these add what they leave
// open: the stepper, the slidechange event, key repeat, the wheel, Home / End,
// the header / footer chrome, the layout fallback style and applying a step
// state. They pass on the legacy files first and must keep passing on the port.
import type { Frame, Page } from "@playwright/test";
import { deckFrame, expect, press, slideState, test } from "../support/app";

const RT = "runtime-deck";

const SLIDES = [
  `<section data-title="One" data-hl="Left 1" data-hr="Right 1" data-page="1/5"><h1 class="reveal">One</h1></section>`,
  `<section data-title="Cards" data-stepper=".card"><h1 class="reveal">Cards</h1>
     <div class="card" id="c0"><span class="item">a</span></div>
     <div class="card" id="c1"><span class="item">b</span></div>
     <div class="card" id="c2"><span class="item">c</span></div></section>`,
  `<section class="slide" data-title="Custom" data-stepper=".pick" data-stepper-active-class="on"><h1>Custom</h1>
     <p class="pick" id="p0">x</p><p class="pick" id="p1">y</p></section>`,
  `<section data-title="Groups"><h1>Groups</h1>
     <p class="fragment" id="f0">solo</p>
     <p class="fragment" data-fragment-group="g" id="f1">g1</p>
     <p class="fragment" data-fragment-group="g" id="f2">g2</p></section>`,
  `<section data-title="Last" data-page="5/5"><h1>Last</h1></section>`,
];

async function addRuntimeDeck(page: Page) {
  await page.addInitScript(
    ({ id, slides }) => {
      const db = JSON.parse(localStorage.getItem("__fakedb") || "{}");
      if ((db.decks ?? []).some((d: { deck_id: string }) => d.deck_id === id)) return;
      const src = db.decks.find((d: { deck_id: string }) => d.deck_id === "plain-deck");
      db.decks.push({ ...src, deck_id: id, title: "Runtime deck", share_token: "tok" });
      slides.forEach((content: string, i: number) => {
        db.slides.push({
          deck_id: id,
          section_id: `rt-${i + 1}`,
          order: i + 1,
          title: `s${i + 1}`,
          content,
          updated_at: src.updated_at,
        });
      });
      localStorage.setItem("__fakedb", JSON.stringify(db));
    },
    { id: RT, slides: SLIDES },
  );
}

const open = async (page: Page, query = "") => {
  await addRuntimeDeck(page);
  await page.goto(`/present.html?deck=${RT}${query}`);
  return deckFrame(page);
};

/** Record every slidechange detail the deck document fires. */
const recordEvents = (frame: Frame) =>
  frame.evaluate(() => {
    const w = window as unknown as { __ev: unknown[] };
    w.__ev = [];
    document.addEventListener("slidechange", (e) => w.__ev.push((e as CustomEvent).detail));
  });
const events = (frame: Frame) =>
  frame.evaluate(() => (window as unknown as { __ev: unknown[] }).__ev);

const active = (frame: Frame, cls: string) =>
  frame.evaluate(
    (c) => [...document.querySelectorAll(`.${c}`)].map((el) => el.id || el.className),
    cls,
  );

test("header and footer are generated from data-hl / data-hr / data-page", async ({ page }) => {
  const frame = await open(page);
  const first = frame.locator('section[data-section-id="rt-1"]');
  await expect(first.locator(":scope > .slide-header.reveal")).toHaveAttribute(
    "data-se-generated",
    "slide-header",
  );
  expect(await first.locator(":scope > .slide-header").innerHTML()).toBe(
    '<div class="left"><span class="spike"></span>Left 1</div><div>Right 1</div>',
  );
  // the header is the first child; the footer is the last
  expect(await first.evaluate((s) => (s.firstElementChild as HTMLElement).className)).toBe(
    "slide-header reveal",
  );
  expect(await first.locator(":scope > .slide-footer .slide-page").textContent()).toBe("1 / 5");
  await expect(first.locator(":scope > .slide-footer")).toHaveAttribute(
    "data-se-generated",
    "slide-footer",
  );
  // a slide with only data-page has a footer and no header; one with neither has neither
  const last = frame.locator('section[data-section-id="rt-5"]');
  await expect(last.locator(":scope > .slide-header")).toHaveCount(0);
  await expect(last.locator(":scope > .slide-footer")).toHaveCount(1);
  await expect(
    frame.locator(
      'section[data-section-id="rt-2"] > .slide-header, [data-section-id="rt-2"] > .slide-footer',
    ),
  ).toHaveCount(0);
});

test("the layout fallback style is switched on in speakeasy mode", async ({ page }) => {
  const frame = await open(page);
  await expect(frame.locator("#__se_fallback")).toHaveJSProperty("media", "all");
});

test("?nofallback=1 leaves no fallback style", async ({ page }) => {
  const frame = await open(page, "&nofallback=1");
  await expect(frame.locator("#__se_fallback")).toHaveCount(0);
});

test("the stepper walks its items before the slide changes, and back", async ({ page }) => {
  const frame = await open(page);
  await press(page, "ArrowRight"); // → Cards: first item active already
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 1, title: "Cards" });
  expect(await active(frame, "mint")).toEqual(["c0"]);
  await press(page, "ArrowRight");
  expect(await active(frame, "mint")).toEqual(["c1"]);
  await press(page, "ArrowRight");
  expect(await active(frame, "mint")).toEqual(["c2"]);
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 1 });
  await press(page, "ArrowRight"); // past the last item → next slide
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 2, title: "Custom" });
  // coming back to Cards starts it over at the first item (legacy behavior)
  await press(page, "ArrowLeft");
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 1 });
  expect(await active(frame, "mint")).toEqual(["c0"]);
  await press(page, "ArrowRight");
  expect(await active(frame, "mint")).toEqual(["c1"]);
  await press(page, "ArrowLeft");
  expect(await active(frame, "mint")).toEqual(["c0"]);
  await press(page, "ArrowLeft"); // before the first item → previous slide
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 0 });
});

test("the stepper marks the closest .card, and data-stepper-active-class names the class", async ({
  page,
}) => {
  const frame = await open(page);
  await press(page, "ArrowRight");
  // the item inside a .card is not marked itself, the card is
  expect(await frame.evaluate(() => document.querySelector(".item")?.className)).toBe("item");
  expect(await frame.evaluate(() => document.getElementById("c0")?.className)).toContain("mint");
  await press(page, "ArrowRight", 3); // → Custom
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 2 });
  expect(await active(frame, "on")).toEqual(["p0"]);
  // leaving a slide does not clear its marks (legacy behavior)
  expect(await active(frame, "mint")).toEqual(["c2"]);
  await press(page, "ArrowRight");
  expect(await active(frame, "on")).toEqual(["p1"]);
});

test("slidechange carries the slide, the shown fragments and the stepper index", async ({
  page,
}) => {
  const frame = await open(page);
  await recordEvents(frame);
  await press(page, "ArrowRight"); // → Cards
  await press(page, "ArrowRight"); // stepper 0 → 1
  expect(await events(frame)).toEqual([
    { index: 1, section_id: "rt-2", total: 5, fragments: [], stepper: 0 },
    { index: 1, section_id: "rt-2", total: 5, fragments: [], stepper: 1 },
  ]);
  await press(page, "ArrowRight", 2); // stepper 2, then → Custom
  await press(page, "ArrowRight", 2); // stepper 1, then → Groups
  await press(page, "ArrowRight"); // solo fragment (index 0)
  await press(page, "ArrowRight"); // the group (indexes 1 and 2)
  const last = (await events(frame)).slice(-2);
  expect(last).toEqual([
    { index: 3, section_id: "rt-4", total: 5, fragments: [0], stepper: -1 },
    { index: 3, section_id: "rt-4", total: 5, fragments: [0, 1, 2], stepper: -1 },
  ]);
});

test("a fragment group appears and disappears together", async ({ page }) => {
  const frame = await open(page);
  // Cards (1), its other two items (2), Custom (1), its second item (1), Groups (1)
  await press(page, "ArrowRight", 6);
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 3, title: "Groups" });
  await press(page, "ArrowRight");
  expect(
    await frame.evaluate(() => [...document.querySelectorAll(".fragment.show")].map((e) => e.id)),
  ).toEqual(["f0"]);
  await press(page, "ArrowRight");
  expect(
    await frame.evaluate(() => [...document.querySelectorAll(".fragment.show")].map((e) => e.id)),
  ).toEqual(["f0", "f1", "f2"]);
  await press(page, "ArrowLeft");
  expect(
    await frame.evaluate(() => [...document.querySelectorAll(".fragment.show")].map((e) => e.id)),
  ).toEqual(["f0"]);
  await press(page, "ArrowLeft");
  expect(await frame.evaluate(() => document.querySelectorAll(".fragment.show").length)).toBe(0);
});

test("Home and End jump, PageDown / Space / PageUp step", async ({ page }) => {
  const frame = await open(page);
  await press(page, "End");
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 4, title: "Last" });
  await press(page, "Home");
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 0 });
  await press(page, "PageDown");
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 1 });
  await press(page, " ");
  expect(await active(frame, "mint")).toEqual(["c1"]);
  await press(page, "PageUp");
  expect(await active(frame, "mint")).toEqual(["c0"]);
  await press(page, "ArrowDown");
  expect(await active(frame, "mint")).toEqual(["c1"]);
  await press(page, "ArrowUp");
  expect(await active(frame, "mint")).toEqual(["c0"]);
});

test("the first slide cannot be left backwards and the last cannot be passed", async ({ page }) => {
  const frame = await open(page);
  await press(page, "ArrowLeft");
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 0 });
  await press(page, "End");
  await press(page, "ArrowRight");
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 4 });
});

test("key autorepeat is ignored", async ({ page }) => {
  const frame = await open(page);
  await recordEvents(frame);
  await frame.evaluate(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        repeat: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await page.waitForTimeout(300);
  expect(await events(frame)).toEqual([]);
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 0 });
});

test("keys typed into editable content do not navigate", async ({ page }) => {
  const frame = await open(page);
  await frame.evaluate(() => {
    const el = document.createElement("div");
    el.id = "ce";
    el.setAttribute("contenteditable", "true");
    document.body.append(el);
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
    );
  });
  await page.waitForTimeout(300);
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 0 });
});

test("one wheel gesture is one step; small deltas and its inertia are ignored", async ({
  page,
}) => {
  const frame = await open(page);
  const wheel = (deltaY: number) =>
    frame.evaluate((dy) => {
      document.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, bubbles: true }));
    }, deltaY);
  await wheel(10); // below the threshold
  await page.waitForTimeout(100);
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 0 });
  await wheel(120);
  await wheel(120); // same gesture
  await wheel(120);
  await page.waitForTimeout(900);
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 1 });
  expect(await active(frame, "mint")).toEqual(["c0"]);
  await wheel(-120); // a new gesture, after the lock released
  await page.waitForTimeout(900);
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 0 });
});

test("touch: a swipe of more than 50px steps, a short one does not", async ({ page }) => {
  const frame = await open(page);
  const swipe = (dy: number) =>
    frame.evaluate((d) => {
      const mk = (type: string, y: number) =>
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches:
            type === "touchend"
              ? []
              : [new Touch({ identifier: 1, target: document.body, clientY: y })],
          changedTouches: [new Touch({ identifier: 1, target: document.body, clientY: y })],
        });
      document.dispatchEvent(mk("touchstart", 300));
      document.dispatchEvent(mk("touchend", 300 + d));
    }, dy);
  await swipe(-30);
  await page.waitForTimeout(200);
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 0 });
  await swipe(-80); // up: next
  await page.waitForTimeout(900);
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 1 });
  await swipe(80); // down: previous
  await page.waitForTimeout(900);
  await expect.poll(() => slideState(frame)).toMatchObject({ index: 0 });
});

test("the runtime announces slide 0 right away and marks it visible", async ({ page }) => {
  const frame = await open(page);
  await expect(frame.locator('section[data-section-id="rt-1"]')).toHaveClass(/\bvisible\b/);
  // the counter (presenter overlay) shows the first slide
  await expect(frame.locator("#__se_counter")).toHaveText("1 / 5");
});

test("a deck with its own controller is hosted without Speakeasy's layout", async ({ page }) => {
  await page.goto("/present.html?deck=controller-deck");
  const frame = await deckFrame(page);
  await expect(frame.locator("#__se_fallback")).toHaveJSProperty("media", "not all");
  await expect(frame.locator(".slide-header[data-se-generated]")).toHaveCount(0);
  expect(
    await frame.evaluate(
      () => typeof (window as unknown as { __seDeckController?: unknown }).__seDeckController,
    ),
  ).toBe("object");
});
