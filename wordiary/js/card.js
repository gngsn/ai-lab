/* Card renderer: 1080×1350 PNG pages. A card news set is a cover plus every page of every card. */
import { fontsReady } from "./fonts.js";
import { drawArt, COL } from "./draw.js";
import { layout, balanced, drawLines, frRows } from "./text.js";
import { normalizeCard, pagesOf, SECTION_MARK } from "./cardmodel.js";

export const CW = 1080, CH = 1350;
export const F = (w, s) => `${w} ${s}px Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
export const X0 = 108, IW = 864, TOP = 104, BOT = 1238;
export const pad2 = (n) => String(n).padStart(2, "0");
const ART_MIN = 200;
const ITEM_LH = 40.3, MARK = 52, ITEM_X = X0 + MARK + 22, ITEM_W = 972 - ITEM_X - 24, ITEM_ICON = 40;

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
const scratch = () => document.createElement("canvas").getContext("2d");

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

// lays out a page without drawing it; `fits` is false when the sections would run past the bottom
function plan(ctx, page) {
  const { card, part } = page;
  const withArt = part === 1;
  const headH = headHeight(ctx, card.ko);
  const enSize = withArt ? 46 : 34, enLH = enSize * 1.3;
  const enLines = balanced(ctx, [{ text: card.en, font: F(800, enSize), color: COL.ink }], IW);
  const enH = enLines.length * enLH;
  const secs = card.sections.map((sec, i) => {
    const iconCol = sec.items.some((it) => it.art);   // one icon in a section moves every item's text to the icon column
    const items = sec.items.map((it) => {
      const lines = layout(ctx, [
        { text: it.t, font: F(800, 26), color: COL.ink },
        ...(it.d ? [{ text: " — " + it.d, font: F(400, 26), color: COL.soft }] : []),
      ], ITEM_W - (iconCol ? ITEM_ICON - 14 : 0));
      return { it, lines, h: Math.max(it.art ? ITEM_ICON + 6 : 0, lines.length * ITEM_LH) + 6 };
    });
    const h = Math.max(MARK, items.reduce((a, x) => a + x.h, 0));
    return { type: sec.type, items, iconCol, h, mt: i ? 30 : 8 };
  });
  const secsH = secs.reduce((a, x) => a + x.mt + x.h, 0);
  const avail = BOT - TOP;
  const rows = withArt ? frRows([1, 2, 2, 2], [headH, ART_MIN, enH, secsH], avail) : frRows([1, 1, 4], [headH, enH + 40, secsH], avail);
  const used = rows.reduce((a, v) => a + v, 0);
  return { headH, enLines, enH, enLH, secs, secsH, rows, withArt, fits: used <= avail + 0.5 };
}

export function measureCard(raw) {
  const ctx = scratch();
  return pagesOf(raw).map((page) => ({ part: page.part, fits: plan(ctx, page).fits }));
}

export function renderPage(page, idx) {
  const [cv, ctx] = baseCanvas();
  const { card, part, parts } = page;
  const p = plan(ctx, page);
  const sub = (idx ? `EXPRESSION ${pad2(idx)}` : "EXPRESSION") + (parts > 1 ? `  ·  ${part}/${parts}` : "");
  drawHead(ctx, sub, card.ko, idx ? pad2(idx) : "");
  let y = TOP + p.rows[0];
  if (p.withArt) {
    const size = Math.min(p.rows[1], IW);
    drawArt(ctx, (card.sign && card.sign.art) || card.icon, X0 + (IW - size) / 2, y + (p.rows[1] - size) / 2, size, 9);
    y += p.rows[1];
  }
  const enRow = p.withArt ? p.rows[2] : p.rows[1];
  drawLines(ctx, p.enLines, X0, y + (enRow - p.enH) / 2, p.enLH, IW, "center");
  y += enRow;
  ctx.save();
  rr(ctx, 40, 40, 1000, 1270, 34); ctx.clip();
  for (const sec of p.secs) {
    y += sec.mt;
    drawArt(ctx, SECTION_MARK[sec.type] || "tip", X0, y - 4, MARK, 16);
    let iy = y;
    for (const { it, lines, h } of sec.items) {
      const tx = sec.iconCol ? ITEM_X + ITEM_ICON + 10 : ITEM_X + 24;
      if (it.art) drawArt(ctx, it.art, ITEM_X, iy, ITEM_ICON, 14);
      else {
        ctx.font = F(800, 26); ctx.fillStyle = COL.ink; ctx.textBaseline = "middle";
        ctx.fillText("·", sec.iconCol ? ITEM_X + ITEM_ICON / 2 - 4 : ITEM_X + 2, iy + 20);
      }
      drawLines(ctx, lines, tx, iy, ITEM_LH, ITEM_W, "left");
      iy += h;
    }
    y += sec.h;
  }
  ctx.restore();
  return cv;
}

// kept for single-card previews and thumbnails: the first page of a card
export function renderDetail(card, idx) { return renderPage(pagesOf(card)[0], idx); }

export function renderCover(cards) {
  const [cv, ctx] = baseCanvas();
  const list = cards.map(normalizeCard);
  const headH = drawHead(ctx, "TODAY'S EXPRESSIONS", "영어로 어떻게 말할까?", String(list.length));
  const TX = X0 + 134, TW = IW - 134;
  const rows = list.map((c) => {
    const lines = layout(ctx, [{ text: c.ko, font: F(700, 33), color: COL.ink }], TW);
    const th = 26.4 + lines.length * 46.2;
    return { c, lines, th, h: Math.max(104, th) };
  });
  const total = rows.reduce((a, r) => a + r.h, 0) + 30 * (rows.length - 1);
  const areaTop = TOP + headH;
  let y = areaTop + Math.max(0, (BOT - areaTop - total) / 2);
  rows.forEach((r, i) => {
    drawArt(ctx, (r.c.sign && r.c.sign.art) || r.c.icon, X0, y + (r.h - 104) / 2, 104, 13);
    const ty = y + (r.h - r.th) / 2;
    ctx.font = F(800, 22); ctx.fillStyle = COL.soft; ctx.textBaseline = "middle";
    ctx.fillText(pad2(i + 1), TX, ty + 13);
    drawLines(ctx, r.lines, TX, ty + 26.4, 46.2, TW, "left");
    y += r.h + 30;
  });
  return cv;
}

export const toBlob = (cv) => new Promise((res) => cv.toBlob(res, "image/png"));

// cover + every page of every card, each page labelled with its card's number
export function setPages(cards) {
  return cards.flatMap((c, i) => pagesOf(c).map((page) => ({ page, idx: i + 1 })));
}
export async function renderSet(cards) {
  await fontsReady;
  const canvases = [renderCover(cards), ...setPages(cards).map(({ page, idx }) => renderPage(page, idx))];
  return Promise.all(canvases.map(toBlob));
}
