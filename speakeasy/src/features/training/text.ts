// Pure text helpers of the pronunciation training panel (port of the helpers in
// the legacy training-panel.js, same output).

export type DiffStatus = "hit" | "extra" | "near" | "miss";
export type DiffItem = { word: string; status: DiffStatus };
export type ScoreClass = "great" | "ok" | "poor";

export function cleanForSpeech(text: unknown): string {
  return String(text)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^---\s*$/gm, "")
    .replace(/^\[Next\]\s*/gm, "Next. ")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
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

/** Align the spoken words to the script: hit / near (close spelling) / miss / extra. */
export function diffTokens(ref: string[], hyp: string[]): DiffItem[] {
  const m = ref.length;
  const n = hyp.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        ref[i - 1] === hyp[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const aligned: DiffItem[] = [];
  let i = m;
  let j = n;
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

export function scoreFromDiff(diff: DiffItem[]): number {
  const ref = diff.filter((d) => d.status !== "extra");
  if (!ref.length) return 0;
  const hits = diff.filter((d) => d.status === "hit").length;
  const nears = diff.filter((d) => d.status === "near").length;
  return Math.round(((hits + nears * 0.5) / ref.length) * 100);
}

export function scoreClass(s: number): ScoreClass {
  return s >= 80 ? "great" : s >= 55 ? "ok" : "poor";
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function engineTag(engine: string): string {
  if (engine === "supabase") return "☁️";
  if (engine === "openai") return "🌐";
  if (engine === "elevenlabs") return "🎤";
  return "🏠";
}

/** Split on sentence boundaries (then on whitespace) so each chunk fits `limit`. */
export function splitTextChunks(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > limit) {
      if (cur) {
        chunks.push(cur.trim());
        cur = "";
      }
      // Sentence itself exceeds limit — split on whitespace
      if (s.length > limit) {
        const words = s.split(/\s+/);
        for (const w of words) {
          if (`${cur} ${w}`.trim().length > limit) {
            if (cur) chunks.push(cur.trim());
            cur = w;
          } else {
            cur = cur ? `${cur} ${w}` : w;
          }
        }
      } else {
        cur = s;
      }
    } else {
      cur += s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

export function safePart(s: unknown): string {
  return String(s).replace(/[^a-zA-Z0-9가-힣_-]/g, "_");
}

export function fileStamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}
