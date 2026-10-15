// P3-3: the TypeScript data layer (src/data) must behave exactly like the
// legacy repos (public/js/repo): same return values, same errors, same queries
// sent to Supabase (table, filters, payloads, RPC names), same console
// warnings. Both run against a recording fake client (support/recorder.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Call, createRecorder, respondError, respondOk } from "./support/recorder";

const { holder, fakeModule } = vi.hoisted(() => {
  const holder = { client: null as null | Record<string, unknown> };
  const fakeModule = () => ({
    supabase: new Proxy({}, { get: (_t, prop: string) => holder.client?.[prop] }),
  });
  return { holder, fakeModule };
});
vi.mock("../../public/js/supabase.js", fakeModule);
vi.mock("../../src/data/client", fakeModule);

import * as legacyAudio from "../../public/js/repo/audio-repo.js";
import * as legacyDecks from "../../public/js/repo/deck-repo.js";
import * as legacyHistory from "../../public/js/repo/history-repo.js";
import * as legacyNotes from "../../public/js/repo/notes-repo.js";
import * as legacySlides from "../../public/js/repo/slide-repo.js";
import * as legacyStorage from "../../public/js/repo/storage-repo.js";
import * as tsAudio from "../../src/data/audio";
import * as tsDecks from "../../src/data/decks";
import * as tsHistory from "../../src/data/history";
import * as tsNotes from "../../src/data/notes";
import * as tsSlides from "../../src/data/slides";
import * as tsStorage from "../../src/data/storage";

type Fn = (...args: any[]) => unknown;
type Mod = Record<string, Fn>;
const as = (m: unknown) => m as Mod;

const png = new File(["x"], "My Pic (1).PNG", { type: "image/png" });
const noType = new File(["x"], "clip.mov");
const blob = new Blob(["x"], { type: "audio/webm" });
const rows = [
  { deck_id: "d1", section_id: "a", order: 0, title: "A", content: "<section>a</section>" },
  { deck_id: "d1", section_id: "b", order: 1, content: "<section>b</section>" },
];

// [module name, legacy, ts, function, arguments]
const cases: [string, Mod, Mod, string, unknown[]][] = [
  ["decks", as(legacyDecks), as(tsDecks), "getDeck", ["d1"]],
  ["decks", as(legacyDecks), as(tsDecks), "listDecks", []],
  ["decks", as(legacyDecks), as(tsDecks), "updateTitle", ["d1", "New"]],
  ["decks", as(legacyDecks), as(tsDecks), "updateFrameHtml", ["d1", "<html>"]],
  [
    "decks",
    as(legacyDecks),
    as(tsDecks),
    "upsertDeck",
    [{ deck_id: "d1", frame_html: "<html>", title: "T" }],
  ],
  ["decks", as(legacyDecks), as(tsDecks), "deleteDeck", ["d1"]],
  ["decks", as(legacyDecks), as(tsDecks), "setShareToken", ["d1", "tok"]],
  ["decks", as(legacyDecks), as(tsDecks), "setShareToken", ["d1", null]],
  ["slides", as(legacySlides), as(tsSlides), "listByDeck", ["d1"]],
  ["slides", as(legacySlides), as(tsSlides), "getOne", ["d1", "a"]],
  ["slides", as(legacySlides), as(tsSlides), "updateContent", ["d1", "a", "<section>x</section>"]],
  ["slides", as(legacySlides), as(tsSlides), "updateMeta", ["d1", "a", { title: "Renamed" }]],
  ["slides", as(legacySlides), as(tsSlides), "updateMeta", ["d1", "a", {}]],
  ["slides", as(legacySlides), as(tsSlides), "updateMeta", ["d1", "a"]],
  ["slides", as(legacySlides), as(tsSlides), "insertSlide", [rows[0]]],
  ["slides", as(legacySlides), as(tsSlides), "insertSlide", [rows[1]]],
  ["slides", as(legacySlides), as(tsSlides), "deleteSlide", ["d1", "a"]],
  ["slides", as(legacySlides), as(tsSlides), "deleteByDeck", ["d1"]],
  ["slides", as(legacySlides), as(tsSlides), "insertSlides", [rows]],
  ["slides", as(legacySlides), as(tsSlides), "insertSlides", [[]]],
  ["slides", as(legacySlides), as(tsSlides), "reorder", ["d1", ["b", "a"]]],
  ["notes", as(legacyNotes), as(tsNotes), "listByDeck", ["d1"]],
  ["notes", as(legacyNotes), as(tsNotes), "getOne", ["d1", "a"]],
  ["notes", as(legacyNotes), as(tsNotes), "upsert", ["d1", "a", "note text"]],
  ["notes", as(legacyNotes), as(tsNotes), "upsertKeyMessage", ["d1", "a", "key"]],
  [
    "history",
    as(legacyHistory),
    as(tsHistory),
    "appendAutoSlide",
    [{ deck_id: "d1", section_id: "s1", content: "new" }],
  ],
  [
    "history",
    as(legacyHistory),
    as(tsHistory),
    "appendAutoSlide",
    [{ deck_id: "d1", section_id: "s1", content: "same content" }],
  ],
  [
    "history",
    as(legacyHistory),
    as(tsHistory),
    "appendAutoNote",
    [{ deck_id: "d1", section_id: "s1", content: "n" }],
  ],
  [
    "history",
    as(legacyHistory),
    as(tsHistory),
    "appendAutoFrame",
    [{ deck_id: "d1", content: "<f>" }],
  ],
  [
    "history",
    as(legacyHistory),
    as(tsHistory),
    "appendAutoFrame",
    [{ deck_id: "d1", content: "same content" }],
  ],
  [
    "history",
    as(legacyHistory),
    as(tsHistory),
    "appendManualBatch",
    ["d1", "v1", rows, [{ section_id: "a", content: "n" }], "<frame>"],
  ],
  [
    "history",
    as(legacyHistory),
    as(tsHistory),
    "appendManualBatch",
    ["d1", "v2", [], [], undefined],
  ],
  ["history", as(legacyHistory), as(tsHistory), "listAllHistory", ["d1"]],
  [
    "history",
    as(legacyHistory),
    as(tsHistory),
    "listAllHistory",
    ["d1", { sectionId: "s1", limit: 5 }],
  ],
  ["storage", as(legacyStorage), as(tsStorage), "uploadAsset", [png]],
  ["storage", as(legacyStorage), as(tsStorage), "uploadAsset", [noType]],
  ["storage", as(legacyStorage), as(tsStorage), "uploadAsset", [null]],
  ["storage", as(legacyStorage), as(tsStorage), "uploadImportedAsset", ["d1", "/img/a.PNG", blob]],
  ["storage", as(legacyStorage), as(tsStorage), "listAllAssets", []],
  ["storage", as(legacyStorage), as(tsStorage), "deleteAsset", ["_library/1a-pic.png"]],
  [
    "storage",
    as(legacyStorage),
    as(tsStorage),
    "copyAssetForRename",
    ["_library/1a-pic.png", "Better Name"],
  ],
  [
    "storage",
    as(legacyStorage),
    as(tsStorage),
    "copyAssetForRename",
    ["_library/1a-pic.png", "x.png"],
  ],
  [
    "storage",
    as(legacyStorage),
    as(tsStorage),
    "copyAssetForRename",
    ["_library/1a-pic.png", "pic.png"],
  ],
  ["storage", as(legacyStorage), as(tsStorage), "copyAssetForRename", ["nofolder.png", "x"]],
  [
    "storage",
    as(legacyStorage),
    as(tsStorage),
    "copyAssetForRename",
    ["_library/1a-pic.png", "   "],
  ],
  ["audio", as(legacyAudio), as(tsAudio), "getPublicUrl", ["d1/s1"]],
  ["audio", as(legacyAudio), as(tsAudio), "uploadSlideAudio", ["d1", "s1", blob]],
  ["audio", as(legacyAudio), as(tsAudio), "getSlideAudio", ["d1", "s1"]],
  ["audio", as(legacyAudio), as(tsAudio), "getSlideAudio", ["d1", "missing"]],
];

async function run(fn: Fn, args: unknown[], respond: (t: Call[]) => unknown) {
  const { client, traces } = createRecorder(respond);
  holder.client = client;
  const warnings: unknown[][] = [];
  const warn = vi.spyOn(console, "warn").mockImplementation((...a) => void warnings.push(a));
  let outcome: unknown;
  try {
    outcome = { value: await fn(...args) };
  } catch (err) {
    outcome = { threw: err instanceof Error ? err.message : err };
  }
  await new Promise((r) => setTimeout(r, 5)); // best-effort history appends
  warn.mockRestore();
  return { outcome, traces, warnings };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-02-03T04:05:06.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("data layer behaves like the legacy repos", () => {
  for (const [moduleName, legacy, port, fnName, args] of cases) {
    for (const [label, respond] of [
      ["ok", respondOk],
      ["error", respondError],
    ] as const) {
      it(`${moduleName}.${fnName}(${args.length ? "…" : ""}) · ${label}`, async () => {
        const before = await run(legacy[fnName], args, respond);
        const after = await run(port[fnName], args, respond);
        expect(after).toEqual(before);
      });
    }
  }

  it("covers every function the legacy repos export that the app uses", () => {
    const covered = new Set(cases.map(([, , , fn]) => fn));
    const unused = new Set([
      "listSlideHistory",
      "listNotesHistory",
      "listFrameHistory",
      "assetKind",
    ]);
    for (const mod of [
      legacyAudio,
      legacyDecks,
      legacyHistory,
      legacyNotes,
      legacySlides,
      legacyStorage,
    ]) {
      for (const name of Object.keys(mod)) {
        if (!unused.has(name)) expect(covered, `${name} has no case`).toContain(name);
      }
    }
  });

  it("assetKind classifies MIME types and file names the same way", () => {
    const names = [
      "image/png",
      "video/mp4",
      "audio/ogg",
      "text/plain",
      "a.WEBP",
      "b.mov",
      "c.m4a",
      "d.txt",
      "noext",
      "",
      null,
      undefined,
      "font/woff2",
      "e.woff2",
    ];
    for (const n of names) {
      expect(tsStorage.assetKind(n)).toBe(
        (legacyStorage as unknown as { assetKind: Fn }).assetKind(n),
      );
    }
  });
});
