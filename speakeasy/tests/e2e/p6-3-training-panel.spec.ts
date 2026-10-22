// P6-3: the pronunciation training panel (Generate / Upload / Record / score /
// take histories) on /pronunciation.html. The panel is shared with the editor
// (pinned by p4-7h); this spec pins everything else it does so that the move
// from public/js/training-panel.js to React keeps every behaviour. The local
// TTS and speech servers are stubbed; the microphone is Chrome's fake device.
import type { Page } from "@playwright/test";
import { expect, readDb, test } from "../support/app";
import { DECK } from "../support/seed";

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

const KOKORO = "http://localhost:8880/v1/audio/speech";
const MLX_MODELS = "http://localhost:8000/v1/models";
const MLX_STT = "http://localhost:8000/v1/audio/transcriptions";
const REMOTE = /fake\.supabase\.test\/storage\/v1\/object\/public\/slides-audio\//;

/** A valid 16-bit mono WAV with `samples` samples of silence. */
function wav(samples = 2205, sampleRate = 22050) {
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

type Stub = {
  tts: { input: string; speed: number; model: string; voice: string; response_format: string }[];
  ttsStatus: number;
  mlxUp: boolean;
  sttStatus: number;
  transcript: string;
  sttCalls: number;
  remoteFetches: number;
  dialogs: string[];
};

// The seeded notes are Korean and the scorer only reads a-z, so the page gets English notes.
const NOTES = "Hello everyone, and welcome. Slide {n} is a short talk about speaking clearly.";

async function open(page: Page, init: Partial<Stub> = {}, notes: string = NOTES) {
  await page.addInitScript(
    ({ deck, text }) => {
      const db = JSON.parse(localStorage.getItem("__fakedb") || "{}");
      const order = new Map(
        (db.slides as { deck_id: string; section_id: string; order: number }[])
          .filter((s) => s.deck_id === deck)
          .map((s) => [s.section_id, s.order]),
      );
      for (const n of db.notes)
        if (n.deck_id === deck)
          n.content = text.replace("{n}", String((order.get(n.section_id) ?? 0) + 1));
      localStorage.setItem("__fakedb", JSON.stringify(db));
    },
    { deck: DECK, text: notes },
  );
  const stub: Stub = {
    tts: [],
    ttsStatus: 200,
    mlxUp: true,
    sttStatus: 200,
    transcript: "",
    sttCalls: 0,
    remoteFetches: 0,
    dialogs: [],
    ...init,
  };
  page.on("dialog", (d) => stub.dialogs.push(d.message()));
  await page.route(KOKORO, async (route) => {
    stub.tts.push(JSON.parse(route.request().postData() ?? "{}"));
    if (stub.ttsStatus !== 200) {
      await route.fulfill({ status: stub.ttsStatus, contentType: "text/plain", body: "boom" });
      return;
    }
    await route.fulfill({ status: 200, contentType: "audio/wav", body: wav() });
  });
  await page.route(MLX_MODELS, (route) =>
    stub.mlxUp
      ? route.fulfill({ status: 200, contentType: "application/json", body: '{"data":[]}' })
      : route.abort(),
  );
  await page.route(MLX_STT, (route) => {
    stub.sttCalls++;
    return route.fulfill({
      status: stub.sttStatus,
      contentType: "application/json",
      body: JSON.stringify({ text: stub.transcript }),
    });
  });
  await page.route(REMOTE, (route) => {
    stub.remoteFetches++;
    return route.fulfill({
      status: 200,
      contentType: "audio/wav",
      body: wav(4410),
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await load(page);
  return stub;
}

async function load(page: Page) {
  await page.goto(`/pronunciation.html?deck=${DECK}`);
  await expect(page.locator(".sec-item")).toHaveCount(6);
  await expect(page.locator("#training-mount .training-panel")).toHaveCount(1);
}

// The legacy markup has two #stt-status spans (one per action row); only the first is ever written.
const status = (page: Page) => page.locator("#stt-status").first();
const panel = (page: Page) => page.locator("#training-mount .training-panel");
const options = (page: Page, id: string) => page.locator(`#${id} option`);

/** The script the panel scores against: the selected slide's cleaned notes. */
const script = (page: Page) => page.locator("#script-body").innerText();

async function sectionIds(page: Page) {
  const db = await readDb(page);
  return (db.slides as { deck_id: string; section_id: string; order: number }[])
    .filter((s) => s.deck_id === DECK)
    .sort((a, b) => a.order - b.order)
    .map((s) => s.section_id);
}

async function colorOf(page: Page, cssVar: string) {
  return page.evaluate((v) => {
    const probe = document.createElement("i");
    probe.style.color = `var(${v})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, cssVar);
}

async function recordFor(page: Page, ms = 500) {
  await page.locator("#record-btn").click();
  await expect(page.locator("#record-btn")).toHaveText("⏹ Stop");
  await expect(status(page)).toHaveText(/recording|listening/);
  await page.waitForTimeout(ms);
  await page.locator("#record-btn").click();
}

test.describe("initial state", () => {
  test("only the action rows and the hint show", async ({ page }) => {
    await open(page);
    await expect(panel(page).locator("#listen-btn")).toHaveText("🔄 Generate");
    await expect(panel(page).locator("#save-btn")).toHaveText("☁️ Upload");
    await expect(panel(page).locator("#record-btn")).toHaveText("🎙 Record");
    await expect(panel(page).locator("#rec-save-btn")).toHaveText("📁 Folder");
    await expect(page.locator("#feedback-hint")).toBeVisible();
    for (const id of ["#fb-diff", "#fb-score", "#fb-transcript", "#retry-btn"])
      await expect(page.locator(id)).toBeHidden();
    await expect(page.locator("#history-select")).toBeHidden();
    await expect(page.locator("#rec-history-select")).toBeHidden();
    await expect(page.locator("#section-audio")).not.toHaveClass(/show/);
    await expect(page.locator("#rec-audio")).not.toHaveClass(/show/);
    await expect(page.locator("#score-big")).toHaveText("—");
  });

  test("keeps the legacy markup: two status spans, only the first one is used", async ({
    page,
  }) => {
    await open(page, { transcript: "hello" });
    await expect(page.locator("#stt-status")).toHaveCount(2);
    await expect(page.locator("#action-row")).toHaveCount(2);
    await page.locator("#record-btn").click();
    await expect(page.locator("#record-btn")).toHaveText("⏹ Stop");
    await expect(page.locator("#stt-status").first()).toHaveText(/recording|listening/);
    await expect(page.locator("#stt-status").nth(1)).toHaveText("");
    await page.locator("#record-btn").click();
  });
});

test.describe("Generate", () => {
  test("posts the cleaned notes with the speed and shows the player", async ({ page }) => {
    const stub = await open(page);
    await page.locator("#speed-slider").fill("1.25");
    await page.locator("#listen-btn").click();
    await expect.poll(() => stub.tts.length).toBe(1);
    expect(stub.tts[0]).toMatchObject({
      model: "kokoro",
      voice: "af_heart",
      response_format: "mp3",
      speed: 1.25,
    });
    expect(stub.tts[0].input.replace(/\s+/g, " ")).toBe((await script(page)).replace(/\s+/g, " "));
    await expect(page.locator("#section-audio")).toHaveClass(/show/);
    await expect(page.locator("#section-audio")).toHaveAttribute("src", /^blob:/);
    await expect
      .poll(() => page.locator("#section-audio").evaluate((a: HTMLAudioElement) => a.playbackRate))
      .toBe(1.25);
    await expect(page.locator("#listen-btn")).toHaveText("🔄 Generate");
    await expect(page.locator("#listen-btn")).toBeEnabled();
  });

  test("the button shows … and is disabled while the server works", async ({ page }) => {
    const stub = await open(page);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.unroute(KOKORO);
    await page.route(KOKORO, async (route) => {
      stub.tts.push(JSON.parse(route.request().postData() ?? "{}"));
      await gate;
      await route.fulfill({ status: 200, contentType: "audio/wav", body: wav() });
    });
    await page.locator("#listen-btn").click();
    await expect(page.locator("#listen-btn")).toHaveText("…");
    await expect(page.locator("#listen-btn")).toBeDisabled();
    release();
    await expect(page.locator("#listen-btn")).toHaveText("🔄 Generate");
    await expect(page.locator("#listen-btn")).toBeEnabled();
  });

  test("a second click reuses the saved take instead of asking the server again", async ({
    page,
  }) => {
    const stub = await open(page);
    await page.locator("#listen-btn").click();
    await expect(page.locator("#section-audio")).toHaveClass(/show/);
    await page.locator("#listen-btn").click();
    await expect(page.locator("#listen-btn")).toHaveText("🔄 Generate");
    expect(stub.tts).toHaveLength(1);
    await expect(options(page, "history-select")).toHaveCount(1);
  });

  test("the take list shows one labelled entry per take, newest first", async ({ page }) => {
    await open(page);
    await page.locator("#listen-btn").click();
    await expect(page.locator("#history-select")).toBeVisible();
    await expect(options(page, "history-select")).toHaveCount(1);
    await expect(options(page, "history-select").first()).toHaveText(/^v1 · .+ · 🏠$/);
    await expect(options(page, "history-select").first()).toHaveJSProperty("selected", true);
  });

  test("a server error is reported and the button recovers", async ({ page }) => {
    const stub = await open(page, { ttsStatus: 500 });
    await page.locator("#listen-btn").click();
    await expect.poll(() => stub.dialogs.length).toBe(1);
    expect(stub.dialogs[0]).toBe("Kokoro TTS 500: boom");
    await expect(page.locator("#listen-btn")).toHaveText("🔄 Generate");
    await expect(page.locator("#listen-btn")).toBeEnabled();
    await expect(page.locator("#section-audio")).not.toHaveClass(/show/);
    await expect(page.locator("#history-select")).toBeHidden();
  });

  test("a section without notes does nothing", async ({ page }) => {
    const stub = await open(page, {}, "");
    await page.locator("#listen-btn").click();
    await page.waitForTimeout(300);
    expect(stub.tts).toHaveLength(0);
    expect(stub.dialogs).toHaveLength(0);
    await expect(page.locator("#listen-btn")).toHaveText("🔄 Generate");
  });
});

test.describe("engine and speed", () => {
  test("OpenAI and ElevenLabs say which key is missing; the player is cleared", async ({
    page,
  }) => {
    const stub = await open(page);
    await page.locator("#listen-btn").click();
    await expect(page.locator("#section-audio")).toHaveClass(/show/);
    await page.locator("#tts-engine").selectOption("openai");
    await expect(page.locator("#section-audio")).not.toHaveClass(/show/);
    await page.locator("#listen-btn").click();
    await expect.poll(() => stub.dialogs.length).toBe(1);
    expect(stub.dialogs[0]).toBe("OPENAI_API_KEY not set in config.local.js");
    await page.locator("#tts-engine").selectOption("elevenlabs");
    await page.locator("#listen-btn").click();
    await expect.poll(() => stub.dialogs.length).toBe(2);
    expect(stub.dialogs[1]).toBe("ELEVENLABS_API_KEY not set in config.local.js");
    expect(stub.tts).toHaveLength(1);
  });

  test("going back to the local engine reuses its take", async ({ page }) => {
    const stub = await open(page);
    await page.locator("#listen-btn").click();
    await expect(page.locator("#section-audio")).toHaveClass(/show/);
    await page.locator("#tts-engine").selectOption("openai");
    await page.locator("#tts-engine").selectOption("kokoro");
    await page.locator("#listen-btn").click();
    await expect(page.locator("#section-audio")).toHaveClass(/show/);
    expect(stub.tts).toHaveLength(1);
  });

  test("the speed slider changes the playback rate of the shown take", async ({ page }) => {
    await open(page);
    await page.locator("#listen-btn").click();
    await expect(page.locator("#section-audio")).toHaveClass(/show/);
    await page.locator("#speed-slider").fill("0.8");
    await expect
      .poll(() => page.locator("#section-audio").evaluate((a: HTMLAudioElement) => a.playbackRate))
      .toBeCloseTo(0.8, 5);
  });
});

test.describe("takes follow the section", () => {
  test("each slide keeps its own take, restored when it is selected", async ({ page }) => {
    const stub = await open(page);
    await page.locator("#listen-btn").click();
    await expect(page.locator("#section-audio")).toHaveClass(/show/);
    await page.locator(".sec-item").nth(1).click();
    await expect(page.locator("#section-audio")).not.toHaveClass(/show/);
    await expect(page.locator("#history-select")).toBeHidden();
    await page.locator(".sec-item").nth(0).click();
    await expect(page.locator("#section-audio")).toHaveClass(/show/);
    await expect(options(page, "history-select")).toHaveCount(1);
    expect(stub.tts).toHaveLength(1);
  });

  test("a take survives a reload", async ({ page }) => {
    const stub = await open(page);
    await page.locator("#listen-btn").click();
    await expect(page.locator("#section-audio")).toHaveClass(/show/);
    await load(page);
    await expect(page.locator("#section-audio")).toHaveClass(/show/);
    await expect(options(page, "history-select")).toHaveCount(1);
    await page.locator("#listen-btn").click();
    await expect(page.locator("#listen-btn")).toHaveText("🔄 Generate");
    expect(stub.tts).toHaveLength(1);
  });

  test("changing slides clears the feedback of the previous one", async ({ page }) => {
    const stub = await open(page, { transcript: "hello" });
    await recordFor(page);
    await expect(page.locator("#fb-score")).toBeVisible();
    expect(stub.sttCalls).toBe(1);
    await page.locator(".sec-item").nth(1).click();
    await expect(page.locator("#fb-score")).toBeHidden();
    await expect(page.locator("#feedback-hint")).toBeVisible();
    await expect(page.locator("#retry-btn")).toBeHidden();
    await expect(page.locator("#score-big")).toHaveText("—");
  });
});

test.describe("Upload", () => {
  test("uploads the take to the audio bucket and flashes ✓ Uploaded", async ({ page }) => {
    const stub = await open(page);
    const [first] = await sectionIds(page);
    await page.locator("#listen-btn").click();
    await expect(page.locator("#section-audio")).toHaveClass(/show/);
    await page.locator("#save-btn").click();
    await expect(page.locator("#save-btn")).toHaveText("✓ Uploaded");
    await expect(page.locator("#save-btn")).toHaveText("☁️ Upload", { timeout: 4000 });
    const stored = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem("__fakestorage") || "{}")["slides-audio"]?.[key],
      `${DECK}/${first}`,
    );
    expect(stored).toMatchObject({ mimetype: "audio/wav" });
    expect(stub.tts).toHaveLength(1);
  });

  test("synthesizes first when nothing was generated yet", async ({ page }) => {
    const stub = await open(page);
    const [first] = await sectionIds(page);
    await page.locator("#save-btn").click();
    await expect(page.locator("#save-btn")).toHaveText("✓ Uploaded");
    expect(stub.tts).toHaveLength(1);
    const keys = await page.evaluate(() =>
      Object.keys(JSON.parse(localStorage.getItem("__fakestorage") || "{}")["slides-audio"]),
    );
    expect(keys).toEqual([`${DECK}/${first}`]);
  });

  test("an upload that fails is reported and the label returns", async ({ page }) => {
    const stub = await open(page, { ttsStatus: 500 });
    await page.locator("#save-btn").click();
    await expect.poll(() => stub.dialogs.length).toBe(1);
    expect(stub.dialogs[0]).toBe("Upload failed: Kokoro TTS 500: boom");
    await expect(page.locator("#save-btn")).toHaveText("☁️ Upload");
    await expect(page.locator("#save-btn")).toBeEnabled();
  });
});

test.describe("the shared take from the audio bucket", () => {
  const seed = (page: Page, sectionId: string) =>
    page.addInitScript(
      ({ key }) => {
        const s = JSON.parse(localStorage.getItem("__fakestorage") || "{}");
        s["slides-audio"] ||= {};
        s["slides-audio"][key] ||= {
          size: 1,
          mimetype: "audio/wav",
          updated_at: "2026-01-01T00:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
        };
        localStorage.setItem("__fakestorage", JSON.stringify(s));
      },
      { key: `${DECK}/${sectionId}` },
    );

  test("is downloaded once, cached as a ☁️ take and used instead of synthesizing", async ({
    page,
  }) => {
    await page.goto("/index.html");
    const [first] = await sectionIds(page);
    await seed(page, first);
    const stub = await open(page);
    await expect(page.locator("#section-audio")).toHaveClass(/show/);
    await expect(options(page, "history-select")).toHaveCount(1);
    await expect(options(page, "history-select").first()).toHaveText(/^v1 · .+ · ☁️$/);
    expect(stub.remoteFetches).toBe(1);
    // Generate keeps the remote take
    await page.locator("#listen-btn").click();
    await expect(page.locator("#listen-btn")).toHaveText("🔄 Generate");
    expect(stub.tts).toHaveLength(0);
    // a reload finds it cached
    await load(page);
    await expect(page.locator("#section-audio")).toHaveClass(/show/);
    await expect(options(page, "history-select")).toHaveCount(1);
    expect(stub.remoteFetches).toBe(1);
  });
});

test.describe("the shared take arriving late", () => {
  test("is dropped, not shown on a slide selected in the meantime, and fetched again on return", async ({
    page,
  }) => {
    await page.goto("/index.html");
    const [first] = await sectionIds(page);
    await page.addInitScript(
      ({ key }) => {
        const s = JSON.parse(localStorage.getItem("__fakestorage") || "{}");
        s["slides-audio"] ||= {};
        s["slides-audio"][key] ||= {
          size: 1,
          mimetype: "audio/wav",
          updated_at: "2026-01-01T00:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
        };
        localStorage.setItem("__fakestorage", JSON.stringify(s));
      },
      { key: `${DECK}/${first}` },
    );
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let hits = 0;
    await page.route(REMOTE, async (route) => {
      hits++;
      await gate;
      await route.fulfill({
        status: 200,
        contentType: "audio/wav",
        body: wav(4410),
        headers: { "access-control-allow-origin": "*" },
      });
    });
    await page.goto(`/pronunciation.html?deck=${DECK}`);
    await expect(page.locator(".sec-item")).toHaveCount(6);
    await expect(page.locator("#training-mount .training-panel")).toHaveCount(1);
    await expect.poll(() => hits).toBe(1);
    await page.locator(".sec-item").nth(1).click();
    release();
    await page.waitForTimeout(500);
    await expect(page.locator("#section-audio")).not.toHaveClass(/show/);
    await expect(page.locator("#history-select")).toBeHidden();
    await page.locator(".sec-item").nth(0).click();
    await expect(page.locator("#section-audio")).toHaveClass(/show/);
    await expect(options(page, "history-select").first()).toHaveText(/☁️$/);
    // the late download was discarded (not cached), so coming back downloads it again
    expect(hits).toBe(2);
  });
});

test.describe("Record and score", () => {
  test("a perfect reading scores 100% and says Great job!", async ({ page }) => {
    const stub = await open(page);
    stub.transcript = await script(page);
    await recordFor(page);
    await expect(page.locator("#score-big")).toHaveText("100%");
    await expect(page.locator("#score-desc")).toHaveText("Great job!");
    const green = await colorOf(page, "--green");
    await expect(page.locator("#score-big")).toHaveCSS("color", green);
    await expect(page.locator("#score-desc")).toHaveCSS("color", green);
    await expect(page.locator("#feedback-hint")).toBeHidden();
    for (const id of ["#fb-diff", "#fb-score", "#fb-transcript", "#retry-btn"])
      await expect(page.locator(id)).toBeVisible();
    await expect(page.locator("#record-btn")).toHaveText("🎙 Record");
    await expect(page.locator("#record-btn")).not.toHaveClass(/recording/);
    await expect(status(page)).toHaveText("");
    await expect(page.locator("#sec-score-0")).toHaveText("100%");
    await expect(page.locator("#sec-score-0")).toHaveClass(/show great/);
  });

  test("the diff marks hits, near misses, misses and extra words", async ({ page }) => {
    const stub = await open(page);
    const words = (await script(page)).toLowerCase().match(/[a-z0-9']+/g) ?? [];
    expect(words.length).toBeGreaterThan(6);
    const [firstWord = ""] = words;
    // skip the 2nd and 3rd words and add one at the end
    stub.transcript = [firstWord, ...words.slice(3), "zzzextra"].join(" ");
    await recordFor(page);
    await expect(page.locator("#score-big")).toHaveText(/%$/);
    const spans = page.locator("#diff-text span");
    expect(await spans.count()).toBeGreaterThanOrEqual(words.length);
    await expect(page.locator("#diff-text span.hit").first()).toHaveText(firstWord);
    await expect(page.locator("#diff-text span.miss")).not.toHaveCount(0);
    await expect(page.locator("#diff-text span.extra").last()).toHaveText("zzzextra");
    await expect(page.locator("#transcript-raw")).toHaveText(`Heard: ${stub.transcript}`);
    await expect(page.locator("#transcript-raw strong")).toHaveText(stub.transcript);
  });

  test("a weak reading is classed ok or poor with its own wording and colour", async ({ page }) => {
    const stub = await open(page);
    const words = (await script(page)).split(/\s+/);
    // about 60% of the words → "Keep practicing"
    stub.transcript = words.slice(0, Math.ceil(words.length * 0.6)).join(" ");
    await recordFor(page);
    await expect(page.locator("#score-desc")).toHaveText("Keep practicing");
    await expect(page.locator("#score-big")).toHaveCSS("color", await colorOf(page, "--yellow"));
    await expect(page.locator("#sec-score-0")).toHaveClass(/show ok/);
    // a retry with almost nothing right → "Needs work"
    stub.transcript = "completely unrelated speech";
    await page.locator("#retry-btn").click();
    await expect(page.locator("#record-btn")).toHaveText("⏹ Stop");
    await expect(status(page)).toHaveText(/recording|listening/); // Stop works only once the mic is open
    await page.waitForTimeout(400);
    await page.locator("#record-btn").click();
    await expect(page.locator("#score-desc")).toHaveText("Needs work");
    await expect(page.locator("#score-big")).toHaveCSS("color", await colorOf(page, "--red"));
    await expect(page.locator("#sec-score-0")).toHaveClass(/show poor/);
  });

  test("a near miss earns half a point and a hit a whole one", async ({ page }) => {
    const stub = await open(page, {}, "alpha beta gamma delta");
    stub.transcript = "alpha beta gamma delto";
    await recordFor(page);
    // 3 hits + 1 near of 4 script words = (3 + 0.5) / 4
    await expect(page.locator("#score-big")).toHaveText("88%");
    await expect(page.locator("#diff-text span.hit")).toHaveCount(3);
    await expect(page.locator("#diff-text span.near")).toHaveText("delta");
    await expect(page.locator("#diff-text span.extra")).toHaveText("delto");
    await expect(page.locator("#score-desc")).toHaveText("Great job!");
  });

  test("the classes change at 80% and 55%", async ({ page }) => {
    const stub = await open(page, {}, "apple banana cherry dragon elder");
    const cases: [string, string, string, string][] = [
      ["apple banana cherry dragon", "80%", "Great job!", "great"],
      ["apple banana cherry", "60%", "Keep practicing", "ok"],
      ["apple banana", "40%", "Needs work", "poor"],
    ];
    for (const [transcript, score, desc, cls] of cases) {
      stub.transcript = transcript;
      await recordFor(page);
      await expect(page.locator("#score-big")).toHaveText(score);
      await expect(page.locator("#score-desc")).toHaveText(desc);
      await expect(page.locator("#sec-score-0")).toHaveClass(new RegExp(`show ${cls}`));
      await page.locator("#retry-btn").click();
      await expect(status(page)).toHaveText(/recording|listening/);
      await page.locator("#record-btn").click(); // stop the retry's recording
      await expect(page.locator("#score-big")).not.toHaveText("—");
    }
  });

  test("the transcript is shown as text, not as markup", async ({ page }) => {
    const stub = await open(page);
    stub.transcript = "<b>bold</b> & more";
    await recordFor(page);
    await expect(page.locator("#transcript-raw strong")).toHaveText("<b>bold</b> & more");
    await expect(page.locator("#transcript-raw b")).toHaveCount(0);
    await expect(page.locator("#diff-text b")).toHaveCount(0);
  });

  test("an empty transcript says (no transcript) and leaves no score", async ({ page }) => {
    await open(page, { transcript: "   " });
    await recordFor(page);
    await expect(status(page)).toHaveText("(no transcript)");
    await expect(page.locator("#fb-score")).toBeHidden();
    await expect(page.locator("#feedback-hint")).toBeVisible();
    await expect(page.locator("#record-btn")).toHaveText("🎙 Record");
    await expect(page.locator("#sec-score-0")).not.toHaveClass(/show/);
  });

  test("Stop switches the button and the status while recording", async ({ page }) => {
    await open(page, { transcript: "hello" });
    await page.locator("#record-btn").click();
    await expect(page.locator("#record-btn")).toHaveText("⏹ Stop");
    await expect(page.locator("#record-btn")).toHaveClass(/recording/);
    await expect(status(page)).toHaveText("● recording…");
    await expect(status(page)).toHaveClass(/listening/);
    await page.locator("#record-btn").click();
    await expect(page.locator("#record-btn")).toHaveText("🎙 Record");
  });

  test("Retry clears the result and starts a new recording", async ({ page }) => {
    await open(page, { transcript: "hello world" });
    await recordFor(page);
    await expect(page.locator("#retry-btn")).toBeVisible();
    await page.locator("#retry-btn").click();
    await expect(page.locator("#record-btn")).toHaveText("⏹ Stop");
    await expect(status(page)).toHaveText(/recording|listening/); // Stop works only once the mic is open
    await expect(page.locator("#fb-score")).toBeHidden();
    await expect(page.locator("#retry-btn")).toBeHidden();
    await expect(page.locator("#feedback-hint")).toBeVisible();
    await page.locator("#record-btn").click();
    await expect(page.locator("#retry-btn")).toBeVisible();
  });

  test("recognition that fails keeps the recording and resets the button", async ({ page }) => {
    const stub = await open(page, { sttStatus: 500 });
    await recordFor(page);
    await expect.poll(() => stub.sttCalls).toBe(1);
    // the legacy panel writes "MLX failed (recording saved) → record again" and clears it
    // again in the same step (resetRecordBtn), so nothing is left on screen
    await expect(status(page)).toHaveText("");
    await expect(status(page)).not.toHaveClass(/processing|listening/);
    await expect(page.locator("#record-btn")).toHaveText("🎙 Record");
    await expect(page.locator("#rec-audio")).toHaveClass(/show/);
    await expect(page.locator("#fb-score")).toBeHidden();
  });

  test("without the local speech server it listens through the browser instead", async ({
    page,
  }) => {
    const stub = await open(page, { mlxUp: false });
    await page.locator("#record-btn").click();
    await expect(page.locator("#record-btn")).toHaveText("⏹ Stop");
    await expect(status(page)).toHaveText("● listening…");
    await page.waitForTimeout(400);
    await page.locator("#record-btn").click();
    // no browser transcript in headless Chrome → nothing to score, but the take is kept
    await expect(status(page)).toHaveText("(no transcript)");
    await expect(page.locator("#rec-audio")).toHaveClass(/show/);
    expect(stub.sttCalls).toBe(0);
  });

  test("a denied microphone is reported and the button recovers", async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException("denied", "NotAllowedError"));
    });
    const stub = await open(page);
    await page.locator("#record-btn").click();
    await expect.poll(() => stub.dialogs.length).toBe(1);
    expect(stub.dialogs[0]).toBe("Mic access denied.");
    await expect(page.locator("#record-btn")).toHaveText("🎙 Record");
    await expect(page.locator("#record-btn")).not.toHaveClass(/recording/);
    await expect(status(page)).toHaveText("");
  });

  test("the score badge belongs to the slide that was recorded", async ({ page }) => {
    const stub = await open(page);
    await page.locator(".sec-item").nth(1).click();
    stub.transcript = await script(page);
    await recordFor(page);
    await expect(page.locator("#sec-score-1")).toHaveText("100%");
    await expect(page.locator("#sec-score-0")).toHaveText("");
  });
});

test.describe("recording takes", () => {
  test("each recording is kept as a numbered take that can be replayed", async ({ page }) => {
    await open(page, { transcript: "hello" });
    await recordFor(page);
    await expect(page.locator("#rec-audio")).toHaveClass(/show/);
    await expect(page.locator("#rec-audio")).toHaveAttribute("src", /^blob:/);
    await expect(options(page, "rec-history-select")).toHaveCount(1);
    await expect(options(page, "rec-history-select").first()).toHaveText(/^take 1 · .+$/);
    await page.waitForTimeout(1100); // takes are keyed by their second
    await page.locator("#retry-btn").click();
    await expect(status(page)).toHaveText(/recording|listening/); // Stop works only once the mic is open
    await page.waitForTimeout(400);
    await page.locator("#record-btn").click();
    await expect(options(page, "rec-history-select")).toHaveCount(2);
    await expect(options(page, "rec-history-select").first()).toHaveText(/^take 2 · /);
    await expect(options(page, "rec-history-select").first()).toHaveJSProperty("selected", true);
    const newest = await page.locator("#rec-audio").getAttribute("src");
    const older = await options(page, "rec-history-select").nth(1).getAttribute("value");
    await page.locator("#rec-history-select").selectOption(older as string);
    await expect(page.locator("#rec-audio")).not.toHaveAttribute("src", newest as string);
    await expect(page.locator("#rec-audio")).toHaveAttribute("src", /^blob:/);
  });

  test("the latest recording comes back with the slide after a reload", async ({ page }) => {
    await open(page, { transcript: "hello" });
    await recordFor(page);
    await expect(options(page, "rec-history-select")).toHaveCount(1);
    await load(page);
    await expect(page.locator("#rec-audio")).toHaveClass(/show/);
    await expect(options(page, "rec-history-select")).toHaveCount(1);
    await page.locator(".sec-item").nth(1).click();
    await expect(page.locator("#rec-audio")).not.toHaveClass(/show/);
    await expect(page.locator("#rec-history-select")).toBeHidden();
  });

  test("only the ten newest takes are kept", async ({ page }) => {
    await open(page, { transcript: "hello" });
    const [first] = await sectionIds(page);
    await page.evaluate(
      (key) =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.open("pronunciation-cache", 3);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction("recordings", "readwrite");
            const versions = Array.from({ length: 10 }, (_, i) => ({
              ts: 1000 + i,
              mime: "audio/webm",
              buf: new ArrayBuffer(8),
            })).reverse();
            tx.objectStore("recordings").put({ versions }, key);
            tx.oncomplete = () => resolve();
          };
        }),
      `${DECK}/${first}`,
    );
    await load(page);
    await expect(options(page, "rec-history-select")).toHaveCount(10);
    await recordFor(page);
    await expect(page.locator("#fb-score")).toBeVisible();
    await expect(options(page, "rec-history-select")).toHaveCount(10);
    await expect(options(page, "rec-history-select").first()).toHaveText(/^take 10 · /);
  });

  test("📁 Folder without a recording asks you to record first", async ({ page }) => {
    const stub = await open(page);
    await page.locator("#rec-save-btn").click();
    await expect.poll(() => stub.dialogs.length).toBe(1);
    expect(stub.dialogs[0]).toBe("No recording yet — press 🎙 Record first.");
    await expect(page.locator("#rec-save-btn")).toHaveText("📁 Folder");
    await expect(page.locator("#rec-save-btn")).toBeEnabled();
  });

  test("📁 Folder downloads the latest take where folders cannot be picked", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = undefined;
    });
    await open(page, { transcript: "hello" });
    const [first] = await sectionIds(page);
    await recordFor(page);
    await expect(page.locator("#rec-audio")).toHaveClass(/show/);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#rec-save-btn").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`^${DECK}__${first}__\\d{8}-\\d{6}\\.webm$`),
    );
    await expect(page.locator("#rec-save-btn")).toHaveText("✓ Downloaded");
    await expect(page.locator("#rec-save-btn")).toHaveText("📁 Folder", { timeout: 4000 });
  });

  test("📁 Folder writes into the picked folder under speakeasy/<deck>/<slide>", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      type Written = { path: string; size: number };
      const written: Written[] = [];
      (window as unknown as { __written: Written[] }).__written = written;
      const dir = (path: string) => ({
        queryPermission: async () => "granted",
        requestPermission: async () => "granted",
        getDirectoryHandle: async (name: string) => dir(`${path}/${name}`),
        getFileHandle: async (name: string) => ({
          createWritable: async () => {
            let size = 0;
            return {
              write: async (b: Blob) => {
                size += b.size;
              },
              close: async () => {
                written.push({ path: `${path}/${name}`, size });
              },
            };
          },
        }),
      });
      (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async () =>
        dir("");
      // a fake handle cannot be structured-cloned, so the remembered folder is not stored
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
        return put.call(this, key === "__rec_root_dir__" ? null : value, key);
      };
    });
    await open(page, { transcript: "hello" });
    const [first] = await sectionIds(page);
    await recordFor(page);
    await expect(page.locator("#rec-audio")).toHaveClass(/show/);
    await page.locator("#rec-save-btn").click();
    await expect(page.locator("#rec-save-btn")).toHaveText("✓ Saved");
    const written = await page.evaluate(
      () => (window as unknown as { __written: { path: string; size: number }[] }).__written,
    );
    expect(written).toHaveLength(1);
    expect(written[0].path).toMatch(
      new RegExp(
        `^/speakeasy/${DECK}/${first.replace(/[^a-zA-Z0-9가-힣_-]/g, "_")}/\\d{8}-\\d{6}\\.webm$`,
      ),
    );
    expect(written[0].size).toBeGreaterThan(0);
  });
});

test.describe("Export", () => {
  test("joins every slide's speech into one WAV named after the deck and speed", async ({
    page,
  }) => {
    const stub = await open(page);
    const db = await readDb(page);
    const spoken = (db.notes as { deck_id: string; content: string }[]).filter(
      (n) => n.deck_id === DECK && n.content.trim(),
    ).length;
    expect(spoken).toBeGreaterThan(0);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#export-btn").click(),
    ]);
    expect(download.suggestedFilename()).toBe(`${DECK}-1x.wav`);
    await expect(page.locator("#export-status")).toHaveText("✓ Done");
    await expect(page.locator("#export-btn")).toBeEnabled();
    expect(stub.tts).toHaveLength(spoken);
    const bytes = await (async () => {
      const path = await download.path();
      const { readFileSync } = await import("node:fs");
      return readFileSync(path);
    })();
    expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString()).toBe("WAVE");
    expect(bytes.readUInt16LE(34)).toBe(16);
    // 100 ms of speech per slide plus 1.5 s of silence between slides
    const samples = (bytes.length - 44) / 2;
    const sr = bytes.readUInt32LE(24);
    expect(samples).toBeGreaterThan(sr * 1.5 * (spoken - 1));
  });

  test("the file name carries the chosen speed", async ({ page }) => {
    await open(page);
    await page.locator("#speed-slider").fill("1.25");
    await expect(page.locator("#speed-label")).toHaveText("1.25×");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#export-btn").click(),
    ]);
    expect(download.suggestedFilename()).toBe(`${DECK}-1.25x.wav`);
  });

  test("reuses takes already generated", async ({ page }) => {
    const stub = await open(page);
    await page.locator("#listen-btn").click();
    await expect(page.locator("#section-audio")).toHaveClass(/show/);
    expect(stub.tts).toHaveLength(1);
    const before = stub.tts.length;
    await Promise.all([page.waitForEvent("download"), page.locator("#export-btn").click()]);
    await expect(page.locator("#export-status")).toHaveText("✓ Done");
    const db = await readDb(page);
    const spoken = (db.notes as { deck_id: string; content: string }[]).filter(
      (n) => n.deck_id === DECK && n.content.trim(),
    ).length;
    expect(stub.tts.length - before).toBe(spoken - 1);
  });

  test("a server error stops the export and shows the message", async ({ page }) => {
    await open(page, { ttsStatus: 500 });
    await page.locator("#export-btn").click();
    await expect(page.locator("#export-status")).toHaveText("Error: Kokoro TTS 500: boom");
    await expect(page.locator("#export-btn")).toBeEnabled();
    await expect(page.locator("#export-progress")).toBeHidden();
  });
});
