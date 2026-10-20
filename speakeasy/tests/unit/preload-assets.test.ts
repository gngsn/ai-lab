// Expected values come from the legacy public/js/preload-assets.js.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyAssetMap,
  collectAssetUrls,
  formatBytes,
  preloadAssets,
  warmDeckAssets,
} from "../../src/lib/preload-assets";

describe("collectAssetUrls", () => {
  it("finds src, poster and CSS url() absolute URLs, once each, without #fragments", () => {
    const html = `
      <img src="https://a.test/1.png"><img src='https://a.test/1.png'>
      <video poster="https://a.test/p.jpg" src="https://a.test/v.mp4#t=0.1"></video>
      <div style="background:url(https://a.test/bg.png)"></div>
      <div style="background:url('https://a.test/q.png?x=1&amp;y=2')"></div>
      <img src="relative.png"><img src="data:image/png;base64,AAA">`;
    expect(collectAssetUrls(html)).toEqual([
      "https://a.test/1.png",
      "https://a.test/p.jpg",
      "https://a.test/v.mp4",
      "https://a.test/bg.png",
      "https://a.test/q.png?x=1&y=2",
    ]);
  });

  it("skips the font CDNs and anything that is not a URL", () => {
    expect(
      collectAssetUrls(
        '<img src="https://fonts.gstatic.com/a.woff2"><img src="https://x.fonts.googleapis.com/a"><img src="https://ok.test/a.png"><img src="http://">',
      ),
    ).toEqual(["https://ok.test/a.png"]);
  });
});

describe("applyAssetMap", () => {
  it("swaps each URL for its blob URL, also in its &amp; form, and keeps #fragments", () => {
    const map = new Map([
      ["https://a.test/v.mp4", "blob:1"],
      ["https://a.test/q.png?x=1&y=2", "blob:2"],
    ]);
    expect(
      applyAssetMap(
        '<video src="https://a.test/v.mp4#t=0.1"></video><img src="https://a.test/q.png?x=1&amp;y=2"><img src="https://a.test/q.png?x=1&y=2">',
        map,
      ),
    ).toBe('<video src="blob:1#t=0.1"></video><img src="blob:2"><img src="blob:2">');
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 KB"],
    [1536, "2 KB"],
    [1024 * 1024 - 1, "1024 KB"],
    [1024 * 1024, "1.0 MB"],
    [5.5 * 1024 * 1024, "5.5 MB"],
  ])("%d is %s", (n, text) => {
    expect(formatBytes(n)).toBe(text);
  });
});

describe("preloadAssets", () => {
  beforeEach(() => {
    let n = 0;
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => `blob:${++n}` }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const respond = (ok: boolean, size = 10) => ({
    ok,
    blob: async () => ({ size }),
  });

  it("downloads each URL with force-cache and maps it to a blob URL in blob mode", async () => {
    const fetchMock = vi.fn(async () => respond(true, 2048));
    vi.stubGlobal("fetch", fetchMock);
    const progress = vi.fn();
    const map = await preloadAssets(["https://a/1", "https://a/2"], { onProgress: progress });
    expect([...map.keys()]).toEqual(["https://a/1", "https://a/2"]);
    expect([...map.values()].every((v) => v.startsWith("blob:"))).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://a/1", { cache: "force-cache" });
    expect(progress).toHaveBeenLastCalledWith({ done: 2, total: 2, bytes: 4096 });
  });

  it("only warms the cache in warm mode: an empty map", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond(true)),
    );
    const map = await preloadAssets(["https://a/1"], { mode: "warm" });
    expect(map.size).toBe(0);
  });

  it("skips what cannot be fetched and still reports it as done", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/bad")) throw new TypeError("cors");
        return respond(!url.endsWith("/404"));
      }),
    );
    const progress = vi.fn();
    const map = await preloadAssets(["https://a/ok", "https://a/bad", "https://a/404"], {
      onProgress: progress,
    });
    expect([...map.keys()]).toEqual(["https://a/ok"]);
    expect(progress).toHaveBeenLastCalledWith({ done: 3, total: 3, bytes: 10 });
  });

  it("runs at most `concurrency` downloads at once (4 by default)", async () => {
    let active = 0;
    let peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return respond(true);
      }),
    );
    await preloadAssets(Array.from({ length: 12 }, (_, i) => `https://a/${i}`));
    expect(peak).toBe(4);
  });

  it("returns at once for no URLs", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await preloadAssets([])).size).toBe(0);
  });
});

describe("warmDeckAssets", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("warms every asset of the frame and the slides", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => ({ size: 1 }) }));
    vi.stubGlobal("fetch", fetchMock);
    await warmDeckAssets({ frame_html: '<link><img src="https://f.test/frame.png">' }, [
      { content: '<img src="https://s.test/one.png">' },
      { content: '<img src="https://s.test/one.png"><img src="https://s.test/two.png">' },
    ]);
    expect(fetchMock.mock.calls.map((c) => (c as unknown[])[0]).sort()).toEqual([
      "https://f.test/frame.png",
      "https://s.test/one.png",
      "https://s.test/two.png",
    ]);
  });
});
