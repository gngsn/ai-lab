// P6-3: the training panel's pure logic in TypeScript (src/features/training).
// The expected values of cleanForSpeech, silenceWav and mergeBlobs are what the
// legacy panel (public/js/training-panel.js, since removed) produced for the
// same inputs, byte for byte for the WAV files (as SHA-1 digests); the helpers
// it kept private are pinned by hand-checked cases.
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

const { stubAudio } = vi.hoisted(() => {
  // A fake decoder: every blob "decodes" to the samples its bytes spell, so
  // mergeBlobs runs without a browser.
  (globalThis as unknown as { window: unknown }).window = globalThis;
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

const digest = async (b: Blob) =>
  createHash("sha1")
    .update(Buffer.from(await b.arrayBuffer()))
    .digest("hex");

describe("cleanForSpeech", () => {
  // [input, what the legacy panel returned]
  const cases: [string, string][] = [
    ["", ""],
    ["plain", "plain"],
    ["# Title\n## Sub\n###### six\n####### seven", "Title\nSub\nsix\n####### seven"],
    ["---\ntext\n---   \nmore", "text\nmore"],
    ["[Next] go on\n[Next]second", "Next. go on\nNext. second"],
    ["**bold** and *em* and `code` and ***both***", "bold and em and code and both"],
    ["a   \nb\n\n\n\nc\n\n\n\n\nd   ", "a\nb\nc\nd"],
    ["  padded  ", "padded"],
    ["one *two\nthree* four", "one *two\nthree* four"],
    ["x\r\ny\r\n\r\n\r\nz", "x\ny\nz"],
    ["한국어 **굵게** 와 `코드`", "한국어 굵게 와 코드"],
  ];
  for (const [input, want] of cases) {
    it(`${JSON.stringify(input)}`, () => {
      expect(cleanForSpeech(input)).toBe(want);
    });
  }
  it("coerces non-strings like the legacy", () => {
    expect(cleanForSpeech(null)).toBe("null");
    expect(cleanForSpeech(12)).toBe("12");
  });
});

describe("silenceWav", () => {
  // [seconds, sample rate, size in bytes, SHA-1 of the legacy file]
  const cases: [number, number | undefined, number, string][] = [
    [0, undefined, 44, "b8000eada705cf56630266b151564d054d3e2a06"],
    [0.5, undefined, 22094, "5f8152f49034fff563e91ed43cd01de8abc5ac4b"],
    [1.5, undefined, 66194, "61d6459f7246b9175253ef718351b39953b15750"],
    [0.001, 8000, 60, "58ee6e71a06e953e82062dddb2606be8bd4cdf10"],
    [2, 44100, 176444, "6a85dc96625ced9f7bf0d3d1ca3bad41bd1f8315"],
  ];
  for (const [sec, sr, size, sha] of cases) {
    it(`${sec}s @ ${sr ?? "default"} is byte-identical`, async () => {
      const wav = silenceWav(sec, sr);
      expect(wav.type).toBe("audio/wav");
      expect(wav.size).toBe(size);
      expect(await digest(wav)).toBe(sha);
    });
  }
  it("writes a 44-byte header plus 16-bit samples", async () => {
    const wav = new Uint8Array(await silenceWav(1, 1000).arrayBuffer());
    expect(wav.length).toBe(44 + 2000);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
  });
});

describe("mergeBlobs", () => {
  const blob = (...values: number[]) => new Blob([Uint8Array.from(values)]);
  it("joins decoded audio into the same 16-bit WAV as the legacy", async () => {
    const merged = await mergeBlobs([blob(0, 128, 255, 200), blob(100, 50), blob(128)]);
    expect(merged.type).toBe("audio/wav");
    expect(merged.size).toBe(58);
    expect(await digest(merged)).toBe("3de9ff581070bcd49aa1ceed1391e044fb80b0a9");
  });
  it("clips samples outside -1..1 the same way", async () => {
    const merged = await mergeBlobs([blob(0, 255, 128)]);
    expect(merged.size).toBe(50);
    expect(await digest(merged)).toBe("0bbc71dfd1f5f70a2056b67804dd0e996ac3fbd4");
  });
  it("fails the same way without an AudioContext", async () => {
    const saved = (globalThis as unknown as { AudioContext: unknown }).AudioContext;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = undefined;
    try {
      await expect(mergeBlobs([blob(1)])).rejects.toThrow("AudioContext not supported");
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
