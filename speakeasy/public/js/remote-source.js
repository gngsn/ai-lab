// Fetch deck HTML / notes Markdown from a URL for "Import HTML deck".
//
// GitHub page links (github.com/…/blob/…, gist.github.com/…) are rewritten to
// their raw-file URLs, which allow cross-origin fetches. With a GitHub token,
// raw-file URLs are fetched through the GitHub contents API instead, so
// private repositories work too (raw.githubusercontent.com answers 404 for
// private files without a short-lived ?token=, which expires in minutes).
//
// Imported HTML is then made self-contained so it still renders once stored
// in the database:
//   - relative src/href/poster and CSS url(...) become absolute URLs
//   - <link rel="stylesheet"> files are fetched and inlined as <style>,
//     because raw.githubusercontent.com serves CSS as text/plain with
//     nosniff, which browsers refuse to apply as a stylesheet.
// Media the deck links to inside its GitHub repo (images, video, audio) is
// listed by findRepoMedia() so the importer can copy it to Supabase storage.

const RAW_HOST = "raw.githubusercontent.com";

/** Map a GitHub/Gist page URL to its raw-file URL; other URLs pass through. */
export function toRawUrl(input) {
  const url = new URL(String(input).trim());
  if (url.hostname === "github.com") {
    // /<owner>/<repo>/(blob|raw)/<ref>/<path…>
    const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/);
    if (m) {
      return `https://${RAW_HOST}/${m[1]}/${m[2]}/${m[3]}`;
    }
  }
  if (url.hostname === "gist.github.com") {
    // /<owner>/<id> → first file of the gist
    const m = url.pathname.match(/^\/([^/]+)\/([0-9a-f]+)\/?$/i);
    if (m) return `https://gist.githubusercontent.com/${m[1]}/${m[2]}/raw`;
  }
  if (url.hostname === RAW_HOST) {
    // Drop GitHub's short-lived ?token=… from private "Raw" links: it has
    // usually expired by the time it's pasted here.
    url.search = "";
  }
  return url.href;
}

/** { owner, repo, ref, path } for a raw.githubusercontent.com URL, else null.
 *  Branch names containing "/" are only recognized in the explicit
 *  refs/heads/<name> or refs/tags/<name> form GitHub's Raw button uses. */
function parseRawGitHubUrl(input) {
  const url = new URL(input);
  if (url.hostname !== RAW_HOST) return null;
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length < 4) return null;
  const [owner, repo, ...rest] = parts;
  let ref;
  if (rest[0] === "refs" && (rest[1] === "heads" || rest[1] === "tags")) {
    ref = rest.slice(0, 3).join("/");
    rest.splice(0, 3);
  } else {
    ref = rest.shift();
  }
  return { owner, repo, ref, path: rest.join("/") };
}

/** A deck-ID-friendly name from the URL: the file name, or for index.html
 *  the folder it lives in (the repo name at a GitHub repo's root). */
export function nameFromUrl(input) {
  const url = new URL(input);
  if (url.hostname === "gist.githubusercontent.com") {
    return `gist-${url.pathname.split("/")[2] || "deck"}`; // /<owner>/<id>/raw
  }
  const gh = parseRawGitHubUrl(url.href);
  const folders = (gh ? gh.path : url.pathname)
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  let name = (folders.pop() || "deck").replace(/\.[^.]+$/, "");
  if (/^index$/i.test(name)) name = folders.pop() || gh?.repo || name;
  return name;
}

/** Fetch a URL as text or Blob; raw GitHub URLs go through the API when a
 *  token is given. Errors carry a message fit to show the user. */
async function fetchRemote(url, { token = "", as = "text" } = {}) {
  const gh = parseRawGitHubUrl(url);
  const viaApi = Boolean(gh && token);
  const target = viaApi
    ? `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/` +
      `${gh.path.split("/").map(encodeURIComponent).join("/")}` +
      `?ref=${encodeURIComponent(gh.ref)}`
    : url;
  let res;
  try {
    res = await fetch(
      target,
      viaApi
        ? {
            headers: {
              Accept: "application/vnd.github.raw",
              Authorization: `Bearer ${token}`,
            },
          }
        : undefined,
    );
  } catch {
    throw new Error(
      `Could not fetch ${url}. The server may not allow cross-origin ` +
        `requests — use a GitHub/GitHub Pages link or download the file instead.`,
    );
  }
  if (!res.ok) {
    if (viaApi && (res.status === 401 || res.status === 403)) {
      throw new Error(
        `GitHub rejected the token (${res.status}). Check that it hasn't ` +
          `expired and can read ${gh.owner}/${gh.repo}.`,
      );
    }
    if (gh && res.status === 404) {
      throw new Error(
        `Not found: ${url}` +
          (token
            ? ` — check the path and branch, and that the token can read ${gh.owner}/${gh.repo}.`
            : " — if the repository is private, add a GitHub token."),
      );
    }
    const reason = [res.status, res.statusText].filter(Boolean).join(" ");
    throw new Error(`Fetching ${url} failed: ${reason}`);
  }
  return as === "blob" ? res.blob() : res.text();
}

/** Fetch text from a URL (GitHub links allowed). Returns { text, url }. */
export async function fetchRemoteText(input, { token = "" } = {}) {
  let url;
  try {
    url = toRawUrl(input);
  } catch {
    throw new Error(`Not a valid URL: ${input}`);
  }
  return { text: await fetchRemote(url, { token }), url };
}

/** Fetch a linked file (e.g. an image found by findRepoMedia) as a Blob. */
export function fetchRemoteBlob(url, { token = "" } = {}) {
  return fetchRemote(url, { token, as: "blob" });
}

/** Whether a linked file exists, without downloading it. */
export async function remoteFileExists(url, { token = "" } = {}) {
  const gh = parseRawGitHubUrl(url);
  try {
    if (gh && token) {
      // Contents metadata (no raw body) — cheap even for large videos.
      const res = await fetch(
        `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/` +
          `${gh.path.split("/").map(encodeURIComponent).join("/")}` +
          `?ref=${encodeURIComponent(gh.ref)}`,
        { method: "HEAD", headers: { Authorization: `Bearer ${token}` } },
      );
      return res.ok;
    }
    return (await fetch(url, { method: "HEAD" })).ok;
  } catch {
    return false;
  }
}

const isAbsolute = (u) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u.trim());
const resolve = (u, base) => {
  try {
    return isAbsolute(u) ? u : new URL(u.trim(), base).href;
  } catch {
    return u;
  }
};

function absolutizeCss(css, base) {
  return css.replace(
    /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
    (all, q, u) => (isAbsolute(u) ? all : `url(${q}${resolve(u, base)}${q})`),
  );
}

/** Make fetched deck HTML render from anywhere (see file header). */
export async function makeSelfContained(html, baseUrl, { token = "" } = {}) {
  // Inline stylesheets first, so their url(...) resolve against the CSS file.
  const links = [
    ...html.matchAll(/<link\b[^>]*\brel\s*=\s*["']?stylesheet["']?[^>]*>/gi),
  ];
  for (const [tag] of links) {
    const href = tag.match(/\bhref\s*=\s*(["'])([^"']+)\1/i)?.[2];
    if (!href) continue;
    const cssUrl = resolve(href, baseUrl);
    // Leave font/CDN stylesheets (Google Fonts etc.) linked — they're served
    // with proper types. Only inline ones next to the deck.
    if (new URL(cssUrl).origin !== new URL(baseUrl).origin) continue;
    try {
      const css = await fetchRemote(cssUrl, { token });
      html = html.replace(
        tag,
        `<style data-source="${cssUrl}">\n${absolutizeCss(css, cssUrl)}\n</style>`,
      );
    } catch (err) {
      console.warn("[import] could not inline stylesheet", cssUrl, err);
    }
  }

  html = html.replace(
    /\b(src|href|poster)\s*=\s*(["'])([^"']*)\2/gi,
    (all, attr, q, u) =>
      !u || isAbsolute(u) ? all : `${attr}=${q}${resolve(u, baseUrl)}${q}`,
  );
  return absolutizeCss(html, baseUrl);
}

/**
 * Media files (src / poster / CSS url) that a self-contained deck links to
 * inside the same GitHub repo as `baseUrl`. Returns [{ url, path }] where
 * `path` is the file's path in the repo — [] for non-GitHub decks.
 */
export function findRepoMedia(html, baseUrl) {
  const base = parseRawGitHubUrl(baseUrl);
  if (!base) return [];
  const prefix = `https://${RAW_HOST}/${base.owner}/${base.repo}/`;
  const urls = new Set();
  for (const m of html.matchAll(/\b(?:src|poster)\s*=\s*(["'])([^"']+)\1/gi)) {
    urls.add(m[2]);
  }
  for (const m of html.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) {
    urls.add(m[2]);
  }
  return [...urls]
    .filter((u) => u.startsWith(prefix) && !/\.(?:html?|css|js)$/i.test(u))
    .map((url) => ({ url, path: parseRawGitHubUrl(url)?.path || url }));
}
