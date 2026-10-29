// The "Insert SVG" dialog — shapes with colours and size, the custom SVG tab with its live preview,
// and insertion into the slide.
import type { Page } from "@playwright/test";
import { expect, test } from "../support/app";
import { DECK } from "../support/seed";

const path = "/edit.html";
test.describe(path, () => {
  const open = async (page: Page) => {
    await page.goto(`${path}?deck=${DECK}`);
    await expect(page.locator("#slide-list-items .slide-item")).toHaveCount(6);
    await expect(page.locator("#notes-textarea")).toHaveValue(/안녕하세요/);
    await expect(page.locator("#status")).toHaveText(/^ready · /);
  };
  const openSvg = async (page: Page) => {
    const more = page.locator("#more-dropdown");
    // (The menu closes by itself after a click: retry if it closes under us.)
    await expect(async () => {
      if ((await more.getAttribute("open")) === null) {
        await more.locator(":scope > summary").click({ timeout: 1000 });
      }
      await page.locator("#svg-btn").click({ timeout: 1000 });
    }).toPass();
    await expect(page.locator("#svg-modal-bg")).toHaveClass(/\bshow\b/);
  };
  const modal = (page: Page) => page.locator("#svg-modal-bg");

  test("shows the shape grid with the default colours", async ({ page }) => {
    await open(page);
    await openSvg(page);
    await expect(page.locator("#svg-shape-grid .svg-shape-btn")).toHaveCount(16);
    await expect(page.locator("#svg-shape-grid .svg-shape-btn").first()).toContainText("Rectangle");
    await expect(page.locator("#svg-fill")).toHaveValue("#5db8a6");
    await expect(page.locator("#svg-stroke")).toHaveValue("#ffffff");
    await expect(page.locator("#svg-stroke-w")).toHaveValue("0");
    await expect(page.locator("#svg-size")).toHaveValue("120");
    await expect(
      page.locator('[data-shape="rect"] rect[fill="#5db8a6"][stroke="#ffffff"]'),
    ).toHaveCount(1);
    await expect(page.locator("#svg-tab-custom")).toBeHidden();
  });

  test("changing a colour or the stroke width redraws the thumbnails", async ({ page }) => {
    await open(page);
    await openSvg(page);
    await page.locator("#svg-fill").fill("#ff0000");
    await expect(page.locator('[data-shape="circle"] circle')).toHaveAttribute("fill", "#ff0000");
    await page.locator("#svg-stroke").fill("#0000ff");
    await page.locator("#svg-stroke-w").fill("5");
    await expect(page.locator('[data-shape="circle"] circle')).toHaveAttribute("stroke", "#0000ff");
    await expect(page.locator('[data-shape="circle"] circle')).toHaveAttribute("stroke-width", "5");
  });

  test("clicking a shape inserts it into the slide and closes the dialog", async ({ page }) => {
    await open(page);
    await openSvg(page);
    await page.locator("#svg-fill").fill("#ff0000");
    await page.locator("#svg-size").fill("200");
    await page.locator('[data-shape="circle"]').click();
    await expect(modal(page)).not.toHaveClass(/\bshow\b/);
    await expect(page.locator("#toast")).toHaveText("SVG inserted");
    const inserted = page
      .frameLocator("#canvas")
      .locator('span[contenteditable="false"] svg[viewBox="0 0 100 100"]');
    await expect(inserted).toHaveCount(1);
    await expect(inserted).toHaveAttribute("width", "200");
    await expect(inserted).toHaveAttribute("height", "200");
    await expect(inserted.locator("circle")).toHaveAttribute("fill", "#ff0000");
  });

  test("the size is at least 20 px and defaults to 120 when empty", async ({ page }) => {
    await open(page);
    await openSvg(page);
    await page.locator("#svg-size").fill("5");
    await page.locator('[data-shape="rect"]').click();
    const inserted = page.frameLocator("#canvas").locator("span[contenteditable=false] svg");
    await expect(inserted).toHaveAttribute("width", "20");
    await openSvg(page);
    await page.locator("#svg-size").fill("");
    await page.locator('[data-shape="heart"]').click();
    await expect(inserted.last()).toHaveAttribute("width", "120");
  });

  test("custom SVG: sample, live preview, errors and insertion", async ({ page }) => {
    await open(page);
    await openSvg(page);
    await page.locator('[data-tab="custom"]').click();
    await expect(page.locator('[data-tab="custom"]')).toHaveClass(/\bactive\b/);
    await expect(page.locator("#svg-tab-shapes")).toBeHidden();
    await expect(page.locator("#svg-custom-code")).toBeFocused();
    await expect(page.locator("#svg-custom-code")).toHaveValue(/<svg xmlns/);
    await expect(page.locator("#svg-custom-status")).toHaveText("OK · 0 0 100 100");
    await expect(page.locator("#svg-custom-status")).toHaveAttribute("data-kind", "ok");
    await expect(page.locator("#svg-custom-preview svg")).toHaveCount(1);

    await page.locator("#svg-custom-code").fill("not svg at all");
    await expect(page.locator("#svg-custom-status")).toHaveText("SVG 문법이 올바르지 않습니다.");
    await expect(page.locator("#svg-custom-status")).toHaveAttribute("data-kind", "err");
    await expect(page.locator("#svg-custom-preview svg")).toHaveCount(0);
    await page.locator("#svg-custom-insert").click();
    await expect(page.locator("#toast")).toHaveText("SVG 문법이 올바르지 않습니다.");
    await expect(modal(page)).toHaveClass(/\bshow\b/); // stays open on an error

    await page.locator("#svg-custom-code").fill("<div></div>");
    await expect(page.locator("#svg-custom-status")).toHaveText(
      "루트 엘리먼트는 <svg> 여야 합니다.",
    );
    await page.locator("#svg-custom-code").fill("   ");
    await expect(page.locator("#svg-custom-status")).toHaveText("SVG 코드를 입력해주세요.");

    await page
      .locator("#svg-custom-code")
      .fill(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path id="mine" d="M0 0L10 10"/></svg>',
      );
    await expect(page.locator("#svg-custom-status")).toHaveText("OK · 0 0 10 10");
    await page.locator("#svg-custom-insert").click();
    await expect(modal(page)).not.toHaveClass(/\bshow\b/);
    await expect(page.locator("#toast")).toHaveText("SVG inserted");
    await expect(
      page.frameLocator("#canvas").locator("span[contenteditable=false] svg #mine"),
    ).toHaveCount(1);
  });

  test("the dialog remembers its tab, colours and source between openings", async ({ page }) => {
    await open(page);
    await openSvg(page);
    await page.locator("#svg-fill").fill("#123456");
    await page.locator('[data-tab="custom"]').click();
    await page.locator("#svg-custom-code").fill("<svg/>");
    await page.locator("#svg-close").click();
    await expect(modal(page)).not.toHaveClass(/\bshow\b/);
    await openSvg(page);
    await expect(page.locator('[data-tab="custom"]')).toHaveClass(/\bactive\b/);
    await expect(page.locator("#svg-custom-code")).toHaveValue("<svg/>");
    await page.locator('[data-tab="shapes"]').click();
    await expect(page.locator("#svg-fill")).toHaveValue("#123456");
    await expect(page.locator('[data-shape="rect"] rect')).toHaveAttribute("fill", "#123456");
  });

  test("an emptied source box gets the sample back when reopened", async ({ page }) => {
    await open(page);
    await openSvg(page);
    await page.locator('[data-tab="custom"]').click();
    await page.locator("#svg-custom-code").fill("");
    await page.locator("#svg-close").click();
    await openSvg(page);
    await expect(page.locator("#svg-custom-code")).toHaveValue(/<svg xmlns/);
  });

  test("closes with Close and by clicking outside, not inside", async ({ page }) => {
    await open(page);
    await openSvg(page);
    await page.locator("#svg-modal-bg .modal h2").click();
    await expect(modal(page)).toHaveClass(/\bshow\b/);
    await modal(page).click({ position: { x: 5, y: 5 } });
    await expect(modal(page)).not.toHaveClass(/\bshow\b/);
  });
});
