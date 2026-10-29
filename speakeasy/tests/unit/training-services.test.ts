// The training panel's services in TypeScript (src/features/training): requests to the TTS / speech
// servers, the take histories and the recordings folder. The browser is replaced by fakes; the e2e
// spec p6-3-training-panel covers the same code end to end.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyValueStore, StoreName } from "../../src/features/training/db";
import {
  canPickFolder,
  createRecordingFolder,
  downloadRecording,
} from "../../src/features/training/folder";
import { mlxReachable, transcribeBlob } from "../../src/features/training/stt";
import { createTakes, type RecVersion } from "../../src/features/training/takes";
import { synthesizeSpeech } from "../../src/features/training/tts";

type Call = { url: string; init: RequestInit };
let calls: Call[];
let globals: Record<string, unknown>;

function reply(status = 200, body: BodyInit = "audio", type = "audio/mpeg") {
  return () => Promise.resolve(new Response(body, { status, headers: { "content-type": type } }));
}
function fakeFetch(handler: (c: Call) => Promise<Response> = reply()) {
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    return handler(call);
  });
}

beforeEach(() => {
  calls = [];
  globals = {};
  vi.stubGlobal("window", globals);
  fakeFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const body = (c: Call) => JSON.parse(c.init.body as string);
const headers = (c: Call) => c.init.headers as Record<string, string>;

describe("synthesizeSpeech", () => {
  it("asks the local Kokoro server by default, with the configured voice and speed", async () => {
    const blob = await synthesizeSpeech("kokoro", "Hello there", 1.25);
    expect(await blob.text()).toBe("audio");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:8880/v1/audio/speech");
    expect(calls[0].init.method).toBe("POST");
    expect(headers(calls[0])).toEqual({ "Content-Type": "application/json" });
    expect(body(calls[0])).toEqual({
      model: "kokoro",
      input: "Hello there",
      voice: "af_heart",
      response_format: "mp3",
      speed: 1.25,
    });
  });

  it("reads server, model and voice from the page's config", async () => {
    Object.assign(globals, {
      KOKORO_TTS_URL: "http://tts.local/speak",
      KOKORO_TTS_MODEL: "k2",
      KOKORO_VOICE: "bf_emma",
    });
    await synthesizeSpeech("kokoro", "Hi", 1);
    expect(calls[0].url).toBe("http://tts.local/speak");
    expect(body(calls[0])).toMatchObject({ model: "k2", voice: "bf_emma" });
  });

  it("treats an unknown engine as the local one", async () => {
    await synthesizeSpeech("anything", "Hi", 1);
    expect(calls[0].url).toBe("http://localhost:8880/v1/audio/speech");
  });

  it("reports a failed Kokoro call with its status and body", async () => {
    fakeFetch(reply(500, "boom", "text/plain"));
    await expect(synthesizeSpeech("kokoro", "Hi", 1)).rejects.toThrow("Kokoro TTS 500: boom");
  });

  it("falls back to the status text when the error body cannot be read", async () => {
    fakeFetch(() =>
      Promise.resolve({
        ok: false,
        status: 503,
        statusText: "Unavailable",
        text: () => Promise.reject(new Error("x")),
      } as unknown as Response),
    );
    await expect(synthesizeSpeech("kokoro", "Hi", 1)).rejects.toThrow(
      "Kokoro TTS 503: Unavailable",
    );
  });

  it("OpenAI needs its key, then sends tts-1 / alloy with the speed", async () => {
    await expect(synthesizeSpeech("openai", "Hi", 1)).rejects.toThrow(
      "OPENAI_API_KEY not set in config.local.js",
    );
    expect(calls).toHaveLength(0);
    globals.OPENAI_API_KEY = "sk-test";
    await synthesizeSpeech("openai", "Hi", 0.9);
    expect(calls[0].url).toBe("https://api.openai.com/v1/audio/speech");
    expect(headers(calls[0])).toEqual({
      Authorization: "Bearer sk-test",
      "Content-Type": "application/json",
    });
    expect(body(calls[0])).toEqual({ model: "tts-1", voice: "alloy", input: "Hi", speed: 0.9 });
  });

  it("reports an OpenAI error with its label", async () => {
    globals.OPENAI_API_KEY = "sk-test";
    fakeFetch(reply(401, "no", "text/plain"));
    await expect(synthesizeSpeech("openai", "Hi", 1)).rejects.toThrow("OpenAI TTS 401: no");
  });

  it("ElevenLabs needs its key, then uses the default voice and multilingual model", async () => {
    await expect(synthesizeSpeech("elevenlabs", "Hi", 1)).rejects.toThrow(
      "ELEVENLABS_API_KEY not set in config.local.js",
    );
    globals.ELEVENLABS_API_KEY = "el-key";
    await synthesizeSpeech("elevenlabs", "Hi", 1.1);
    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM");
    expect(headers(calls[0])).toEqual({
      "xi-api-key": "el-key",
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    });
    expect(body(calls[0])).toEqual({
      text: "Hi",
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1.1 },
    });
  });

  it("uses the configured ElevenLabs voice and labels its errors", async () => {
    Object.assign(globals, { ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID: "voice9" });
    fakeFetch(reply(429, "slow down", "text/plain"));
    await expect(synthesizeSpeech("elevenlabs", "Hi", 1)).rejects.toThrow(
      "ElevenLabs 429: slow down",
    );
    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice9");
  });

  it("splits a long script into pieces of at most 4000 characters and joins them", async () => {
    class FakeAudioContext {
      async decodeAudioData() {
        const data = new Float32Array(4);
        return { sampleRate: 8000, length: 4, getChannelData: () => data };
      }
      close() {}
    }
    globals.AudioContext = FakeAudioContext;
    const sentence = "This is one sentence of the long script. ";
    const text = sentence.repeat(220); // ~9000 characters
    const blob = await synthesizeSpeech("kokoro", text, 1);
    expect(calls.length).toBeGreaterThan(2);
    for (const c of calls) expect(body(c).input.length).toBeLessThanOrEqual(4000);
    expect(
      calls
        .map((c) => body(c).input)
        .join(" ")
        .replace(/\s+/g, " "),
    ).toBe(text.replace(/\s+/g, " ").trim());
    expect(blob.type).toBe("audio/wav");
  });
});

describe("transcribeBlob", () => {
  const rec = new Blob(["x"], { type: "audio/webm" });
  const json = (text?: string) =>
    reply(200, JSON.stringify(text === undefined ? {} : { text }), "application/json");

  it("sends the recording to the local MLX server as multipart form data", async () => {
    fakeFetch(json("hello there"));
    expect(await transcribeBlob("vibevoice", rec)).toBe("hello there");
    expect(calls[0].url).toBe("http://localhost:8000/v1/audio/transcriptions");
    const fd = calls[0].init.body as FormData;
    expect(fd.get("model")).toBe("mlx-community/VibeVoice-ASR-4bit");
    expect(fd.get("language")).toBe("en");
    expect((fd.get("file") as File).name).toBe("rec.webm");
    expect(calls[0].init.headers).toBeUndefined();
  });

  it("any engine but whisper goes to MLX, and a missing text is empty", async () => {
    fakeFetch(json());
    expect(await transcribeBlob("webspeech", rec)).toBe("");
    expect(calls[0].url).toContain("localhost:8000");
  });

  it("reports an MLX error status", async () => {
    fakeFetch(reply(500));
    await expect(transcribeBlob("vibevoice", rec)).rejects.toThrow("MLX STT 500");
  });

  it("Whisper needs the OpenAI key and sends whisper-1", async () => {
    await expect(transcribeBlob("whisper", rec)).rejects.toThrow("OPENAI_API_KEY not set");
    globals.OPENAI_API_KEY = "sk-test";
    fakeFetch(json("spoken"));
    expect(await transcribeBlob("whisper", rec)).toBe("spoken");
    const last = calls[calls.length - 1];
    expect(last.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(last.init.headers).toEqual({ Authorization: "Bearer sk-test" });
    expect((last.init.body as FormData).get("model")).toBe("whisper-1");
  });

  it("reports a Whisper error status", async () => {
    globals.OPENAI_API_KEY = "sk-test";
    fakeFetch(reply(401));
    await expect(transcribeBlob("whisper", rec)).rejects.toThrow("Whisper 401");
  });
});

describe("mlxReachable", () => {
  it("asks the server's /v1/models and counts any answer as up", async () => {
    fakeFetch(reply(404));
    expect(await mlxReachable()).toBe(true);
    expect(calls[0].url).toBe("http://localhost:8000/v1/models");
  });

  it("derives the address from a configured transcription URL", async () => {
    globals.MLX_STT_URL = "http://gpu.box:9100/v1/audio/transcriptions";
    await mlxReachable();
    expect(calls[0].url).toBe("http://gpu.box:9100/v1/models");
  });

  it("is false when the connection fails", async () => {
    fakeFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect(await mlxReachable()).toBe(false);
  });

  it("gives up after 1.5 seconds of silence", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });
    let result: boolean | undefined;
    const pending = mlxReachable().then((r) => {
      result = r;
    });
    await vi.advanceTimersByTimeAsync(1400);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(result).toBe(false);
  });
});

function mapStore() {
  const data = new Map<string, unknown>();
  const store: KeyValueStore = {
    async get<T>(key: string, name: StoreName = "audio") {
      return (data.get(`${name}:${key}`) as T) ?? null;
    },
    async put(key: string, value: unknown, name: StoreName = "audio") {
      data.set(`${name}:${key}`, value);
    },
  };
  return { data, store };
}

describe("take histories", () => {
  const blobOf = (text: string, type = "audio/mpeg") => new Blob([text], { type });
  function setup() {
    const { data, store } = mapStore();
    let clock = 1000;
    const synthesize = vi.fn(async (_e: string, text: string) => blobOf(`speech:${text}`));
    const takes = createTakes("deck1", {
      store,
      synthesize,
      hash: async (t) => `h(${t})`,
      now: () => clock++,
    });
    return { data, store, synthesize, takes, tick: (n: number) => (clock = n) };
  }
  const local = { engine: "kokoro", speed: 1 };

  it("synthesizes once and stores the take under deck/section in the history store", async () => {
    const { takes, synthesize, data } = setup();
    const { version, reused, hist } = await takes.getOrCreateVersion("s1", "Hello", local);
    expect(reused).toBe(false);
    expect(synthesize).toHaveBeenCalledWith("kokoro", "Hello", 1);
    expect(version).toMatchObject({
      ts: 1000,
      engine: "kokoro",
      voice: "af_heart",
      textHash: "h(Hello)",
      mime: "audio/mpeg",
    });
    expect(new TextDecoder().decode(version.buf)).toBe("speech:Hello");
    expect(hist.versions).toHaveLength(1);
    expect(data.get("history:deck1/s1")).toEqual({ versions: [version] });
  });

  it("reuses the take while the text and engine are unchanged", async () => {
    const { takes, synthesize } = setup();
    await takes.getOrCreateVersion("s1", "Hello", local);
    const again = await takes.getOrCreateVersion("s1", "Hello", { engine: "kokoro", speed: 1.5 });
    expect(again.reused).toBe(true);
    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it("makes a new take when the text or the engine changes", async () => {
    const { takes, synthesize } = setup();
    await takes.getOrCreateVersion("s1", "Hello", local);
    await takes.getOrCreateVersion("s1", "Hello again", local);
    const other = await takes.getOrCreateVersion("s1", "Hello again", {
      engine: "openai",
      speed: 1,
    });
    expect(other.reused).toBe(false);
    expect(other.version.voice).toBe("");
    const eleven = await takes.getOrCreateVersion("s1", "Hello again", {
      engine: "elevenlabs",
      speed: 1,
    });
    expect(eleven.version.voice).toBe("");
    expect(synthesize).toHaveBeenCalledTimes(4);
    expect(eleven.hist.versions.map((v) => v.engine)).toEqual([
      "elevenlabs",
      "openai",
      "kokoro",
      "kokoro",
    ]);
  });

  it("forceNew synthesizes even when a take matches", async () => {
    const { takes, synthesize } = setup();
    await takes.getOrCreateVersion("s1", "Hello", local);
    await takes.getOrCreateVersion("s1", "Hello", { ...local, forceNew: true });
    expect(synthesize).toHaveBeenCalledTimes(2);
  });

  it("a take from the shared bucket matches whatever engine is selected", async () => {
    const { takes, synthesize } = setup();
    const hist = await takes.getHistory("s1");
    const remote = await takes.addRemoteVersion("s1", hist, blobOf("remote"), "deck1/s1", "Hello");
    expect(remote).toMatchObject({
      engine: "supabase",
      voice: "",
      remotePath: "deck1/s1",
      textHash: "h(Hello)",
    });
    const got = await takes.getOrCreateVersion("s1", "Hello", { engine: "elevenlabs", speed: 1 });
    expect(got.reused).toBe(true);
    expect(got.version.remotePath).toBe("deck1/s1");
    expect(synthesize).not.toHaveBeenCalled();
  });

  it("keeps the ten newest takes", async () => {
    const { takes } = setup();
    for (let i = 0; i < 12; i++) await takes.getOrCreateVersion("s1", `text ${i}`, local);
    const hist = await takes.getHistory("s1");
    expect(hist.versions).toHaveLength(10);
    expect(hist.versions[0].textHash).toBe("h(text 11)");
    expect(hist.versions[9].textHash).toBe("h(text 2)");
  });

  it("the history of one section does not leak into another deck or section", async () => {
    const { takes, store } = setup();
    await takes.getOrCreateVersion("s1", "Hello", local);
    expect((await takes.getHistory("s2")).versions).toEqual([]);
    const other = createTakes("deck2", { store });
    expect((await other.getHistory("s1")).versions).toEqual([]);
  });

  it("stores recordings newest first in their own store, ten at most", async () => {
    const { takes, data } = setup();
    for (let i = 0; i < 11; i++) await takes.saveRecording("s1", blobOf(`rec${i}`, "audio/webm"));
    const { version, hist } = await takes.saveRecording("s1", new Blob(["last"]));
    expect(version.mime).toBe("audio/webm");
    expect(hist.versions).toHaveLength(10);
    expect(hist.versions[0]).toBe(version);
    expect(data.has("recordings:deck1/s1")).toBe(true);
    expect(data.has("history:deck1/s1")).toBe(false);
    expect((await takes.getRecordings("s1")).versions).toHaveLength(10);
    expect((await takes.getRecordings("nope")).versions).toEqual([]);
  });
});

describe("recordings folder", () => {
  function fakeTree(opts: { perm?: "granted" | "prompt" | "denied" } = {}) {
    const files: { path: string; type: string; text: string }[] = [];
    const asked: string[] = [];
    const dir = (path: string): never =>
      ({
        queryPermission: async () => opts.perm ?? "granted",
        requestPermission: async () => {
          asked.push(path || "/");
          return "granted";
        },
        getDirectoryHandle: async (name: string) => dir(`${path}/${name}`),
        getFileHandle: async (name: string) => ({
          createWritable: async () => {
            let text = "";
            let type = "";
            return {
              write: async (b: Blob) => {
                text = await b.text();
                type = b.type;
              },
              close: async () => {
                files.push({ path: `${path}/${name}`, type, text });
              },
            };
          },
        }),
      }) as never;
    return { files, asked, dir };
  }
  const version = (mime: string, ts = new Date(2026, 0, 2, 3, 4, 5).getTime()): RecVersion => ({
    ts,
    mime,
    buf: new TextEncoder().encode("voice").buffer as ArrayBuffer,
  });

  it("stays silent (false) without a remembered folder unless asked to pick one", async () => {
    const { store } = mapStore();
    const folder = createRecordingFolder("deck1", store);
    expect(await folder.save("s1", version("audio/webm"), { interactive: false })).toBe(false);
    // no picker in the page either
    expect(await folder.save("s1", version("audio/webm"), { interactive: true })).toBe(false);
    expect(canPickFolder()).toBe(false);
  });

  it("picks a folder once, remembers it and writes under speakeasy/<deck>/<slide>", async () => {
    const { store, data } = mapStore();
    const tree = fakeTree();
    const picker = vi.fn(async () => tree.dir("") as never);
    globals.showDirectoryPicker = picker;
    expect(canPickFolder()).toBe(true);
    const folder = createRecordingFolder("deck 1", store);
    expect(
      await folder.save("sec/1", version("audio/webm;codecs=opus"), { interactive: true }),
    ).toBe(true);
    expect(picker).toHaveBeenCalledWith({ id: "cleartalk-recordings", mode: "readwrite" });
    expect(data.has("audio:__rec_root_dir__")).toBe(true);
    expect(tree.files).toEqual([
      {
        path: "/speakeasy/deck_1/sec_1/20260102-030405.webm",
        type: "audio/webm;codecs=opus",
        text: "voice",
      },
    ]);
    // a later silent save uses the remembered folder
    expect(
      await folder.save("sec/1", version("audio/wav", 1_800_000_000_000), { interactive: false }),
    ).toBe(true);
    expect(picker).toHaveBeenCalledTimes(1);
    expect(tree.files[1].path).toMatch(/^\/speakeasy\/deck_1\/sec_1\/\d{8}-\d{6}\.wav$/);
  });

  it("asks for permission again when the remembered folder is not granted", async () => {
    const { store } = mapStore();
    const tree = fakeTree({ perm: "prompt" });
    await store.put("__rec_root_dir__", tree.dir(""));
    const folder = createRecordingFolder("deck1", store);
    expect(await folder.save("s1", version("audio/webm"), { interactive: false })).toBe(true);
    expect(tree.asked).toEqual(["/"]);
  });

  it("downloads a take as deck__slide__stamp.webm", () => {
    const click = vi.fn();
    const anchor = { href: "", download: "", click };
    vi.stubGlobal("document", { createElement: () => anchor });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: vi.fn() });
    downloadRecording("deck1", "s1", version("audio/webm"));
    expect(anchor.href).toBe("blob:x");
    expect(anchor.download).toBe("deck1__s1__20260102-030405.webm");
    expect(click).toHaveBeenCalledOnce();
  });
});
