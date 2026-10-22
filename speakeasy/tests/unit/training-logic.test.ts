// P6-3: the training panel's pure logic in TypeScript (src/features/training)
// against the legacy panel (public/js/training-panel.js): the exported helpers
// must give identical output, byte for byte for the WAV files. The helpers the
// legacy file keeps private are pinned by hand-checked cases.
import { beforeAll, describe, expect, it, vi } from "vitest";

const { stubAudio } = vi.hoisted(() => {
  // The legacy file reads window.* at load time.
  (globalThis as unknown as { window: unknown }).window = globalThis;
  // A fake decoder: every blob "decodes" to the samples its bytes spell, so
  // both mergeBlobs implementations see the same audio without a browser.
  class FakeAudioContext {
    async decodeAudioData(buf: ArrayBuffer) {
      const bytes = new Uint8Array(buf);
      const data = Float32Array.from(bytes, (b) => (b - 128) / 100);
      return { sampleRate: 16000, length: data.length, getChannelData: () => data };
    }
    close() {}
  }
  return {
    stubAudio: () => {
      (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    },
  };
});
vi.mock("../../public/js/repo/audio-repo.js", () => ({}));

import * as legacy from "../../public/js/training-panel.js";
import {
  cleanForSpeech,
  diffTokens,
  engineTag,
  fileStamp,
  fmtTime,
  levenshtein,
  safePart,
  scoreClass,
  scoreFromDiff,
  splitTextChunks,
  tokenize,
} from "../../src/features/training/text";
import { mergeBlobs, silenceWav } from "../../src/features/training/wav";

beforeAll(stubAudio);

const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

describe("cleanForSpeech", () => {
  const cases = [
    "",
    "plain",
    "# Title\n## Sub\n###### six\n####### seven",
    "---\ntext\n---   \nmore",
    "[Next] go on\n[Next]second",
    "**bold** and *em* and `code` and ***both***",
    "a   \nb\n\n\n\nc\n\n\n\n\nd   ",
    "  padded  ",
    "one *two\nthree* four",
    "x\r\ny\r\n\r\n\r\nz",
    "한국어 **굵게** 와 `코드`",
  ];
  for (const input of cases) {
    it(`same as the legacy for ${JSON.stringify(input)}`, () => {
      expect(cleanForSpeech(input)).toBe(legacy.cleanForSpeech(input));
    });
  }
  it("coerces non-strings like the legacy", () => {
    expect(cleanForSpeech(null)).toBe(legacy.cleanForSpeech(null));
    expect(cleanForSpeech(12)).toBe(legacy.cleanForSpeech(12));
  });
});

describe("silenceWav", () => {
  for (const [sec, sr] of [
    [0, undefined],
    [0.5, undefined],
    [1.5, undefined],
    [0.001, 8000],
    [2, 44100],
  ] as const) {
    it(`${sec}s @ ${sr ?? "default"} is byte-identical`, async () => {
      const a = silenceWav(sec, sr);
      const b = legacy.silenceWav(sec, sr);
      expect(a.type).toBe("audio/wav");
      expect(await bytesOf(a)).toEqual(await bytesOf(b));
    });
  }
  it("writes a 44-byte header plus 16-bit samples", async () => {
    const wav = await bytesOf(silenceWav(1, 1000));
    expect(wav.length).toBe(44 + 2000);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
  });
});

describe("mergeBlobs", () => {
  const blob = (...values: number[]) => new Blob([Uint8Array.from(values)]);
  it("joins decoded audio into the same 16-bit WAV as the legacy", async () => {
    const parts = [blob(0, 128, 255, 200), blob(100, 50), blob(128)];
    const a = await mergeBlobs(parts);
    const b = await legacy.mergeBlobs(parts);
    expect(a.type).toBe("audio/wav");
    expect(await bytesOf(a)).toEqual(await bytesOf(b));
  });
  it("clips samples outside -1..1 the same way", async () => {
    const parts = [blob(0, 255, 128)];
    expect(await bytesOf(await mergeBlobs(parts))).toEqual(
      await bytesOf(await legacy.mergeBlobs(parts)),
    );
  });
  it("fails the same way without an AudioContext", async () => {
    const saved = (globalThis as unknown as { AudioContext: unknown }).AudioContext;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = undefined;
    try {
      await expect(mergeBlobs([blob(1)])).rejects.toThrow("AudioContext not supported");
      await expect(legacy.mergeBlobs([blob(1)])).rejects.toThrow("AudioContext not supported");
    } finally {
      (globalThis as unknown as { AudioContext: unknown }).AudioContext = saved;
    }
  });
});

describe("tokenize", () => {
  it("lowercases, drops punctuation and keeps apostrophes and digits", () => {
    expect(tokenize("Hello, World! It's 2 o'clock.")).toEqual([
      "hello",
      "world",
      "it's",
      "2",
      "o'clock",
    ]);
  });
  it("treats non-ASCII letters as separators", () => {
    expect(tokenize("안녕 hi café")).toEqual(["hi", "caf"]);
  });
  it("returns nothing for blank text", () => {
    expect(tokenize("  \n ")).toEqual([]);
  });
});

describe("levenshtein", () => {
  it.each([
    ["", "", 0],
    ["abc", "", 3],
    ["", "abc", 3],
    ["kitten", "sitting", 3],
    ["flaw", "lawn", 2],
    ["same", "same", 0],
  ])("%s / %s = %i", (a, b, n) => {
    expect(levenshtein(a, b)).toBe(n);
  });
});

describe("diffTokens and scoring", () => {
  const diff = (ref: string, hyp: string) => diffTokens(tokenize(ref), tokenize(hyp));
  it("marks every word a hit when the speech matches", () => {
    const d = diff("the quick brown fox", "the quick brown fox");
    expect(d.map((x) => x.status)).toEqual(["hit", "hit", "hit", "hit"]);
    expect(scoreFromDiff(d)).toBe(100);
  });
  it("marks a skipped word as a miss and an added word as extra", () => {
    const d = diff("the quick brown fox", "the brown very fox");
    expect(d).toEqual([
      { word: "the", status: "hit" },
      { word: "quick", status: "miss" },
      { word: "brown", status: "hit" },
      { word: "very", status: "extra" },
      { word: "fox", status: "hit" },
    ]);
    expect(scoreFromDiff(d)).toBe(75);
  });
  it("marks a close spelling as near and gives it half credit", () => {
    const d = diff("pronunciation matters", "pronounciation matters");
    // the misspelled word stays unmatched on the speech side, so it also counts as extra
    expect(d.map((x) => x.status)).toEqual(["near", "extra", "hit"]);
    expect(scoreFromDiff(d)).toBe(75);
  });
  it("accepts a distance up to 35% of the word length, rounded up", () => {
    // "cat" allows ceil(3 * 0.35) = 2 edits: "cow" is 2 away, "dog" is 3 away
    expect(diff("cat", "cow")).toEqual([
      { word: "cat", status: "near" },
      { word: "cow", status: "extra" },
    ]);
    expect(diff("cat", "dog")).toEqual([
      { word: "cat", status: "miss" },
      { word: "dog", status: "extra" },
    ]);
  });
  it("keeps the order of the script, with extras where they were spoken", () => {
    const d = diff("a b", "x a y b z");
    expect(d.map((x) => `${x.word}:${x.status}`)).toEqual([
      "x:extra",
      "a:hit",
      "y:extra",
      "b:hit",
      "z:extra",
    ]);
  });
  it("scores 0 for an empty script", () => {
    expect(scoreFromDiff(diff("", "anything"))).toBe(0);
    expect(scoreFromDiff([])).toBe(0);
  });
  it("classes scores at 80 and 55", () => {
    expect([100, 80, 79, 55, 54, 0].map(scoreClass)).toEqual([
      "great",
      "great",
      "ok",
      "ok",
      "poor",
      "poor",
    ]);
  });
});

describe("splitTextChunks", () => {
  it("returns short text whole", () => {
    expect(splitTextChunks("short text", 100)).toEqual(["short text"]);
  });
  it("splits on sentence boundaries", () => {
    expect(splitTextChunks("One two. Three four. Five six.", 12)).toEqual([
      "One two.",
      "Three four.",
      "Five six.",
    ]);
  });
  it("splits an over-long sentence on spaces", () => {
    const chunks = splitTextChunks("aaa bbb ccc ddd eee fff", 8);
    expect(chunks).toEqual(["aaa bbb", "ccc ddd", "eee fff"]);
    expect(chunks.every((c) => c.length <= 8)).toBe(true);
  });
  it("loses no words", () => {
    const text = Array.from({ length: 80 }, (_, i) => `word${i}${i % 7 === 0 ? "." : ""}`).join(
      " ",
    );
    const chunks = splitTextChunks(text, 60);
    expect(chunks.join(" ").split(/\s+/)).toEqual(text.split(/\s+/));
  });
});

describe("file and label helpers", () => {
  it("safePart keeps ASCII letters, digits, Hangul, _ and -", () => {
    expect(safePart("a b/c.d_é-한")).toBe("a_b_c_d__-한");
  });
  it("fileStamp is yyyymmdd-hhmmss in local time", () => {
    const d = new Date(2026, 0, 2, 3, 4, 5);
    expect(fileStamp(d.getTime())).toBe("20260102-030405");
  });
  it("engineTag picks an icon per engine, local by default", () => {
    expect(["supabase", "openai", "elevenlabs", "kokoro", ""].map(engineTag)).toEqual([
      "☁️",
      "🌐",
      "🎤",
      "🏠",
      "🏠",
    ]);
  });
  it("fmtTime is a short local date and time", () => {
    const ts = new Date(2026, 0, 2, 15, 4).getTime();
    expect(fmtTime(ts)).toBe(
      new Date(ts).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
  });
});
