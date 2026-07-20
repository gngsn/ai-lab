/**
 * diff.js — word-level comparison between a reference text and a
 * transcript, with a 0–100 pronunciation score.
 */

import { escapeHtml } from "./common.js";

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function levenshtein(a, b) {
  const m = a.length,
    n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

/**
 * Align reference tokens against hypothesis tokens.
 * Each entry: {word, status: "hit" | "near" | "miss" | "extra"}.
 */
export function diffTokens(ref, hyp) {
  const m = ref.length,
    n = hyp.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        ref[i - 1] === hyp[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const aligned = [];
  let i = m,
    j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1]) {
      aligned.unshift({ word: ref[i - 1], status: "hit" });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      aligned.unshift({ word: hyp[j - 1], status: "extra" });
      j--;
    } else {
      const nearby = hyp.slice(Math.max(0, j - 3), Math.min(n, j + 3));
      const close = nearby.find(
        (w) => levenshtein(ref[i - 1], w) <= Math.ceil(ref[i - 1].length * 0.35),
      );
      aligned.unshift({ word: ref[i - 1], status: close ? "near" : "miss" });
      i--;
    }
  }
  return aligned;
}

export function scoreFromDiff(diff) {
  const ref = diff.filter((d) => d.status !== "extra");
  if (!ref.length) return 0;
  const hits = diff.filter((d) => d.status === "hit").length;
  const nears = diff.filter((d) => d.status === "near").length;
  return Math.round(((hits + nears * 0.5) / ref.length) * 100);
}

export function scoreClass(s) {
  return s >= 80 ? "great" : s >= 55 ? "ok" : "poor";
}

export function renderDiff(diff) {
  return diff
    .map(
      ({ word, status }) => `<span class="${status}">${escapeHtml(word)}</span>`,
    )
    .join(" ");
}
