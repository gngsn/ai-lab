/* Hand-drawn line geometry: every path is sampled and given a seeded, periodic wobble so closed shapes stay seamless. */
import { ICONS } from "./icons.js";

export const COL = { frame: "#111111", mint: "#B9E2C9", ink: "#2E2E2E", soft: "#4A4A4A" };

const iconCache = {};
export function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function hash(str) { let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

export function iconPolys(name) {
  if (iconCache[name]) return iconCache[name];
  const host = document.getElementById("measure");
  const out = []; let seed = hash(name);
  for (const [d, mode] of (ICONS[name] || ICONS.chat)) {
    for (const sub of d.split(/(?=M)/)) {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", sub); host.appendChild(p);
      const L = p.getTotalLength();
      const n = Math.max(10, Math.ceil(L / 3));
      const r = rng(seed++);
      const ph = [r(), r(), r(), r()].map((v) => v * Math.PI * 2);
      const k1 = Math.max(1, Math.round(L / 80)), k2 = Math.max(2, Math.round(L / 28));
      const amp = Math.min(1, L / 160);
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
      out.push({ pts, mode, closed });
    }
  }
  return (iconCache[name] = out);
}

export function drawIcon(ctx, name, x, y, size, sw) {
  const s = size / 200;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = sw; ctx.strokeStyle = COL.ink;
  for (const { pts, mode, closed } of iconPolys(name)) {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    if (closed) ctx.closePath();
    if (mode === "d") { ctx.fillStyle = COL.ink; ctx.fill(); continue; }
    if (mode === "sf") { ctx.fillStyle = COL.mint; ctx.fill(); }
    ctx.stroke();
  }
  ctx.restore();
}
