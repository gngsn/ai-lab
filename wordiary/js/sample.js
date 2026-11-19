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
    signage: [
      ["M20 166 L76 70 L104 110 L132 76 L180 166 Z", "sf"],
      ["M136 32 a16 16 0 1 0 32 0 a16 16 0 1 0 -32 0 Z", "s"],
      ["M20 166 L180 166", "s"],
    ],
    icons: {
      "beautiful scenery": [["M24 150 L80 60 L112 106 L136 80 L176 150 Z", "sf"], ["M24 150 L176 150", "s"]],
      "I especially love how it looks in autumn": [["M100 30 C150 60 150 130 100 170 C50 130 50 60 100 30 Z", "sf"], ["M100 50 L100 180", "s"]],
    },
  },
  card: null, usedIn: [],
};
