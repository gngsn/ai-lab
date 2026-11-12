import { PICKABLE, ICON_HINTS } from "./icons.js";
import { cleanArt } from "./draw.js";

/* ---------------- Claude correction ---------------- */
export function buildPrompt(text) {
  const icons = PICKABLE.map((k) => `${k} (${ICON_HINTS[k]})`).join(", ");
  return `You are an English tutor for a Korean speaker who texts their friends in English.
They will give you either an English message they wrote (it may have mistakes) or something in Korean they want to say in English.
Correct it into natural, warm, casual texting English that keeps their meaning and vibe (keep emoji if they used one). Explain in Korean.

Their input:
"""
${text}
"""

Reply with ONLY this JSON (no other text):
{
  "reply": {
    "natural": "the best natural English version",
    "casual": "a more casual texting version, or \\"\\" if the same",
    "tips": [{"from": "phrase they wrote (\\"\\" if new)", "to": "better phrase", "why": "짧은 한국어 설명"}],
    "comment": "뉘앙스나 쓰임에 대한 한두 문장 한국어 코멘트"
  },
  "card": {
    "ko": "the same meaning as casual Korean 반말 the way they'd say it to a friend (max 45 characters)",
    "en": "same as reply.natural (max 110 characters)",
    "icon": "one of: ${icons}",
    "alt": ["up to 3 other natural ways to say it, each max 70 characters"],
    "tip": [{"t": "key expression", "d": "short English meaning, max 60 characters"}]
  }
}
Rules: tips max 5. card.alt + card.tip together max 5 items. card.tip max 3. Pick the icon whose meaning fits best.`;
}
export function cleanCard(card, fallbackEn) {
  const s = (v, n) => String(v ?? "").trim().slice(0, n);
  return {
    ko: s(card?.ko, 80) || "(한국어 문장)",
    en: s(card?.en, 160) || fallbackEn,
    icon: PICKABLE.includes(card?.icon) ? card.icon : "chat",
    alt: (Array.isArray(card?.alt) ? card.alt : []).slice(0, 3).map((a) => ({ t: s(typeof a === "string" ? a : a?.t, 110) })).filter((a) => a.t),
    tip: (Array.isArray(card?.tip) ? card.tip : []).slice(0, 3).map((a) => ({ t: s(a?.t, 60), d: s(a?.d, 90) })).filter((a) => a.t),
  };
}

/* ---------------- drawings: a signage pictogram for the whole sentence, plus a small icon per key expression ---------------- */
const DRAW_EXAMPLES = `Example "eye" (observant): [{"d":"M18 100 Q100 22 182 100 Q100 178 18 100 Z","m":"sf"},{"c":[100,100,30],"m":"s"},{"c":[100,100,9],"m":"d"},{"d":"M58 58 L46 36 M100 46 L100 22 M142 58 L154 36","m":"s"}]
Example "tea" (comfort): [{"d":"M80 64 Q68 50 80 38 Q92 26 80 12 M118 64 Q106 50 118 38 Q130 26 118 12","m":"s"},{"d":"M150 98 Q184 96 180 122 Q176 144 146 138","m":"s"},{"d":"M42 84 L158 84 L150 140 Q146 162 124 162 L76 162 Q54 162 50 140 Z","m":"sf"},{"d":"M26 180 L174 180","m":"s"}]
Example "battery" (need to rest): [{"d":"M22 58 L162 58 L162 142 L22 142 Z","m":"s"},{"d":"M162 84 L178 84 L178 116 L162 116 Z","m":"s"},{"d":"M106 70 L78 106 L104 106 L92 132 L124 92 L98 92 Z","m":"s"}]`;

export function buildDrawPrompt({ sentence, meaning, scene, words }) {
  const list = (words || []).slice(0, 5);
  return `You draw simple, friendly pictograms for an English-expression card. The style is a bold hand-drawn line icon: thick ink outlines, a few mint-filled areas, tiny solid dots for eyes or details. Think of a sign on a wall: readable at a glance, no text, no tiny details.

Canvas: 200 x 200. Keep every coordinate between 10 and 190.
Each shape is one of:
  {"d": "<path>", "m": "<mode>"}   path uses ONLY absolute commands M L Q C Z (uppercase), numbers separated by spaces
  {"c": [cx, cy, r], "m": "<mode>"}  a circle
  {"e": [cx, cy, rx, ry], "m": "<mode>"}  an ellipse
Modes: "s" = outline only, "sf" = mint fill with outline, "d" = solid ink (only for small dots or small details).
Use 3 to 7 shapes for the signage, 1 to 4 shapes for each small icon. Fewer, larger shapes beat many small ones.

${DRAW_EXAMPLES}

The sentence: "${sentence}"
${meaning ? `What it means (Korean): ${meaning}\n` : ""}${scene ? `Scene to show on the sign: ${scene}\n` : ""}Small icons are needed for: ${list.length ? list.map((w) => `"${w}"`).join(", ") : "(none)"}

Reply with ONLY this JSON:
{"label": "1 to 3 English words printed on the sign, in the spirit of a road or shop sign (e.g. MEMORY LANE, RECHARGE ZONE)", "signage": [shapes for one pictogram that captures the situation or feeling of the whole sentence], "icons": {${list.map((w) => `"${w}": [shapes]`).join(", ")}}}`;
}

export function cleanDrawing(raw, words) {
  const signage = cleanArt(raw && raw.signage, 8);
  const icons = {};
  const src = (raw && typeof raw.icons === "object" && raw.icons) || {};
  for (const w of (words || []).slice(0, 5)) {
    const art = cleanArt(src[w], 4);
    if (art) icons[w] = art;
  }
  const label = String((raw && raw.label) || "").trim().slice(0, 24).trim();
  return { signage, label, icons };
}
