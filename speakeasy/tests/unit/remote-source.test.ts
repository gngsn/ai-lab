import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchRemoteText,
  findRepoMedia,
  makeSelfContained,
  nameFromUrl,
  remoteFileExists,
  toRawUrl,
} from "../../src/lib/remote-source";

const RAW = "https://raw.githubusercontent.com";

describe("toRawUrl and nameFromUrl", () => {
  it.each([
    ["https://github.com/o/r/blob/main/deck/index.html", `${RAW}/o/r/main/deck/index.html`, "deck"],
    [
      "https://github.com/o/r/raw/refs/heads/feat/x/a b/deck.html",
      `${RAW}/o/r/refs/heads/feat/x/a%20b/deck.html`,
      "deck",
    ],
    ["https://github.com/o/r/tree/main", "https://github.com/o/r/tree/main", "main"],
    [
      "https://gist.github.com/someone/abcdef0123",
      "https://gist.githubusercontent.com/someone/abcdef0123/raw",
      "gist-abcdef0123",
    ],
    [`${RAW}/o/r/main/deck/index.html?token=XYZ`, `${RAW}/o/r/main/deck/index.html`, "deck"],
    [`${RAW}/o/r/refs/tags/v1/index.html`, `${RAW}/o/r/refs/tags/v1/index.html`, "r"],
    [`${RAW}/o/r/main/index.html`, `${RAW}/o/r/main/index.html`, "r"],
    [
      "https://example.com/a/b/talk.final.html",
      "https://example.com/a/b/talk.final.html",
      "talk.final",
    ],
    ["https://example.com/a/index.html", "https://example.com/a/index.html", "a"],
    ["https://example.com/", "https://example.com/", "deck"],
  ])("%s", (input, raw, name) => {
    expect(toRawUrl(input)).toBe(raw);
    expect(nameFromUrl(raw)).toBe(name);
  });

  it("trims the input and rejects what is not a URL", () => {
    expect(toRawUrl("  https://example.com/x.html  ")).toBe("https://example.com/x.html");
    expect(() => toRawUrl("nope")).toThrow();
  });
});

describe("makeSelfContained and findRepoMedia", () => {
  afterEach(() => vi.unstubAllGlobals());
  const base = `${RAW}/o/r/main/deck/index.html`;
  const html =
    '<link rel="stylesheet" href="css/a.css"><link rel=stylesheet href=\'https://fonts.googleapis.com/x.css\'>' +
    '<img src="img/a.png"><video poster="p.jpg" src="/abs/v.mp4"></video><a href="#top">t</a>' +
    "<div style=\"background:url('bg/b.png')\"></div>" +
    `<source src="${RAW}/o/r/main/deck/m/a.webm">`;

  it("inlines same-origin CSS, absolutizes URLs and lists the repo media", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          'body{background:url(../bg/c.png)} @font-face{src:url("f.woff")} i{b:url(https://x/y.png)}',
      })),
    );
    const out = await makeSelfContained(html, base);
    expect(out).toBe(
      `<style data-source="${RAW}/o/r/main/deck/css/a.css">\n` +
        `body{background:url(${RAW}/o/r/main/deck/bg/c.png)} @font-face{src:url("${RAW}/o/r/main/deck/css/f.woff")} i{b:url(https://x/y.png)}\n</style>` +
        "<link rel=stylesheet href='https://fonts.googleapis.com/x.css'>" +
        `<img src="${RAW}/o/r/main/deck/img/a.png"><video poster="${RAW}/o/r/main/deck/p.jpg" src="${RAW}/abs/v.mp4"></video>` +
        '<a href="#top">t</a>' +
        `<div style="background:url('${RAW}/o/r/main/deck/bg/b.png')"></div>` +
        `<source src="${RAW}/o/r/main/deck/m/a.webm">`,
    );
    expect(findRepoMedia(out, base)).toEqual(
      ["img/a.png", "p.jpg", "m/a.webm", "bg/c.png", "css/f.woff", "bg/b.png"].map((p) => ({
        url: `${RAW}/o/r/main/deck/${p}`,
        path: `deck/${p}`,
      })),
    );
  });

  it("leaves out html, css and js files, and files from other repos", () => {
    const page =
      `<script src="${RAW}/o/r/main/deck/app.js"></script><link href="${RAW}/o/r/main/deck/a.css">` +
      `<iframe src="${RAW}/o/r/main/deck/x.HTM"></iframe><img src="${RAW}/o/r/main/deck/ok.png">` +
      `<img src="${RAW}/other/r/main/deck/no.png"><img src="${RAW}/o/r/main/deck/ok.png">`;
    expect(findRepoMedia(page, `${RAW}/o/r/main/deck/index.html`)).toEqual([
      { url: `${RAW}/o/r/main/deck/ok.png`, path: "deck/ok.png" },
    ]);
  });

  it("finds no repo media for a non-GitHub deck", () => {
    expect(
      findRepoMedia('<img src="https://example.com/a.png">', "https://example.com/d.html"),
    ).toEqual([]);
  });

  it("keeps a stylesheet that cannot be fetched as it was", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, statusText: "" })),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await makeSelfContained('<link rel="stylesheet" href="a.css">', base);
    expect(out).toBe(`<link rel="stylesheet" href="${RAW}/o/r/main/deck/a.css">`);
  });
});

describe("fetching", () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (status: number, statusText = "") =>
    vi.fn(async () => ({ ok: status === 200, status, statusText, text: async () => "body" }));
  const GH = "https://github.com/o/r/blob/refs/heads/main/a b/c.html";

  it("returns the text and the raw URL", async () => {
    vi.stubGlobal("fetch", reply(200));
    expect(await fetchRemoteText("https://example.com/x.html")).toEqual({
      text: "body",
      url: "https://example.com/x.html",
    });
  });

  it("goes through the GitHub contents API when a token is given", async () => {
    const fetchMock = reply(200);
    vi.stubGlobal("fetch", fetchMock);
    await fetchRemoteText(GH, { token: "tok" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/o/r/contents/a%20b/c.html?ref=refs%2Fheads%2Fmain",
      { headers: { Accept: "application/vnd.github.raw", Authorization: "Bearer tok" } },
    );
  });

  it.each([
    [401, "tok", "GitHub rejected the token (401). Check that it hasn't expired and can read o/r."],
    [403, "tok", "GitHub rejected the token (403). Check that it hasn't expired and can read o/r."],
    [
      404,
      "tok",
      `Not found: ${RAW}/o/r/refs/heads/main/a%20b/c.html — check the path and branch, and that the token can read o/r.`,
    ],
    [
      404,
      "",
      `Not found: ${RAW}/o/r/refs/heads/main/a%20b/c.html — if the repository is private, add a GitHub token.`,
    ],
    [500, "", `Fetching ${RAW}/o/r/refs/heads/main/a%20b/c.html failed: 500`],
  ])("status %i (token %j) gives a readable error", async (status, token, message) => {
    vi.stubGlobal("fetch", reply(status));
    await expect(fetchRemoteText(GH, token ? { token } : {})).rejects.toThrow(message);
  });

  it("explains a blocked cross-origin fetch and a bad URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("net");
      }),
    );
    await expect(fetchRemoteText("https://example.com/x.html")).rejects.toThrow(
      "Could not fetch https://example.com/x.html. The server may not allow cross-origin requests",
    );
    await expect(fetchRemoteText("not a url")).rejects.toThrow("Not a valid URL: not a url");
    expect(await remoteFileExists("https://example.com/x.png")).toBe(false);
  });

  it("checks existence with HEAD, via the API when a token is given", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const url = `${RAW}/o/r/main/m/a b.png`;
    expect(await remoteFileExists(url)).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith(url, { method: "HEAD" });
    expect(await remoteFileExists(url, { token: "t" })).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.github.com/repos/o/r/contents/m/a%20b.png?ref=main",
      { method: "HEAD", headers: { Authorization: "Bearer t" } },
    );
  });
});
