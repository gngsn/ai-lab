/* Shown only when this view cannot save or ask Claude: an example card set and an example correction. */
import { EXAMPLES } from "./examples.js";
import { cleanCorrection } from "./correct.js";
import { defaultPicks } from "./cardmodel.js";

export const SAMPLE_SET = [
  { ko: "너 관찰력 좋다", en: "You're really observant.", icon: "eye",
    alt: [{ t: "You have a good eye.", d: "You notice details / You have good judgment." }, { t: "You're good at noticing little things." }, { t: "You catch on quickly.", d: "You understand situations quickly." }, { t: "Nothing gets past you.", d: "You notice everything. It's hard to hide things from you." }], tip: [] },
  { ko: "이틀 동안 너무 재밌었는데, 이젠 좀 쉬어야겠어", en: "The past two days have been so much fun, but I think I need to recharge now.", icon: "battery",
    alt: [], tip: [{ t: "Recharge", d: "Rest and regain your energy." }, { t: "The past two days / The last two days", d: "Both are natural ways to refer to the recent two-day period." }] },
];

const ex = EXAMPLES[1];
const version = { ...cleanCorrection(ex.reply, ex.input), instruction: "" };
export const SAMPLE_WORK = {
  id: "sample", schema: 2, status: "draft", threadId: null, createdAt: 0, input: ex.input,
  versions: [version], vi: 0, which: version.recommend, picks: defaultPicks(version), breakAt: 0,
  drawing: {
    label: "AUTUMN VIEW",
    signage: [
      ["M16 168 L72 74 L100 112 L130 70 L184 168 Z", "sf"],
      ["M58 98 L72 74 L86 98 Q72 106 58 98 Z", "s"],
      ["M116 94 L130 70 L144 94 Q130 102 116 94 Z", "s"],
      ["M140 30 a14 14 0 1 0 28 0 a14 14 0 1 0 -28 0 Z", "s"],
      ["M84 168 L84 136 L116 136 L116 168", "s"],
      ["M16 168 L184 168", "s"],
    ],
    icons: {
      "beautiful scenery": [["M24 150 L80 60 L112 106 L136 80 L176 150 Z", "sf"], ["M24 150 L176 150", "s"]],
      "I especially love how it looks in autumn": [["M100 30 C150 60 150 130 100 170 C50 130 50 60 100 30 Z", "sf"], ["M100 50 L100 180", "s"]],
    },
  },
  card: null, usedIn: [],
};
