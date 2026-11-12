/* Card renderer: 1080×1350 PNG pages (cover + one detail card per expression). */
import { fontsReady } from "./fonts.js";
import { drawIcon, drawSign, COL } from "./draw.js";
import { layout, balanced, drawLines, frRows } from "./text.js";

export const CW = 1080, CH = 1350;
export const F = (w, s) => `${w} ${s}px Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
export const X0 = 108, IW = 864, TOP = 104, BOT = 1238;
export const pad2 = (n) => String(n).padStart(2, "0");

export function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
export function baseCanvas() {
  const cv = document.createElement("canvas"); cv.width = CW; cv.height = CH;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = COL.frame; ctx.fillRect(0, 0, CW, CH);
  rr(ctx, 40, 40, 1000, 1270, 34); ctx.fillStyle = COL.mint; ctx.fill();
  return [cv, ctx];
}
export function drawHead(ctx, sub, title, badge) {
  ctx.textBaseline = "middle"; ctx.font = F(600, 22); ctx.fillStyle = COL.soft;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "2px";
  ctx.fillText(sub, X0, TOP + 13);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  const lines = layout(ctx, [{ text: title, font: F(800, 36), color: COL.ink }], IW - 100);
  drawLines(ctx, lines, X0, TOP + 36, 50.4, IW - 100, "left");
  if (badge) {
    rr(ctx, 904, TOP, 68, 68, 16); ctx.fillStyle = COL.ink; ctx.fill();
    ctx.font = F(800, 26); ctx.fillStyle = COL.mint; ctx.textAlign = "center";
    ctx.fillText(badge, 938, TOP + 35); ctx.textAlign = "left";
  }
  return Math.max(68, 36 + lines.length * 50.4);
}
export function headHeight(ctx, title) {
  return Math.max(68, 36 + layout(ctx, [{ text: title, font: F(800, 36), color: COL.ink }], IW - 100).length * 50.4);
}
export function sectionsOf(card) {
  const out = [];
  if (card.alt && card.alt.length) out.push({ type: "alt", items: card.alt });
  if (card.tip && card.tip.length) out.push({ type: "tip", items: card.tip });
  return out;
}
export function renderDetail(card, idx) {
  const [cv, ctx] = baseCanvas();
  const headH = headHeight(ctx, card.ko);
  const enLines = balanced(ctx, [{ text: card.en, font: F(800, 46), color: COL.ink }], IW);
  const enH = enLines.length * 59.8;
  const ITEM_X = X0 + 52 + 22, ITEM_W = 972 - ITEM_X - 24;
  const secs = sectionsOf(card).map((s, i) => {
    const items = s.items.map((it) => layout(ctx, [
      { text: it.t, font: F(800, 26), color: COL.ink },
      ...(it.d ? [{ text: " — " + it.d, font: F(400, 26), color: COL.soft }] : []),
    ], ITEM_W));
    const h = Math.max(48, items.reduce((a, l) => a + l.length * 40.3, 0));
    return { type: s.type, items, h, mt: i ? 32 : 8 };
  });
  const secsH = secs.reduce((a, s) => a + s.mt + s.h, 0);
  const rows = frRows([1, 2, 2, 2], [headH, 200, enH, secsH], BOT - TOP);

  drawHead(ctx, idx ? `EXPRESSION ${pad2(idx)}` : "EXPRESSION", card.ko, idx ? pad2(idx) : "");
  const artTop = TOP + rows[0];
  const size = Math.min(rows[1], IW);
  if (card.sign && card.sign.art) {
    const sh = size * 0.94, sw = Math.min(IW, sh * 1.25);
    drawSign(ctx, card.sign, X0 + (IW - sw) / 2, artTop + (rows[1] - sh) / 2, sw, sh, F);
  } else drawIcon(ctx, card.icon, X0 + (IW - size) / 2, artTop + (rows[1] - size) / 2, size, 9);
  const enTop = artTop + rows[1];
  drawLines(ctx, enLines, X0, enTop + (rows[2] - enH) / 2, 59.8, IW, "center");
  let y = enTop + rows[2];
  for (const s of secs) {
    y += s.mt;
    drawIcon(ctx, s.type, X0, y - 4, 52, 16);
    let iy = y;
    for (const lines of s.items) {
      ctx.font = F(800, 26); ctx.fillStyle = COL.ink; ctx.textBaseline = "middle";
      ctx.fillText("·", ITEM_X + 2, iy + 20);
      drawLines(ctx, lines, ITEM_X + 24, iy, 40.3, ITEM_W, "left");
      iy += lines.length * 40.3;
    }
    y += s.h;
  }
  return cv;
}
export function renderCover(cards) {
  const [cv, ctx] = baseCanvas();
  const headH = drawHead(ctx, "TODAY'S EXPRESSIONS", "영어로 어떻게 말할까?", String(cards.length));
  const TX = X0 + 134, TW = IW - 134;
  const rows = cards.map((c) => {
    const lines = layout(ctx, [{ text: c.ko, font: F(700, 33), color: COL.ink }], TW);
    const th = 26.4 + lines.length * 46.2;
    return { c, lines, th, h: Math.max(104, th) };
  });
  const total = rows.reduce((a, r) => a + r.h, 0) + 30 * (rows.length - 1);
  const areaTop = TOP + headH;
  let y = areaTop + Math.max(0, (BOT - areaTop - total) / 2);
  rows.forEach((r, i) => {
    drawIcon(ctx, (r.c.sign && r.c.sign.art) || r.c.icon, X0, y + (r.h - 104) / 2, 104, 13);
    const ty = y + (r.h - r.th) / 2;
    ctx.font = F(800, 22); ctx.fillStyle = COL.soft; ctx.textBaseline = "middle";
    ctx.fillText(pad2(i + 1), TX, ty + 13);
    drawLines(ctx, r.lines, TX, ty + 26.4, 46.2, TW, "left");
    y += r.h + 30;
  });
  return cv;
}
export const toBlob = (cv) => new Promise((res) => cv.toBlob(res, "image/png"));
export async function renderSet(cards) {
  await fontsReady;
  const canvases = [renderCover(cards), ...cards.map((c, i) => renderDetail(c, i + 1))];
  return Promise.all(canvases.map(toBlob));
}
export function miniIcon(name) {
  const cv = document.createElement("canvas"); cv.width = 80; cv.height = 80;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = COL.mint; ctx.fillRect(0, 0, 80, 80);
  drawIcon(ctx, name, 8, 8, 64, 14);
  cv.setAttribute("aria-hidden", "true");
  return cv;
}

