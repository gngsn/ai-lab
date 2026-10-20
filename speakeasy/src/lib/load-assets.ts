// Loads the classic stylesheets and scripts a page needs, in the order its
// old HTML listed them. A stylesheet that fails (blocked, offline) must not
// stop the page, so both load and error resolve.

export function loadStylesheet(href: string, options: { media?: string; wait?: boolean } = {}) {
  return new Promise<void>((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    if (options.media) link.media = options.media;
    document.head.appendChild(link);
    if (options.wait === false) resolve();
    else {
      link.addEventListener("load", () => resolve(), { once: true });
      link.addEventListener("error", () => resolve(), { once: true });
    }
  });
}

export function loadScript(src: string) {
  return new Promise<void>((resolve) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => resolve(), { once: true });
    document.head.appendChild(script);
  });
}
