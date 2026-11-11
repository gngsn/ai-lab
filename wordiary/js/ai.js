import { PICKABLE, ICON_HINTS } from "./icons.js";

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
