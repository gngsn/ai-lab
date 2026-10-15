// Shared e2e setup: every test runs the real app against the fake backend.
//  - js/config.local.js → fake config (passphrase "test"), never the real file
//  - vendor/modules/supabase-client.mjs → tests/fake-backend/supabase-client.mjs
//  - https://fake.supabase.test/** → a 1×1 PNG (asset URLs), with CORS
//  - every other off-site request is aborted (fonts, QR, CDNs) for speed and
//    determinism
//  - the fake DB is seeded once per browser context (tests/support/seed.ts)
//  - owner pages are pre-authorized unless a test opts out with `authed: false`
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test as base, expect, type Frame, type Page } from "@playwright/test";
import { buildSeed } from "./seed";

const FAKE_CLIENT = readFileSync(
  fileURLToPath(new URL("../fake-backend/supabase-client.mjs", import.meta.url)),
  "utf8",
);
const FAKE_CONFIG =
  'window.SUPABASE_URL="https://fake.supabase.test";' +
  'window.SUPABASE_ANON_KEY="fake";' +
  'window.OWNER_PASSPHRASE="test";';
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
export const PASSPHRASE = "test";
export const AUTH_KEY = "speakeasy:auth:token";

export const test = base.extend<{ authed: boolean }>({
  authed: [true, { option: true }],
  context: async ({ context, authed }, use) => {
    await context.route("**/js/config.local.js", (r) =>
      r.fulfill({ contentType: "text/javascript", body: FAKE_CONFIG }),
    );
    await context.route("**/vendor/modules/supabase-client.mjs", (r) =>
      r.fulfill({ contentType: "text/javascript", body: FAKE_CLIENT }),
    );
    await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => {
      const url = r.request().url();
      if (url.startsWith("https://fake.supabase.test/")) {
        return r.fulfill({
          contentType: "image/png",
          body: PIXEL,
          headers: { "access-control-allow-origin": "*" },
        });
      }
      return r.abort();
    });
    await context.addInitScript(
      ({ seed, authed, key, pass }) => {
        (window as Window & { __SE_E2E_FAKE__?: boolean }).__SE_E2E_FAKE__ = true;
        if (!localStorage.getItem("__fakedb")) {
          localStorage.setItem("__fakedb", JSON.stringify(seed));
        }
        if (authed && !localStorage.getItem(key)) localStorage.setItem(key, pass);
      },
      { seed: buildSeed(), authed, key: AUTH_KEY, pass: PASSPHRASE },
    );
    await use(context);
  },
  page: async ({ page }, use) => {
    page.on("dialog", (d) => d.accept()); // app alerts / confirms
    await use(page);
  },
});
export { expect };

/** The slide frame of present / view / share (js/letterbox.js), once the
 *  deck has been written into it. */
export async function deckFrame(page: Page): Promise<Frame> {
  const handle = await page.waitForSelector("#__se_letterbox");
  const frame = await handle.contentFrame();
  if (!frame) throw new Error("letterbox frame missing");
  await frame.waitForSelector("[data-section-id]");
  await frame.waitForFunction(() => document.readyState === "complete");
  return frame;
}

/** Current slide index and shown fragments, in either host mode. */
export async function slideState(frame: Frame) {
  return frame.evaluate(() => {
    const w = window as unknown as {
      __seDeckController?: { currentSlide: number; slides: HTMLElement[] };
    };
    const ctl = w.__seDeckController;
    const slides = ctl?.slides ?? [...document.querySelectorAll<HTMLElement>("section.slide")];
    const index = ctl
      ? ctl.currentSlide
      : slides.findIndex((s) => Math.abs(s.getBoundingClientRect().top) < 5);
    const slide = slides[index];
    return {
      mode: ctl ? "deck" : "speakeasy",
      index,
      title: slide?.dataset.title ?? null,
      shown: slide ? slide.querySelectorAll(".fragment.show").length : 0,
    };
  });
}

/** Press a key the way a presenter would (the letterbox forwards keys). */
export async function press(page: Page, key: string, times = 1) {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }
}

/** The fake database as the pages currently see it (see fake-backend). */
export async function readDb(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("__fakedb") || "{}")) as Promise<
    Record<string, Record<string, unknown>[]>
  >;
}

/** One row's current value from the fake DB, e.g. the note of a slide. */
export async function dbRow(
  page: Page,
  table: string,
  where: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const db = await readDb(page);
  return (db[table] ?? []).find((r) => Object.entries(where).every(([k, v]) => r[k] === v));
}
