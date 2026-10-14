// P0-18: supabase://slides-images/… links resolve to public storage URLs.
import { beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error — legacy JS without types
import { fromStorageSrc, resolveStorageSourcesInHtml } from "../../js/storage-src.js";

beforeEach(() => {
  (globalThis as any).window = { SUPABASE_URL: "https://x.supabase.co/" };
});

describe("storage-src", () => {
  it("reads the path out of a supabase:// link", () => {
    expect(fromStorageSrc("supabase://slides-images/deck/a b.png")).toBe("deck/a b.png");
    expect(fromStorageSrc("https://example.com/a.png")).toBeNull();
  });

  it("rewrites every link in an HTML string to a public URL", () => {
    const html = '<img src="supabase://slides-images/d/a.png"><img src="https://keep.me/b.png">';
    expect(resolveStorageSourcesInHtml(html)).toBe(
      '<img src="https://x.supabase.co/storage/v1/object/public/slides-images/d/a.png"><img src="https://keep.me/b.png">',
    );
  });

  it("leaves links alone when there is no Supabase URL", () => {
    (globalThis as any).window = {};
    expect(resolveStorageSourcesInHtml('<img src="supabase://slides-images/a.png">')).toContain("supabase://");
  });
});
