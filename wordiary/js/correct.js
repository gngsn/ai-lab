/* Correction v2: one reply carries everything the result screen shows, in the order the user reads it. */
import { EXAMPLES } from "./examples.js";

export const CONTEXT_TURNS = 6;

const SCHEMA = `{
  "closest": "the input fixed as little as possible: keep every idea, the order and the vibe; fix grammar and wording; keep or add a fitting emoji",
  "natural": "a more natural way a native speaker would text the same thing, or \\"\\" if closest is already the most natural",
  "meaningKo": "what the message says, in casual Korean 반말 the way they'd say it to a friend",
  "points": [{"en": "key expression used in your version", "ko": "한국어 뜻", "note": "왜 이렇게 고쳤는지 / 원래 표현과 비교 (짧게, 필요할 때만)"}],
  "alternatives": [{"en": "another natural way to say it", "ko": "한국어 뜻"}],
  "bonus": {"en": "one related word or phrase worth learning here", "ko": "한국어 뜻"} or null,
  "recommend": "closest" or "natural",
  "recommendWhy": "어느 버전이 이 상황에 왜 좋은지, 친구에게 말하듯 한 문장 + 이모지",
  "covered": ["each idea in their input, in Korean, a few words each"],
  "assumed": "the input was cut off or unclear: say in Korean how you read it; otherwise \\"\\"",
  "scene": "a short English description of one simple pictogram that shows the situation or feeling"
}`;

const RULES = `Rules:
- Keep EVERYTHING they meant to say. Never drop an idea, a place, a time or a feeling. Every item in "covered" must appear in "closest".
- Korean words or names inside an English message become English: places in romanization (북한산 → Bukhansan), other words translated.
- If the input is in Korean, "closest" is the most direct natural English for it.
- Use the earlier messages to understand what they mean (who "it" is, what "same here" answers), but correct only the new input.
- If the input stops mid-sentence, finish only what is clearly meant and explain it in "assumed".
- Explanations are Korean 반말, short and warm, like a friend who is good at English. Emoji sparingly (🥹 ☀️ 🍂 😊).
- points: 1 to 5. alternatives: 0 to 3. Leave alternatives empty when natural already covers it.
- Never put the same sentence in closest and natural.`;

function contextBlock(context) {
  const turns = (context || []).filter((t) => t && (t.input || t.sent)).slice(-CONTEXT_TURNS);
  if (!turns.length) return "Earlier messages in this conversation: (none)";
  return "Earlier messages in this conversation (oldest first):\n" + turns.map((t, i) =>
    `${i + 1}. they wrote: ${JSON.stringify(t.input || "")}${t.sent ? `\n   version they picked: ${JSON.stringify(t.sent)}` : ""}`).join("\n");
}

function examplesBlock() {
  return EXAMPLES.map((ex, i) => `### Example ${i + 1}
${contextBlock(ex.context)}
Input: ${JSON.stringify(ex.input)}
Reply:
${JSON.stringify(ex.reply)}`).join("\n\n");
}

export function buildCorrectPrompt({ text, context }) {
  return `You are an English tutor for a Korean speaker who texts friends in English. They send you what they wrote (it may have mistakes, may be cut off, may mix Korean) or something in Korean they want to say. Help them say exactly what they mean.

${RULES}

Reply with ONLY one JSON object in this shape:
${SCHEMA}

${examplesBlock()}

### Now
${contextBlock(context)}
Input: ${JSON.stringify(text)}
Reply:`;
}

export function buildRefinePrompt({ text, context, current, instruction }) {
  return `You are an English tutor for a Korean speaker who texts friends in English. You already corrected their message; now they want it adjusted.

${RULES}
- Apply their request to both versions. Keep everything else they meant.

Reply with ONLY one JSON object in this shape:
${SCHEMA}

${contextBlock(context)}
Their original input: ${JSON.stringify(text)}
Your current reply: ${JSON.stringify(current)}
Their request (may be Korean): ${JSON.stringify(instruction)}
Reply:`;
}

/* ---------- validation (pure) ---------- */
const str = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n).trim();
const list = (v, max, fn) => (Array.isArray(v) ? v : []).map(fn).filter(Boolean).slice(0, max);

export function cleanCorrection(raw, input) {
  const r = raw && typeof raw === "object" ? raw : {};
  const closest = str(r.closest, 400) || str(r.natural, 400) || str(input, 400);
  let natural = str(r.natural, 400);
  if (natural.toLowerCase() === closest.toLowerCase()) natural = "";
  const pair = (p) => {
    const en = str(p && (p.en ?? p.t), 120);
    return en ? { en, ko: str(p.ko ?? p.d, 120) } : null;
  };
  const bonus = pair(r.bonus);
  return {
    closest,
    natural,
    meaningKo: str(r.meaningKo, 200),
    points: list(r.points, 5, (p) => { const b = pair(p); return b && { ...b, note: str(p.note, 160) }; }),
    alternatives: list(r.alternatives, 3, pair).filter((a) => a.en.toLowerCase() !== closest.toLowerCase() && a.en.toLowerCase() !== natural.toLowerCase()),
    bonus,
    recommend: natural && r.recommend !== "closest" ? "natural" : "closest",
    recommendWhy: str(r.recommendWhy, 200),
    covered: list(r.covered, 8, (c) => str(c, 40) || null),
    assumed: str(r.assumed, 200),
    scene: str(r.scene, 160),
  };
}

// the sentence the user picked from a version
export function sentenceOf(version, which) {
  return (which === "natural" && version.natural) ? version.natural : version.closest;
}
