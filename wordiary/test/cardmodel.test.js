import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCard, pagesOf, itemCount, cardFromPicks, defaultPicks } from "../js/cardmodel.js";
import { cleanCorrection } from "../js/correct.js";
import { EXAMPLES } from "../js/examples.js";

const legacy = { ko: "너 관찰력 좋다", en: "You're really observant.", icon: "eye",
  alt: [{ t: "You have a good eye.", d: "You notice details" }, "Nothing gets past you."], tip: [{ t: "observant", d: "notices things" }] };

test("old cards read as v2 with alt and tip sections", () => {
  const c = normalizeCard(legacy);
  assert.equal(c.v, 2); assert.equal(c.icon, "eye"); assert.equal(c.sign, null);
  assert.deepEqual(c.sections.map((x) => [x.type, x.items.length]), [["alt", 2], ["point", 1]]);
  assert.equal(c.sections[0].items[1].t, "Nothing gets past you.");
  assert.equal(itemCount(legacy), 3);
  assert.equal(normalizeCard(null).sections.length, 0);
});

test("a card without breakAt is one page", () => {
  assert.deepEqual(pagesOf(legacy).map((p) => [p.part, p.parts]), [[1, 1]]);
  assert.equal(pagesOf({ ...normalizeCard(legacy), breakAt: 3 }).length, 1, "break after the last item is no break");
  assert.equal(pagesOf({ ...normalizeCard(legacy), breakAt: 0 }).length, 1);
});

test("breakAt moves the remaining items, keeping their section type", () => {
  const pages = pagesOf({ ...normalizeCard(legacy), breakAt: 1 });
  assert.equal(pages.length, 2);
  assert.deepEqual(pages[0].card.sections.map((x) => [x.type, x.items.map((i) => i.t)]), [["alt", ["You have a good eye."]]]);
  assert.deepEqual(pages[1].card.sections.map((x) => [x.type, x.items.length]), [["alt", 1], ["point", 1]]);
  assert.equal(pages[1].card.en, "You're really observant.");
});

test("cardFromPicks builds sections from what was checked, with icons on points", () => {
  const version = cleanCorrection(EXAMPLES[3].reply, EXAMPLES[3].input);
  const picks = defaultPicks(version);
  assert.deepEqual(picks.points, [true, true, true]); assert.equal(picks.bonus, true);
  const drawing = { signage: [["M10 10 L20 20", "s"]], label: "DREAM BIG", icons: { "I've noticed": [["M10 10 L20 20", "s"]] } };
  const card = cardFromPicks({ version, which: "natural", picks: { ...picks, alternatives: [], other: true }, drawing });
  assert.equal(card.en, version.natural);
  assert.equal(card.ko, version.meaningKo);
  assert.deepEqual(card.sign, { art: drawing.signage, label: "DREAM BIG" });
  assert.deepEqual(card.sections.map((x) => x.type), ["point", "alt", "bonus"]);
  assert.ok(card.sections[0].items[0].art);
  assert.equal(card.sections[1].items[0].t, version.closest, "the other version becomes the first alternative");
  const closest = cardFromPicks({ version, which: "closest", picks: { points: [], alternatives: [], bonus: false }, drawing: null });
  assert.equal(closest.en, version.closest); assert.equal(closest.sections.length, 0); assert.equal(closest.sign, null);
});
