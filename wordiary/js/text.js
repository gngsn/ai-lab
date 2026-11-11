/* Canvas text layout: word tokens, greedy line breaking, balanced lines and fr-based row sizing. */

export function tokens(ctx, runs, maxW) {
  const out = [];
  for (const r of runs) {
    for (const part of r.text.split(/(\s+)/)) {
      if (!part) continue;
      const space = /^\s+$/.test(part);
      ctx.font = r.font;
      const t = { text: space ? " " : part, font: r.font, color: r.color, space };
      t.w = ctx.measureText(t.text).width;
      if (!space && t.w > maxW) {
        for (const ch of part) out.push({ text: ch, font: r.font, color: r.color, space: false, w: ctx.measureText(ch).width });
      } else out.push(t);
    }
  }
  return out;
}

export function layout(ctx, runs, maxW) {
  const toks = tokens(ctx, runs, maxW);
  const lines = []; let cur = [], w = 0;
  const flush = () => {
    while (cur.length && cur[cur.length - 1].space) w -= cur.pop().w;
    if (cur.length) lines.push({ toks: cur, w });
    cur = []; w = 0;
  };
  for (const t of toks) {
    if (t.space) { if (cur.length) { cur.push(t); w += t.w; } continue; }
    if (cur.length && w + t.w > maxW) flush();
    cur.push(t); w += t.w;
  }
  flush();
  return lines;
}

export function balanced(ctx, runs, maxW) {
  const n = layout(ctx, runs, maxW).length;
  if (n <= 1) return layout(ctx, runs, maxW);
  let lo = maxW * 0.4, hi = maxW;
  for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (layout(ctx, runs, mid).length <= n) hi = mid; else lo = mid; }
  return layout(ctx, runs, hi);
}

export function drawLines(ctx, lines, x, y, lh, maxW, align) {
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    let cx = align === "center" ? x + (maxW - line.w) / 2 : x;
    const cy = y + i * lh + lh / 2;
    for (const t of line.toks) { ctx.font = t.font; ctx.fillStyle = t.color; ctx.fillText(t.text, cx, cy); cx += t.w; }
  });
}

// distributes `total` across rows by fr weight, never giving a row less than its min
export function frRows(fr, min, total) {
  const fixed = fr.map(() => false), size = fr.map(() => 0);
  for (let pass = 0; pass <= fr.length; pass++) {
    const used = size.reduce((a, v, i) => a + (fixed[i] ? v : 0), 0);
    const frSum = fr.reduce((a, v, i) => a + (fixed[i] ? 0 : v), 0);
    if (!frSum) break;
    const unit = (total - used) / frSum;
    let changed = false;
    fr.forEach((f, i) => { if (!fixed[i] && unit * f < min[i]) { fixed[i] = true; size[i] = min[i]; changed = true; } });
    if (!changed) { fr.forEach((f, i) => { if (!fixed[i]) size[i] = unit * f; }); break; }
  }
  return size;
}
