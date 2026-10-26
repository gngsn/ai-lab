import { describe, expect, it } from "vitest";
import { routeNameFor } from "../../src/lib/route-name";

describe("routeNameFor", () => {
  it.each([
    ["/", "decks"],
    ["/index", "decks"],
    ["/index.html", "decks"],
    ["/edit", "edit"],
    ["/edit.html", "edit"],
    ["/notes.html", "notes"],
    ["/script", "script"],
    ["/script.html", "script"],
    ["/script-edit", "script-edit"],
    ["/script-edit.html", "script-edit"],
    ["/pronunciation.html", "pronunciation"],
    ["/captions", "captions"],
    ["/view", "view"],
    ["/view.html", "view"],
    ["/share", "share"],
    ["/share.html", "share"],
    ["/edit/", "edit"],
  ])("%s opens %s", (path, name) => {
    expect(routeNameFor(path)).toBe(name);
  });

  it.each(["/present.html", "/edit-frame.html", "/nope", "/decks", "/a/edit"])(
    "%s is not one of ours",
    (path) => {
      expect(routeNameFor(path)).toBeNull();
    },
  );
});
