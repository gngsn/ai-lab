// The slide fit (src/lib/slide-fit.ts): a slide iframe is kept at 1280x720 and scaled and centred
// inside its box. Used by the editor canvas and the pronunciation preview.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/app";
import { DECK } from "../support/seed";

type Fit = { stage: { w: number; h: number }; style: Record<string, string> };
const PROPS = [
  "position",
  "left",
  "top",
  "width",
  "height",
  "maxWidth",
  "maxHeight",
  "transformOrigin",
  "transform",
] as const;

const read = (frame: Locator, stage: Locator): Promise<Fit> =>
  Promise.all([
    stage.evaluate((el) => ({ w: el.clientWidth, h: el.clientHeight })),
    frame.evaluate(
      (el, props) => {
        const style = (el as HTMLElement).style as unknown as Record<string, string>;
        return Object.fromEntries(props.map((p) => [p, style[p]]));
      },
      PROPS as unknown as string[],
    ),
  ]).then(([box, style]) => ({ stage: box, style }));

const expectFitted = (fit: Fit) => {
  const { w, h } = fit.stage;
  const scale = Math.min(w / 1280, h / 720);
  expect(fit.style.position).toBe("absolute");
  expect(fit.style.width).toBe("1280px");
  expect(fit.style.height).toBe("720px");
  expect(fit.style.maxWidth).toBe("none");
  expect(fit.style.maxHeight).toBe("none");
  expect(fit.style.transformOrigin).toBe("0px 0px");
  expect(Number.parseFloat(fit.style.left as string)).toBeCloseTo((w - 1280 * scale) / 2, 1);
  expect(Number.parseFloat(fit.style.top as string)).toBeCloseTo((h - 720 * scale) / 2, 1);
  expect(Number.parseFloat((fit.style.transform as string).replace("scale(", ""))).toBeCloseTo(
    scale,
    3,
  );
};

const openEditor = async (page: Page) => {
  await page.goto(`/edit.html?deck=${DECK}`);
  await expect(page.locator("#slide-list-items .slide-item")).toHaveCount(6);
  await expect(page.locator("#status")).toHaveText(/^ready · /);
};

test.describe("editor canvas", () => {
  const frame = (page: Page) => page.locator("#canvas");
  const stage = (page: Page) => page.locator("#canvas-stage");

  test("is 1280x720, scaled and centred to its stage", async ({ page }) => {
    await openEditor(page);
    await expect
      .poll(async () => (await read(frame(page), stage(page))).style.transform)
      .toMatch(/^scale\(/);
    expectFitted(await read(frame(page), stage(page)));
  });

  test("follows the stage when the window is resized", async ({ page }) => {
    await openEditor(page);
    await page.setViewportSize({ width: 1500, height: 900 });
    await expect
      .poll(async () => (await read(frame(page), stage(page))).stage.w)
      .toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const fit = await read(frame(page), stage(page));
        return Number.parseFloat(fit.style.transform?.replace("scale(", "") ?? "0");
      })
      .toBeGreaterThan(0);
    const wide = await read(frame(page), stage(page));
    expectFitted(wide);
    await page.setViewportSize({ width: 1000, height: 700 });
    await expect
      .poll(async () => (await read(frame(page), stage(page))).stage.w)
      .not.toBe(wide.stage.w);
    // let the observer apply the new size
    await expect
      .poll(async () => {
        const fit = await read(frame(page), stage(page));
        const scale = Math.min(fit.stage.w / 1280, fit.stage.h / 720);
        return (
          Math.abs(Number.parseFloat(fit.style.transform?.replace("scale(", "") ?? "0") - scale) <
          0.001
        );
      })
      .toBe(true);
    expectFitted(await read(frame(page), stage(page)));
  });

  test("stretch clears every property, and a preset puts them back", async ({ page }) => {
    await openEditor(page);
    await expect
      .poll(async () => (await read(frame(page), stage(page))).style.transform)
      .toMatch(/^scale\(/);
    await page.locator("#mode-select").selectOption("stretch");
    await expect
      .poll(async () => Object.values((await read(frame(page), stage(page))).style).join(""))
      .toBe("");
    await page.locator("#mode-select").selectOption("aspect-169");
    await expect
      .poll(async () => (await read(frame(page), stage(page))).style.transform)
      .toMatch(/^scale\(/);
    expectFitted(await read(frame(page), stage(page)));
  });
});

test("the pronunciation preview is fitted the same way", async ({ page }) => {
  await page.goto(`/pronunciation.html?deck=${DECK}`);
  await expect(page.locator("#training-panel")).toBeAttached();
  const frame = page.locator("#slide-stage iframe");
  const stage = page.locator("#slide-stage");
  await expect.poll(async () => (await read(frame, stage)).style.transform).toMatch(/^scale\(/);
  expectFitted(await read(frame, stage));
});
