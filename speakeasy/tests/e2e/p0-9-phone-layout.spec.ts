// P0-9: touch screens get < > step buttons (swiping does nothing) and a
// lighter rendering path (no sliding transition, only the current slide and
// its neighbours rendered) so iOS Safari doesn't run out of memory. Desktop
// gets neither.
import { deckFrame, expect, slideState, test } from "../support/app";
import { DECK, TOKEN } from "../support/seed";

const view = `/view.html?deck=${DECK}&token=${TOKEN}`;

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("< > buttons step one at a time; swiping does not", async ({ page }) => {
    await page.goto(view);
    const frame = await deckFrame(page);
    const nav = page.locator("#__se_stepnav");
    await expect(nav).toBeVisible();
    const [prev, next] = await nav.locator("button").all();

    expect(await slideState(frame)).toMatchObject({ index: 0 });
    await next.tap();
    await expect.poll(() => slideState(frame)).toMatchObject({ index: 1, shown: 0 });
    await next.tap(); // "Saved state" has one fragment to reveal first
    await expect.poll(() => slideState(frame)).toMatchObject({ index: 1, shown: 1 });
    await next.tap();
    await expect.poll(() => slideState(frame)).toMatchObject({ index: 2 });
    await prev.tap();
    await expect.poll(() => slideState(frame)).toMatchObject({ index: 1 });

    // a horizontal swipe across the slide changes nothing
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, x: number, y = 422) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y }],
      });
    await touch("touchStart", 330);
    for (const x of [270, 210, 150, 90, 60]) await touch("touchMove", x);
    await touch("touchEnd", 60);
    await page.waitForTimeout(600);
    expect(await slideState(frame)).toMatchObject({ index: 1 });
  });

  test("renders only the current slide and its neighbours, without sliding", async ({ page }) => {
    await page.goto(view);
    const frame = await deckFrame(page);

    await expect(frame.locator("#__se_phone")).toHaveCount(1);
    const near = () =>
      frame.evaluate(() => {
        const ctl = (window as unknown as { __seDeckController: { slides: HTMLElement[] } }).__seDeckController;
        return ctl.slides.flatMap((s, i) => (s.hasAttribute("data-se-near") ? [i] : []));
      });
    expect(await near()).toEqual([0, 1]);

    await page.locator("#__se_stepnav button").nth(1).tap(); // → slide 1
    await page.locator("#__se_stepnav button").nth(1).tap(); // fragment
    await page.locator("#__se_stepnav button").nth(1).tap(); // → slide 2
    await expect.poll(near).toEqual([1, 2, 3]);

    const transition = await frame.evaluate(
      () => getComputedStyle(document.querySelector("main")!).transitionDuration,
    );
    expect(transition).toBe("0s");
  });
});

test.describe("desktop", () => {
  test("has no step buttons and no lightened rendering", async ({ page }) => {
    await page.goto(view);
    const frame = await deckFrame(page);
    await expect(page.locator("#__se_stepnav")).toBeHidden();
    await expect(frame.locator("#__se_phone")).toHaveCount(0);
    expect(
      await frame.evaluate(() => getComputedStyle(document.querySelector("main")!).transitionDuration),
    ).toBe("0.6s");
  });
});
