import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCorrectPrompt, buildRefinePrompt, cleanCorrection, sentenceOf, CONTEXT_TURNS } from "../js/correct.js";
import { EXAMPLES } from "../js/examples.js";

test("every example reply is already clean (the prompt teaches the exact schema)", () => {
  for (const ex of EXAMPLES) {
    const c = cleanCorrection(ex.reply, ex.input);
    assert.equal(c.closest, ex.reply.closest);
    assert.equal(c.natural, ex.reply.natural);
    assert.equal(c.recommend, ex.reply.recommend);
    assert.equal(c.points.length, ex.reply.points.length);
    assert.ok(c.covered.length > 0);
  }
});

test("prompt carries the input, the examples and only the last turns of context", () => {
  const context = Array.from({ length: 9 }, (_, i) => ({ input: `msg ${i}`, sent: `sent ${i}` }));
  const p = buildCorrectPrompt({ text: "Same here and i found very interesting thing", context });
  assert.match(p, /Input: "Same here and i found very interesting thing"\nReply:$/);
  assert.match(p, /Bukhansan/);
  assert.ok(!p.includes('"msg 2"'));
  assert.ok(p.includes(`"msg ${9 - CONTEXT_TURNS}"`));
  assert.match(buildCorrectPrompt({ text: "hi", context: [] }), /### Now\nEarlier messages in this conversation: \(none\)/);
});

test("refine prompt includes the current reply and the request", () => {
  const p = buildRefinePrompt({ text: "hi", context: [], current: { closest: "Hi!" }, instruction: "더 공손하게" });
  assert.match(p, /"closest":"Hi!"/);
  assert.match(p, /"더 공손하게"/);
});

test("falls back to the input and drops natural when it repeats closest", () => {
  const c = cleanCorrection({ natural: "Hi there!" }, "hi there");
  assert.equal(c.closest, "Hi there!");
  assert.equal(c.natural, "");
  assert.equal(c.recommend, "closest");
  assert.equal(cleanCorrection(null, "  raw  ").closest, "raw");
});

test("caps lists, drops empty items and alternatives that repeat a version", () => {
  const c = cleanCorrection({
    closest: "A.", natural: "B.",
    points: [...Array(7)].map((_, i) => ({ en: `p${i}`, ko: "뜻" })).concat([{ en: "" }]),
    alternatives: [{ en: "a." }, { en: "C.", ko: "씨" }, { en: "b." }, "junk"],
    bonus: { en: "" }, recommend: "whatever",
  }, "x");
  assert.equal(c.points.length, 5);
  assert.deepEqual(c.alternatives, [{ en: "C.", ko: "씨" }]);
  assert.equal(c.bonus, null);
  assert.equal(c.recommend, "natural");
});

test("sentenceOf picks natural only when it exists", () => {
  assert.equal(sentenceOf({ closest: "A", natural: "B" }, "natural"), "B");
  assert.equal(sentenceOf({ closest: "A", natural: "" }, "natural"), "A");
  assert.equal(sentenceOf({ closest: "A", natural: "B" }, "closest"), "A");
});
