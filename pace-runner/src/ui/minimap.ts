import { PACE_COLORS } from '../game/constants';
import type { Course } from '../route/course';
import { mulberry32 } from '../route/samples';

export interface MinimapOptions {
  line?: number;
  pad?: number;
  /** extra top padding (CSS px) to keep the route clear of overlays such as tags */
  padTop?: number;
  /** soft coral glow under the route (reward cards, preview) */
  glow?: boolean;
  /** faint procedural street network behind the route; 0 = off, 1 = full */
  streets?: number;
  /** decorative location pin in the top-left corner */
  pin?: boolean;
}

const CORAL = '#ff8a7a';
const CORAL_DEEP = '#f2677d';

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * North-up route map in a "track on a street map" style: a soft street network fading
 * toward the edges, the route as a glowing pace-coloured line, round start/finish dots.
 * Everything static is cached in an offscreen canvas; each frame only blits and draws dots.
 */
export class Minimap {
  private bg = document.createElement('canvas');
  private course: Course | null = null;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement, private opts: MinimapOptions = {}) {}

  setCourse(course: Course): void {
    this.course = course;
    this.layout();
  }

  /** Re-measure (call after the canvas becomes visible or resizes). */
  layout(): void {
    const c = this.course;
    if (!c) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr));
    this.canvas.width = this.bg.width = w;
    this.canvas.height = this.bg.height = h;

    const pad = (this.opts.pad ?? 14) * this.dpr;
    const padTop = (this.opts.padTop ?? this.opts.pad ?? 14) * this.dpr;
    const b = c.bounds;
    const bw = b.maxX - b.minX || 1;
    const bh = b.maxZ - b.minZ || 1;
    this.scale = Math.min((w - pad * 2) / bw, (h - pad - padTop) / bh);
    this.ox = (w - bw * this.scale) / 2 - b.minX * this.scale;
    this.oy = padTop + (h - pad - padTop - bh * this.scale) / 2 - b.minZ * this.scale;

    const g = this.bg.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    if (this.opts.streets) this.drawStreets(g, w, h, hashString(c.run.id), this.opts.streets);

    g.lineCap = g.lineJoin = 'round';
    const line = (this.opts.line ?? 4) * this.dpr;
    const pts = c.samples;
    const step = Math.max(1, Math.floor(pts.length / 600));
    const path = () => {
      g.beginPath();
      for (let i = 0; i < pts.length; i += step) {
        const [x, y] = this.project(pts[i].x, pts[i].z);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      const end = pts[pts.length - 1];
      g.lineTo(...this.project(end.x, end.z));
    };

    // soft glow + white casing: the route reads as a highlighted track on the map
    if (this.opts.glow) {
      g.save();
      g.shadowColor = 'rgba(255, 120, 130, 0.45)';
      g.shadowBlur = 14 * this.dpr;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = line + 3 * this.dpr;
      path();
      g.stroke();
      g.restore();
    }
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = line + 3 * this.dpr;
    path();
    g.stroke();

    // pace-coloured runs
    g.lineWidth = line;
    let i = 0;
    while (i < pts.length - 1) {
      const bucket = pts[i].bucket;
      g.strokeStyle = PACE_COLORS[bucket];
      g.beginPath();
      g.moveTo(...this.project(pts[i].x, pts[i].z));
      let j = i;
      while (j < pts.length - 1 && pts[j].bucket === bucket) {
        j = Math.min(pts.length - 1, j + step);
        g.lineTo(...this.project(pts[j].x, pts[j].z));
      }
      g.stroke();
      i = j;
    }

    // energy gel stations
    for (const gel of c.gels) {
      const p = c.samples[Math.round((gel.s / c.length) * (pts.length - 1))];
      const [gx, gy] = this.project(p.x, p.z);
      const gw = 7 * this.dpr;
      const gh = 10 * this.dpr;
      g.fillStyle = '#e8414f';
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2 * this.dpr;
      g.beginPath();
      g.roundRect(gx - gw / 2, gy - gh / 2, gw, gh, 2.5 * this.dpr);
      g.fill();
      g.stroke();
    }

    // round start / finish dots (finish has a white centre)
    const end = pts[pts.length - 1];
    const dotR = Math.max(4.5, line / this.dpr + 1.5) * this.dpr;
    this.endDot(g, ...this.project(pts[0].x, pts[0].z), dotR, false);
    this.endDot(g, ...this.project(end.x, end.z), dotR, true);

    if (this.opts.pin) this.drawPin(g, pad * 0.9, pad * 0.75, 15 * this.dpr);
    this.draw();
  }

  private project(x: number, z: number): [number, number] {
    return [x * this.scale + this.ox, z * this.scale + this.oy];
  }

  /**
   * Procedural street network in canvas space: two near-perpendicular families of
   * broken, slightly bent streets plus short alleys, blurred and faded toward the edges.
   */
  private drawStreets(g: CanvasRenderingContext2D, w: number, h: number, seed: number, strength: number) {
    const rnd = mulberry32(seed);
    const layer = document.createElement('canvas');
    layer.width = w;
    layer.height = h;
    const s = layer.getContext('2d')!;
    const span = Math.min(w, h);
    const spacing = span / (3.4 + rnd() * 1.2);
    const diag = Math.hypot(w, h);
    const cx = w / 2;
    const cy = h / 2;
    const theta = (rnd() - 0.5) * 0.6;
    const families = [theta, theta + Math.PI / 2 + (rnd() - 0.5) * 0.15];
    const streets: [number, number][][] = [];

    for (const a of families) {
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const nx = -dy;
      const ny = dx;
      const count = Math.ceil(diag / spacing) + 1;
      for (let k = -count; k <= count; k++) {
        const off = k * spacing + (rnd() - 0.5) * spacing * 0.35;
        // walk along the street, breaking it into pieces with gaps
        let t = -diag / 2;
        while (t < diag / 2) {
          const len = spacing * (0.8 + rnd() * 2.2);
          if (rnd() > 0.22) {
            const piece: [number, number][] = [];
            const n = 3;
            for (let p = 0; p <= n; p++) {
              const tt = t + (len * p) / n;
              const bend = (rnd() - 0.5) * spacing * 0.12;
              piece.push([cx + dx * tt + nx * (off + bend), cy + dy * tt + ny * (off + bend)]);
            }
            streets.push(piece);
          }
          t += len + spacing * (0.15 + rnd() * 0.35);
        }
      }
      // short alleys branching across this family
      for (let k = 0; k < 14; k++) {
        const px = rnd() * w;
        const py = rnd() * h;
        const len = spacing * (0.25 + rnd() * 0.5);
        streets.push([
          [px, py],
          [px + nx * len, py + ny * len],
        ]);
      }
    }

    const stroke = (width: number, color: string, blur: number) => {
      s.filter = blur ? `blur(${blur}px)` : 'none';
      s.strokeStyle = color;
      s.lineWidth = width;
      s.lineCap = s.lineJoin = 'round';
      for (const st of streets) {
        s.beginPath();
        s.moveTo(st[0][0], st[0][1]);
        for (let p = 1; p < st.length; p++) s.lineTo(st[p][0], st[p][1]);
        s.stroke();
      }
    };
    // faint lilac edge so white streets still read on pale backgrounds
    stroke(spacing * 0.24, 'rgba(142,114,184,0.10)', 3 * this.dpr);
    stroke(spacing * 0.2, 'rgba(255,255,255,0.7)', 2.5 * this.dpr);
    stroke(spacing * 0.075, 'rgba(255,255,255,0.92)', 0);
    s.filter = 'none';

    // fade toward the edges like a vignette
    s.globalCompositeOperation = 'destination-in';
    const fade = s.createRadialGradient(cx, cy, span * 0.2, cx, cy, Math.max(w, h) * 0.62);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    s.fillStyle = fade;
    s.fillRect(0, 0, w, h);

    g.save();
    g.globalAlpha = strength;
    g.drawImage(layer, 0, 0);
    g.restore();
  }

  private endDot(g: CanvasRenderingContext2D, x: number, y: number, r: number, finish: boolean) {
    g.save();
    g.shadowColor = 'rgba(242, 103, 125, 0.45)';
    g.shadowBlur = 8 * this.dpr;
    const grad = g.createLinearGradient(x - r, y - r, x + r, y + r);
    grad.addColorStop(0, CORAL);
    grad.addColorStop(1, CORAL_DEEP);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.lineWidth = 2 * this.dpr;
    g.strokeStyle = '#ffffff';
    g.stroke();
    if (finish) {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(x, y, r * 0.38, 0, Math.PI * 2);
      g.fill();
    }
  }

  /** Teardrop map pin with a coral→yellow gradient and a white hole. */
  private drawPin(g: CanvasRenderingContext2D, x: number, y: number, size: number) {
    const r = size * 0.5;
    const cx = x + r;
    const cy = y + r;
    g.save();
    g.shadowColor = 'rgba(242, 103, 125, 0.35)';
    g.shadowBlur = 6 * this.dpr;
    const grad = g.createLinearGradient(cx, y, cx, y + size * 1.45);
    grad.addColorStop(0, '#ffc46b');
    grad.addColorStop(1, CORAL_DEEP);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r, Math.PI * 0.85, Math.PI * 2.15);
    g.lineTo(cx, y + size * 1.45);
    g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(cx, cy, r * 0.38, 0, Math.PI * 2);
    g.fill();
  }

  draw(player?: { x: number; z: number }, ghost?: { x: number; z: number }): void {
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.bg, 0, 0);
    const dot = (p: { x: number; z: number }, r: number, fill: string) => {
      const [x, y] = this.project(p.x, p.z);
      g.beginPath();
      g.arc(x, y, r * this.dpr, 0, Math.PI * 2);
      g.fillStyle = fill;
      g.fill();
      g.lineWidth = 2 * this.dpr;
      g.strokeStyle = '#2b2233';
      g.stroke();
    };
    if (ghost) dot(ghost, 4.5, '#bfe6ff');
    if (player) dot(player, 6, '#ff8a7a');
  }
}
