// P6-7: edit-frame, the one-slide document inside the editor's canvas iframe
// (and the pronunciation page's preview). The editor specs drive it through the
// real editor; these pin its own contract directly, as the editor / pronunciation
// pages see it: the postMessage protocol (§2.4 of the plan), how it gets its data,
// how it saves and what it saves. They pass on the legacy page first and must
// keep passing on the port.
import type { Frame, Page } from "@playwright/test";
import { expect, test } from "../support/app";
import { DECK } from "../support/seed";

const EF = "ef-deck";

const SLIDES: Record<string, string> = {
  // no data-editable marks: the editor marks the leaf text containers itself
  "ef-1": `<section class="slide" data-title="First slide"><h1>Heading</h1><p>Body text</p><div><span>Inline</span></div></section>`,
  // marked editables, a visible class and shown fragment saved by an older editor
  "ef-2": `<section class="slide visible" data-title="Second" data-stepper=".card"><h2 data-editable="true">Marked</h2><p>Not marked</p><div class="card" id="c0">a</div><div class="card" id="c1">b</div><p class="fragment show" id="f0">shown</p><p class="fragment" data-fragment-group="g" id="f1">g1</p><p class="fragment" data-fragment-group="g" id="f2">g2</p></section>`,
  // persisted presentation chrome that must be cleaned on load
  "ef-3": `<section class="slide" data-title="Chrome" data-hl="Left" data-page="3/9"><div class="slide-header reveal" data-se-generated="slide-header">old</div><h1 data-editable="true">Has chrome</h1><div class="slide-footer" data-se-generated="slide-footer">old</div></section>`,
};

const addDeck = (page: Page) =>
  page.addInitScript(
    ({ id, slides }) => {
      const db = JSON.parse(localStorage.getItem("__fakedb") || "{}");
      if (db.decks.some((d: { deck_id: string }) => d.deck_id === id)) return;
      const src = db.decks.find((d: { deck_id: string }) => d.deck_id === "plain-deck");
      db.decks.push({ ...src, deck_id: id, title: "EF deck" });
      Object.entries(slides).forEach(([sid, content], i) => {
        db.slides.push({
          deck_id: id,
          section_id: sid,
          order: i + 1,
          title: `s${i + 1}`,
          content,
          updated_at: src.updated_at,
        });
      });
      localStorage.setItem("__fakedb", JSON.stringify(db));
    },
    { id: EF, slides: SLIDES },
  );

type Msg = Record<string, unknown>;

/** Open edit-frame in an iframe of a blank same-origin page that plays the editor:
 *  it records every message from the frame and can answer edit-frame:request-data. */
async function mount(
  page: Page,
  query: string,
  reply: "none" | "data" | "empty" | { title: string } = "none",
) {
  await addDeck(page);
  await page.route("**/__harness.html", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>editor</title><body></body>",
    }),
  );
  await page.goto("/__harness.html");
  await page.evaluate(
    ({ query, reply }) => {
      const w = window as unknown as { __msgs: Msg[]; __reqs: Msg[] };
      w.__msgs = [];
      w.__reqs = [];
      window.addEventListener("message", async (e) => {
        const m = e.data;
        if (!m || typeof m.type !== "string") return;
        if (m.type === "edit-frame:request-data") {
          w.__reqs.push(m);
          if (reply === "none") return;
          const db = JSON.parse(localStorage.getItem("__fakedb") || "{}");
          const deck = db.decks.find((d: { deck_id: string }) => d.deck_id === m.deckId);
          const slide = db.slides.find(
            (s: { deck_id: string; section_id: string }) =>
              s.deck_id === m.deckId && s.section_id === m.sectionId,
          );
          const answer =
            reply === "empty"
              ? { type: "edit-frame:data", id: m.id }
              : {
                  type: "edit-frame:data",
                  id: m.id,
                  deck,
                  slide:
                    typeof reply === "object"
                      ? { ...slide, content: slide.content.replace("Heading", reply.title) }
                      : slide,
                };
          (e.source as Window).postMessage(answer, "*");
        } else {
          w.__msgs.push(m);
        }
      });
      const f = document.createElement("iframe");
      f.id = "ef";
      f.style.cssText = "width:1280px;height:720px;border:0";
      f.src = `/edit-frame.html?${query}`;
      document.body.append(f);
    },
    { query, reply },
  );
  const handle = await page.waitForSelector("#ef");
  return (await handle.contentFrame()) as Frame;
}

const msgs = (page: Page, type?: string) =>
  page.evaluate(
    (t) => (window as unknown as { __msgs: Msg[] }).__msgs.filter((m) => !t || m.type === t),
    type,
  );
const send = (page: Page, message: Msg) =>
  page.evaluate(
    (m) => (document.getElementById("ef") as HTMLIFrameElement).contentWindow?.postMessage(m, "*"),
    message,
  );
const ready = async (frame: Frame) => {
  await frame.waitForSelector("[data-section-id]");
  await frame.waitForFunction(() => document.readyState === "complete");
};
const type = async (frame: Frame, sel: string, text: string) => {
  await frame.locator(sel).click();
  await frame.locator(sel).press("End");
  await frame.page().keyboard.type(text);
};

test.describe("loading", () => {
  test("opened bare (no editor around it) it fetches its own data", async ({ page }) => {
    await addDeck(page);
    await page.goto(`/edit-frame.html?deck=${EF}&section=ef-1`);
    await expect(page.locator("section[data-section-id='ef-1']")).toHaveCount(1);
    await expect(page.locator("section.slide")).toHaveCount(1); // one section, not the deck
    await expect(page.locator("body")).not.toHaveClass(/edit-active/);
  });

  test("it asks the editor first, with a request id, and uses its answer", async ({ page }) => {
    const frame = await mount(page, `deck=${EF}&section=ef-1&edit=1`, { title: "From the editor" });
    await ready(frame);
    await expect(frame.locator("h1")).toHaveText("From the editor");
    const reqs = (await page.evaluate(
      () => (window as unknown as { __reqs: Msg[] }).__reqs,
    )) as Msg[];
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({
      type: "edit-frame:request-data",
      deckId: EF,
      sectionId: "ef-1",
    });
    expect(typeof reqs[0].id).toBe("string");
  });

  test("an answer without a slide falls back to a direct fetch", async ({ page }) => {
    const frame = await mount(page, `deck=${EF}&section=ef-1&edit=1`, "empty");
    await ready(frame);
    await expect(frame.locator("h1")).toHaveText("Heading");
  });

  test("no answer within a moment falls back to a direct fetch", async ({ page }) => {
    const start = Date.now();
    const frame = await mount(page, `deck=${EF}&section=ef-1&edit=1`, "none");
    await ready(frame);
    await expect(frame.locator("h1")).toHaveText("Heading");
    expect(Date.now() - start).toBeGreaterThan(700); // it waited for the editor first
  });

  test("missing ids are reported to the editor and shown", async ({ page }) => {
    const frame = await mount(page, `deck=${EF}`);
    await expect(frame.locator("body > pre")).toHaveText("Missing ?deck=<id>&section=<id>");
    await expect
      .poll(() => msgs(page, "edit-frame:error"))
      .toEqual([{ type: "edit-frame:error", message: "Missing ?deck=<id>&section=<id>" }]);
  });

  test("an unknown slide is reported as Load failed", async ({ page }) => {
    const frame = await mount(page, `deck=${EF}&section=nope&edit=1`);
    await expect(frame.locator("body > pre")).toContainText("Load failed:", { timeout: 10_000 });
    const [error] = (await msgs(page, "edit-frame:error")) as Msg[];
    expect(String(error.message)).toMatch(/^Load failed: /);
  });
});

test.describe("read mode and edit mode", () => {
  test("read mode shows the slide with the deck's own scripts and nothing editable", async ({
    page,
  }) => {
    await addDeck(page);
    await page.goto(`/edit-frame.html?deck=${DECK}&section=${await firstSection(page)}`);
    await page.waitForSelector("[data-section-id]");
    await expect(page.locator("[contenteditable]")).toHaveCount(0);
    expect(await page.locator("script").count()).toBeGreaterThan(0);
    await expect(page.locator("link[href*='edit-frame.css']")).toHaveCount(0);
  });

  test("edit mode drops the deck's scripts, adds the edit style and marks the editables", async ({
    page,
  }) => {
    const frame = await mount(page, `deck=${DECK}&section=${await firstSection(page)}&edit=1`);
    await ready(frame);
    await expect(frame.locator("body")).toHaveClass(/edit-active/);
    await expect(frame.locator("link[href*='edit-frame.css']")).toHaveCount(1);
    // no deck scripts, only the edit runtime's own module
    expect(await frame.locator("script:not([type='module'])").count()).toBe(0);
    expect(await frame.locator("[contenteditable='true']").count()).toBeGreaterThan(0);
  });

  test("a slide with no marked editables gets its leaf text containers marked", async ({
    page,
  }) => {
    const frame = await mount(page, `deck=${EF}&section=ef-1&edit=1`);
    await ready(frame);
    await frame.waitForSelector("[contenteditable]");
    const marked = await frame.evaluate(() =>
      [...document.querySelectorAll("[data-editable='true']")].map((e) => e.tagName),
    );
    // the wrapping div counts too: only h1..blockquote make an element "not a leaf"
    expect(marked).toEqual(["H1", "P", "DIV", "SPAN"]);
  });

  test("marked editables are the only ones", async ({ page }) => {
    const frame = await mount(page, `deck=${EF}&section=ef-2&edit=1`);
    await ready(frame);
    await frame.waitForSelector("[contenteditable]");
    expect(await frame.locator("[contenteditable='true']").count()).toBe(1);
    await expect(frame.locator("h2")).toHaveAttribute("contenteditable", "true");
    await expect(frame.locator("p#f0")).not.toHaveAttribute("contenteditable", /.*/);
  });

  test("playback state saved by an older editor is dropped, the slide plays in a frame later", async ({
    page,
  }) => {
    const frame = await mount(page, `deck=${EF}&section=ef-2&edit=1`);
    await ready(frame);
    await expect(frame.locator("p#f0")).not.toHaveClass(/\bshow\b/);
    await expect(frame.locator("section")).toHaveClass(/\bvisible\b/); // added after a frame
  });

  test("edit:ready says how many editables there are", async ({ page }) => {
    const frame = await mount(page, `deck=${EF}&section=ef-1&edit=1`);
    await ready(frame);
    await expect
      .poll(() => msgs(page, "edit:ready"))
      .toEqual([{ type: "edit:ready", section_id: "ef-1", editable_count: 4 }]);
  });

  test("edit ids are assigned: slide title + counter, unique", async ({ page }) => {
    const frame = await mount(page, `deck=${EF}&section=ef-1&edit=1`);
    await ready(frame);
    await frame.waitForSelector("[data-edit-id]");
    const ids = await frame.evaluate(() =>
      [...document.querySelectorAll("[data-edit-id]")].map((e) => e.getAttribute("data-edit-id")),
    );
    expect(ids).toEqual(["first-slide-01", "first-slide-02", "first-slide-03", "first-slide-04"]);
  });
});

test.describe("saving", () => {
  test("typing marks the slide dirty at once and saves after 800 ms", async ({ page }) => {
    const frame = await mount(page, `deck=${EF}&section=ef-1&edit=1`);
    await ready(frame);
    await frame.waitForSelector("[contenteditable]");
    await type(frame, "h1", "!");
    await expect.poll(() => msgs(page, "edit:dirty")).not.toHaveLength(0);
    expect((await msgs(page, "edit:dirty"))[0]).toEqual({ type: "edit:dirty", section_id: "ef-1" });
    expect(await msgs(page, "edit:save")).toHaveLength(0); // not yet
    await expect.poll(() => msgs(page, "edit:save"), { timeout: 5000 }).toHaveLength(1);
    const [save] = (await msgs(page, "edit:save")) as {
      content: string;
      deck_id: string;
      section_id: string;
    }[];
    expect(save).toMatchObject({ type: "edit:save", deck_id: EF, section_id: "ef-1" });
    expect(save.content).toContain("<h1");
    expect(save.content).toContain("Heading!");
    // what is saved is clean: no section id, no contenteditable, no playback state
    expect(save.content).not.toContain("data-section-id");
    expect(save.content).not.toContain("contenteditable");
    expect(save.content).not.toMatch(/class="[^"]*\bvisible\b/);
    expect(save.content).toContain('data-edit-id="first-slide-01"');
  });

  test("flush with nothing new says noop", async ({ page }) => {
    const frame = await mount(page, `deck=${EF}&section=ef-1&edit=1`);
    await ready(frame);
    await frame.waitForSelector("[contenteditable]");
    await send(page, { type: "edit:flush" });
    await expect
      .poll(() => msgs(page, "edit:noop"))
      .toEqual([{ type: "edit:noop", section_id: "ef-1" }]);
    expect(await msgs(page, "edit:save")).toHaveLength(0);
  });

  test("with autosave off an edit is only announced; flush saves it; on again re-arms the timer", async ({
    page,
  }) => {
    const frame = await mount(page, `deck=${EF}&section=ef-1&edit=1`);
    await ready(frame);
    await frame.waitForSelector("[contenteditable]");
    await send(page, { type: "edit:set-autosave", value: false });
    await type(frame, "h1", "1");
    await expect.poll(() => msgs(page, "edit:dirty")).not.toHaveLength(0);
    await page.waitForTimeout(1200);
    expect(await msgs(page, "edit:save")).toHaveLength(0);
    await send(page, { type: "edit:flush" });
    await expect.poll(() => msgs(page, "edit:save")).toHaveLength(1);
    await send(page, { type: "edit:set-autosave", value: true });
    await type(frame, "h1", "2");
    await expect.poll(() => msgs(page, "edit:save"), { timeout: 5000 }).toHaveLength(2);
    expect(((await msgs(page, "edit:save")) as { content: string }[])[1].content).toContain(
      "Heading12",
    );
  });

  test("turning autosave off cancels a pending timer", async ({ page }) => {
    const frame = await mount(page, `deck=${EF}&section=ef-1&edit=1`);
    await ready(frame);
    await frame.waitForSelector("[contenteditable]");
    await type(frame, "h1", "x");
    await send(page, { type: "edit:set-autosave", value: false });
    await page.waitForTimeout(1400);
    expect(await msgs(page, "edit:save")).toHaveLength(0);
  });

  test("chrome written by an older editor is cleaned and saved right after ready", async ({
    page,
  }) => {
    const frame = await mount(page, `deck=${EF}&section=ef-3&edit=1`);
    await ready(frame);
    await expect.poll(() => msgs(page, "edit:save")).toHaveLength(1);
    const [save] = (await msgs(page, "edit:save")) as { content: string }[];
    expect(save.content).not.toContain("slide-header");
    expect(save.content).not.toContain("slide-footer");
    expect(save.content).not.toContain("data-se-generated");
    expect(save.content).toContain("Has chrome");
    const order = (await msgs(page)).map((m) => m.type);
    expect(order.indexOf("edit:ready")).toBeLessThan(order.indexOf("edit:save"));
  });

  test("a slide that is already clean is not re-saved on load", async ({ page }) => {
    const frame = await mount(page, `deck=${EF}&section=ef-1&edit=1`);
    await ready(frame);
    await page.waitForTimeout(600);
    expect(await msgs(page, "edit:save")).toHaveLength(0);
  });

  test("a paste is inserted as plain text", async ({ page }) => {
    const frame = await mount(page, `deck=${EF}&section=ef-1&edit=1`);
    await ready(frame);
    await frame.waitForSelector("[contenteditable]");
    await frame.locator("p").click();
    await frame.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData("text/plain", "PLAIN");
      dt.setData("text/html", "<b>RICH</b>");
      document
        .querySelector("p")
        ?.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
        );
    });
    await expect(frame.locator("p")).toContainText("PLAIN");
    await expect(frame.locator("p b")).toHaveCount(0);
  });
});

test.describe("inserting things", () => {
  const savedContent = async (page: Page) => {
    await send(page, { type: "edit:flush" });
    await expect.poll(() => msgs(page, "edit:save")).not.toHaveLength(0);
    return ((await msgs(page, "edit:save")) as { content: string }[]).at(-1)?.content ?? "";
  };
  const open = async (page: Page) => {
    const frame = await mount(page, `deck=${EF}&section=ef-1&edit=1`);
    await ready(frame);
    await frame.waitForSelector("[contenteditable]");
    return frame;
  };

  test("edit:insert-image adds an img with the alt text, full width at most", async ({ page }) => {
    await open(page);
    await send(page, { type: "edit:insert-image", url: "https://x.test/a.png", alt: "pic" });
    const content = await savedContent(page);
    expect(content).toContain(
      '<img src="https://x.test/a.png" alt="pic" style="max-width: 100%;">',
    );
  });

  test("edit:insert-asset takes the form of the kind", async ({ page }) => {
    await open(page);
    await send(page, { type: "edit:insert-asset", url: "https://x.test/v.mp4", kind: "video" });
    await send(page, { type: "edit:insert-asset", url: "https://x.test/a.mp3", kind: "audio" });
    await send(page, {
      type: "edit:insert-asset",
      url: "https://x.test/d/file.pdf",
      name: "",
      kind: "file",
    });
    await send(page, {
      type: "edit:insert-asset",
      url: "https://x.test/i.png",
      name: "alt",
      kind: "image",
    });
    const content = await savedContent(page);
    expect(content).toMatch(
      /<video src="https:\/\/x.test\/v.mp4" controls="" preload="metadata" playsinline="" style="max-width: 100%;">/,
    );
    expect(content).toMatch(/<audio src="https:\/\/x.test\/a.mp3" controls="" preload="metadata">/);
    expect(content).toContain(
      '<a href="https://x.test/d/file.pdf" target="_blank" rel="noopener">file.pdf</a>',
    );
    expect(content).toContain('<img src="https://x.test/i.png" alt="alt"');
  });

  test("a missing url inserts nothing", async ({ page }) => {
    await open(page);
    await send(page, { type: "edit:insert-image" });
    await send(page, { type: "edit:insert-asset", kind: "file" });
    await send(page, { type: "edit:insert-svg", html: "" });
    await page.waitForTimeout(300);
    expect(await msgs(page, "edit:dirty")).toHaveLength(0);
  });

  test("edit:insert-svg adds the markup", async ({ page }) => {
    await open(page);
    await send(page, {
      type: "edit:insert-svg",
      html: '<svg viewBox="0 0 1 1"><circle r="1"/></svg>',
    });
    const content = await savedContent(page);
    expect(content).toContain('<svg viewBox="0 0 1 1"><circle r="1"></circle></svg>');
  });

  test("with the caret inside the slide the node goes there", async ({ page }) => {
    const frame = await open(page);
    await frame.locator("p").click();
    await send(page, { type: "edit:insert-image", url: "https://x.test/c.png" });
    const content = await savedContent(page);
    expect(content).toMatch(
      /<p[^>]*>Body text<img src="https:\/\/x.test\/c.png"|<p[^>]*>.*<img src="https:\/\/x.test\/c.png"/,
    );
  });

  test("without a caret it is appended to the first block editable", async ({ page }) => {
    const frame = await open(page);
    await frame.evaluate(() => document.getSelection()?.removeAllRanges());
    await send(page, { type: "edit:insert-image", url: "https://x.test/d.png" });
    const content = await savedContent(page);
    expect(content).toMatch(/<p[^>]*>Body text<img src="https:\/\/x.test\/d.png"/);
  });
});

test.describe("preview steps", () => {
  const open = async (page: Page) => {
    const frame = await mount(page, `deck=${EF}&section=ef-2&edit=1`);
    await ready(frame);
    await frame.waitForSelector("[contenteditable]");
    return frame;
  };
  const shown = (frame: Frame) =>
    frame.evaluate(() => [...document.querySelectorAll(".fragment.show")].map((e) => e.id));
  const active = (frame: Frame) =>
    frame.evaluate(() => [...document.querySelectorAll(".mint")].map((e) => e.id));

  test("preview-fallback reveals the next fragment, a group together, then steps the stepper", async ({
    page,
  }) => {
    const frame = await open(page);
    await send(page, { type: "edit:preview-fallback" });
    await expect.poll(() => shown(frame)).toEqual(["f0"]);
    await send(page, { type: "edit:preview-fallback" });
    await expect.poll(() => shown(frame)).toEqual(["f0", "f1", "f2"]);
    await send(page, { type: "edit:preview-fallback" }); // fragments done → stepper starts: nothing active yet → item 0
    await expect.poll(() => active(frame)).toEqual(["c0"]);
    await send(page, { type: "edit:preview-fallback" });
    await expect.poll(() => active(frame)).toEqual(["c1"]);
    await send(page, { type: "edit:preview-fallback" }); // no more
    await page.waitForTimeout(200);
    expect(await active(frame)).toEqual(["c1"]);
  });

  test("preview-back hides fragments first (last group first), then walks the stepper back", async ({
    page,
  }) => {
    const frame = await open(page);
    for (let i = 0; i < 4; i++) await send(page, { type: "edit:preview-fallback" });
    await expect.poll(() => active(frame)).toEqual(["c1"]);
    await send(page, { type: "edit:preview-back" }); // the group f1+f2 goes together
    await expect.poll(() => shown(frame)).toEqual(["f0"]);
    await send(page, { type: "edit:preview-back" });
    await expect.poll(() => shown(frame)).toEqual([]);
    expect(await active(frame)).toEqual(["c1"]); // the stepper has not moved yet
    await send(page, { type: "edit:preview-back" });
    await expect.poll(() => active(frame)).toEqual(["c0"]);
    await send(page, { type: "edit:preview-back" });
    await expect.poll(() => active(frame)).toEqual([]);
  });

  test("a click on the slide in the deck's own preview counts, the fallback does not click", async ({
    page,
  }) => {
    const frame = await open(page);
    // the message form must not dispatch a click on the section
    await frame.evaluate(() => {
      (window as unknown as { __clicks: number }).__clicks = 0;
      document.querySelector("section")?.addEventListener("click", () => {
        (window as unknown as { __clicks: number }).__clicks++;
      });
    });
    await send(page, { type: "edit:preview-fallback" });
    await page.waitForTimeout(200);
    expect(await frame.evaluate(() => (window as unknown as { __clicks: number }).__clicks)).toBe(
      0,
    );
  });
});

test.describe("keys", () => {
  test("keys typed in an editable do not reach the deck's own handlers; others do", async ({
    page,
  }) => {
    const frame = await mount(page, `deck=${EF}&section=ef-1&edit=1`);
    await ready(frame);
    await frame.waitForSelector("[contenteditable]");
    await frame.evaluate(() => {
      const w = window as unknown as { __keys: string[] };
      w.__keys = [];
      for (const t of ["keydown", "keypress", "keyup"])
        document.addEventListener(t, (e) =>
          w.__keys.push(`${t}:${(e.target as HTMLElement).tagName}`),
        );
    });
    await frame.locator("h1").click();
    await frame.page().keyboard.press("a");
    expect(await frame.evaluate(() => (window as unknown as { __keys: string[] }).__keys)).toEqual(
      [],
    );
    await frame.evaluate(() => (document.activeElement as HTMLElement).blur());
    await frame.page().keyboard.press("b");
    expect(
      (await frame.evaluate(() => (window as unknown as { __keys: string[] }).__keys)).length,
    ).toBeGreaterThan(0);
  });
});

async function firstSection(page: Page) {
  await page.goto("/index.html");
  return page.evaluate((deck) => {
    const db = JSON.parse(localStorage.getItem("__fakedb") || "{}");
    return db.slides
      .filter((s: { deck_id: string }) => s.deck_id === deck)
      .sort((a: { order: number }, b: { order: number }) => a.order - b.order)[0].section_id;
  }, DECK);
}
