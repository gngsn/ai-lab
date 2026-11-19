import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanShape, cleanArt, artOf } from "../js/draw.js";
import { cleanDrawing } from "../js/ai.js";
import { ICONS } from "../js/icons.js";

test("keeps absolute paths inside the box and normalizes whitespace", () => {
  assert.deepEqual(cleanShape({ d: "M10 10  L190 190 Z", m: "sf" }), ["M10 10 L190 190 Z", "sf"]);
});

test("unknown mode falls back to outline", () => {
  assert.equal(cleanShape({ d: "M10 10 L20 20", m: "glow" })[1], "s");
});

test("rejects relative commands, arcs, scripts and out-of-box coordinates", () => {
  for (const d of ["m10 10 l20 20", "M10 10 A5 5 0 1 0 20 20", "M10 10 <script>", "M10 10 L400 20", "L10 10 L20 20", "M10"]) {
    assert.equal(cleanShape({ d }), null, d);
  }
});

test("turns circles and ellipses into closed paths, rejecting ones that leave the box", () => {
  const [d, m] = cleanShape({ c: [100, 100, 30], m: "d" });
  assert.match(d, /^M70 100 a30 30/); assert.equal(m, "d");
  assert.ok(cleanShape({ e: [100, 100, 40, 20] }));
  assert.equal(cleanShape({ c: [10, 10, 40] }), null);
  assert.equal(cleanShape({ c: [100, 100, 0] }), null);
});

test("cleanArt drops bad shapes, caps the count and returns null when nothing is left", () => {
  const good = { d: "M10 10 L20 20" };
  assert.equal(cleanArt([good, { d: "bad" }, good], 8).length, 2);
  assert.equal(cleanArt(Array(20).fill(good), 4).length, 4);
  assert.equal(cleanArt([{ d: "bad" }]), null);
  assert.equal(cleanArt("nope"), null);
});

test("artOf accepts drawings and icon names, else the chat bubble", () => {
  const art = [["M10 10 L20 20", "s"]];
  assert.equal(artOf(art), art);
  assert.equal(artOf("eye"), ICONS.eye);
  assert.equal(artOf("nope"), ICONS.chat);
  assert.equal(artOf(null), ICONS.chat);
});

test("cleanDrawing keeps only icons for the requested words, drops any label and caps the signage", () => {
  const raw = {
    label: "MEMORY LANE",
    signage: [{ c: [100, 100, 50], m: "sf" }],
    icons: { "brings back": [{ d: "M20 20 L180 180" }], other: [{ d: "M20 20 L30 30" }], vivid: [{ d: "bad" }] },
  };
  const out = cleanDrawing(raw, ["brings back", "vivid"]);
  assert.equal(out.signage.length, 1);
  assert.deepEqual(Object.keys(out.icons), ["brings back"]);
  assert.equal("label" in out, false);
  assert.equal(cleanDrawing({ signage: Array(9).fill({ c: [100, 100, 20] }) }, []).signage.length, 5);
  assert.deepEqual(cleanDrawing(null, ["x"]), { signage: null, icons: {} });
});
