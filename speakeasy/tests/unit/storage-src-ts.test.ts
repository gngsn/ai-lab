import { beforeEach, describe, expect, it } from "vitest";
import {
  fromStorageSrc,
  resolveStorageSourcesInHtml,
  resolveStorageSrc,
} from "../../src/lib/storage-src";

beforeEach(() => {
  (globalThis as unknown as { window: unknown }).window = {
    SUPABASE_URL: "https://x.supabase.co/",
  };
});

describe("storage-src (TypeScript)", () => {
  it("reads the path out of a supabase:// link", () => {
    expect(fromStorageSrc("supabase://slides-images/deck/a b.png")).toBe("deck/a b.png");
    expect(fromStorageSrc("supabase://slides-images//x.png")).toBe("x.png");
    expect(fromStorageSrc("https://example.com/a.png")).toBeNull();
    expect(fromStorageSrc(null)).toBeNull();
  });

  it("resolves a link to the public URL, encoding the path", () => {
    expect(resolveStorageSrc("supabase://slides-images/d/a b.png")).toBe(
      "https://x.supabase.co/storage/v1/object/public/slides-images/d/a%20b.png",
    );
    expect(resolveStorageSrc("https://keep.me/a.png")).toBe("https://keep.me/a.png");
  });

  it("rewrites every link in an HTML string to a public URL", () => {
    const html = '<img src="supabase://slides-images/d/a.png"><img src="https://keep.me/b.png">';
    expect(resolveStorageSourcesInHtml(html)).toBe(
      '<img src="https://x.supabase.co/storage/v1/object/public/slides-images/d/a.png"><img src="https://keep.me/b.png">',
    );
  });

  it("leaves links alone when there is no Supabase URL", () => {
    (globalThis as unknown as { window: unknown }).window = {};
    expect(resolveStorageSourcesInHtml('<img src="supabase://slides-images/a.png">')).toContain(
      "supabase://",
    );
  });
});
