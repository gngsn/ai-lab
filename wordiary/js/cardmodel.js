/* Card data model (pure). One expression = one card; a long card can be split by the user into two pages.
   v2 card: { v: 2, ko, en, sign: { art } | null, icon, sections: [{ type, items: [{ t, d, art? }] }], breakAt? }
   breakAt counts items: the first `breakAt` items stay on page 1, the rest move to page 2. */

export const SECTION_TYPES = ["point", "alt", "bonus"];
export const SECTION_MARK = { point: "tip", alt: "alt", bonus: "star" };

const s = (v, n) => String(v ?? "").trim().slice(0, n);

// old cards ({ko, en, icon, alt, tip}) read as v2 without rewriting stored data
export function normalizeCard(card) {
  if (!card || typeof card !== "object") return { v: 2, ko: "", en: "", sign: null, icon: "chat", sections: [] };
  if (card.v === 2) return card;
  const sections = [];
  const alt = (Array.isArray(card.alt) ? card.alt : []).map((a) => ({ t: s(typeof a === "string" ? a : a?.t, 160), d: s(a?.d, 120) })).filter((a) => a.t);
  const tip = (Array.isArray(card.tip) ? card.tip : []).map((a) => ({ t: s(a?.t, 120), d: s(a?.d, 120) })).filter((a) => a.t);
  if (alt.length) sections.push({ type: "alt", items: alt });
  if (tip.length) sections.push({ type: "point", items: tip });
  return { v: 2, ko: s(card.ko, 120), en: s(card.en, 200), sign: card.sign && card.sign.art ? card.sign : null, icon: card.icon || "chat", sections };
}

export function itemCount(card) {
  return normalizeCard(card).sections.reduce((a, sec) => a + sec.items.length, 0);
}

// the pages a card renders to: [{ card, part, parts }]; page 2 keeps section types for items that move
export function pagesOf(raw) {
  const card = normalizeCard(raw);
  const total = itemCount(card);
  const at = Number.isInteger(card.breakAt) && card.breakAt > 0 && card.breakAt < total ? card.breakAt : 0;
  if (!at) return [{ card, part: 1, parts: 1 }];
  const first = [], second = [];
  let seen = 0;
  for (const sec of card.sections) {
    const a = [], b = [];
    for (const it of sec.items) (seen++ < at ? a : b).push(it);
    if (a.length) first.push({ type: sec.type, items: a });
    if (b.length) second.push({ type: sec.type, items: b });
  }
  return [
    { card: { ...card, sections: first }, part: 1, parts: 2 },
    { card: { ...card, sections: second }, part: 2, parts: 2 },
  ];
}

// builds the card from what the user checked on the result screen
export function cardFromPicks({ version, which, picks, drawing }) {
  const en = which === "natural" && version.natural ? version.natural : version.closest;
  const icons = (drawing && drawing.icons) || {};
  const sections = [];
  const points = version.points.filter((_, i) => picks.points?.[i]).map((p) => ({ t: p.en, d: p.ko, ...(icons[p.en] ? { art: icons[p.en] } : {}) }));
  const alts = version.alternatives.filter((_, i) => picks.alternatives?.[i]).map((a) => ({ t: a.en, d: a.ko }));
  const other = which === "natural" ? version.closest : version.natural;
  if (picks.other && other) alts.unshift({ t: other, d: "" });
  if (points.length) sections.push({ type: "point", items: points });
  if (alts.length) sections.push({ type: "alt", items: alts });
  if (picks.bonus && version.bonus) sections.push({ type: "bonus", items: [{ t: version.bonus.en, d: version.bonus.ko }] });
  return {
    v: 2,
    ko: s(version.meaningKo, 120),
    en: s(en, 200),
    sign: drawing && drawing.signage ? { art: drawing.signage } : null,
    icon: "chat",
    sections,
  };
}

// default picks: up to 3 points, the bonus, no alternatives (the card stays one page in most cases)
export function defaultPicks(version) {
  return {
    points: version.points.map((_, i) => i < 3),
    alternatives: version.alternatives.map(() => false),
    bonus: !!version.bonus,
    other: false,
  };
}
