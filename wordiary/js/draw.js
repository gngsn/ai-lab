/* Hand-drawn line geometry: every path is sampled and given a seeded, periodic wobble so closed shapes stay seamless.
   A drawing ("art") is a list of [d, mode] pairs in a 200×200 box; modes: s = line, sf = mint fill + line, d = ink fill.
   Built-in icons and drawings Claude makes share this format, so both go through the same wobble. */
import { ICONS, C, E } from "./icons.js";

export const COL = { frame: "#111111", mint: "#B9E2C9", ink: "#2E2E2E", soft: "#4A4A4A" };

export function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function hash(str) { let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

/* ---------- validating drawings Claude returns (pure, no DOM) ---------- */
const MODES = new Set(["s", "sf", "d"]);
const PATH_OK = /^M[\d\s.,MLHVCSQTZ-]*$/;
const inBox = (v) => Number.isFinite(v) && v >= -4 && v <= 204;

// one raw shape: {d, m} | {c:[cx,cy,r], m} | {e:[cx,cy,rx,ry], m}  ->  [d, mode] or null
export function cleanShape(raw) {
  if (!raw || typeof raw !== "object") return null;
  const mode = MODES.has(raw.m) ? raw.m : "s";
  if (Array.isArray(raw.c) && raw.c.length === 3) {
    const [cx, cy, r] = raw.c.map(Number);
    if (![cx, cy].every(inBox) || !(r >= 2 && r <= 100) || !inBox(cx - r) || !inBox(cx + r) || !inBox(cy - r) || !inBox(cy + r)) return null;
    return [C(cx, cy, r), mode];
  }
  if (Array.isArray(raw.e) && raw.e.length === 4) {
    const [cx, cy, rx, ry] = raw.e.map(Number);
    if (![cx, cy].every(inBox) || !(rx >= 2 && rx <= 100 && ry >= 2 && ry <= 100) || !inBox(cx - rx) || !inBox(cx + rx) || !inBox(cy - ry) || !inBox(cy + ry)) return null;
    return [E(cx, cy, rx, ry), mode];
  }
  const d = typeof raw.d === "string" ? raw.d.trim().replace(/\s+/g, " ") : "";
  if (!d || d.length > 700 || !PATH_OK.test(d)) return null;
  const nums = d.match(/-?\d*\.?\d+/g) || [];
  if (nums.length < 2 || nums.length > 160 || !nums.map(Number).every(inBox)) return null;
  return [d, mode];
}

export function cleanArt(list, max = 8) {
  if (!Array.isArray(list)) return null;
  const out = list.slice(0, max * 2).map(cleanShape).filter(Boolean).slice(0, max);
  return out.length ? out : null;
}

// a card's art may be a built-in icon name or a drawing; anything else falls back to the chat bubble
export function artOf(v) {
  if (Array.isArray(v) && v.length) return v;
  if (typeof v === "string" && ICONS[v]) return ICONS[v];
  return ICONS.chat;
}

/* ---------- wobble (needs the DOM's SVG geometry) ---------- */
const polyCache = new Map();
function wobble(d, seed, ampScale = 1) {
  const host = document.getElementById("measure");
  const out = [];
  for (const sub of d.split(/(?=M)/)) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", sub); host.appendChild(p);
    let L = 0;
    try { L = p.getTotalLength(); } catch (e) { L = 0; }
    if (!(L > 0.5)) { p.remove(); continue; }
    const n = Math.min(900, Math.max(10, Math.ceil(L / 3)));
    const r = rng(seed++);
    const ph = [r(), r(), r(), r()].map((v) => v * Math.PI * 2);
    const k1 = Math.max(1, Math.round(L / 80)), k2 = Math.max(2, Math.round(L / 28));
    const amp = Math.min(1, L / 160) * ampScale;
    const closed = /z\s*$/i.test(sub.trim());
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = (L * i) / n, a = (2 * Math.PI * t) / L, q = p.getPointAtLength(t);
      pts.push([
        q.x + amp * (1.5 * Math.sin(k1 * a + ph[0]) + 0.6 * Math.sin(k2 * a + ph[1])),
        q.y + amp * (1.5 * Math.sin(k1 * a + ph[2]) + 0.6 * Math.sin(k2 * a + ph[3])),
      ]);
    }
    p.remove();
    out.push({ pts, closed });
  }
  return out;
}

export function artPolys(art) {
  const key = JSON.stringify(art);
  if (polyCache.has(key)) return polyCache.get(key);
  let seed = hash(key);
  const out = [];
  for (const [d, mode] of art) for (const poly of wobble(d, seed++)) out.push({ ...poly, mode });
  polyCache.set(key, out);
  return out;
}

function strokePolys(ctx, polys, sw) {
  ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = sw; ctx.strokeStyle = COL.ink;
  for (const { pts, mode, closed } of polys) {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    if (closed) ctx.closePath();
    if (mode === "d") { ctx.fillStyle = COL.ink; ctx.fill(); continue; }
    if (mode === "sf") { ctx.fillStyle = COL.mint; ctx.fill(); }
    ctx.stroke();
  }
}

// draws `art` (icon name or drawing) into a size×size box at x,y; sw is the line width in 200-unit space
export function drawArt(ctx, art, x, y, size, sw) {
  const s = size / 200;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  strokePolys(ctx, artPolys(artOf(art)), sw);
  ctx.restore();
}
export const drawIcon = drawArt;
