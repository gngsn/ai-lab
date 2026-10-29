// The shapes of the SVG picker. Each draws into a 100×100 viewBox from the
// fill colour, stroke colour and stroke width.
export type SvgShape = {
  id: string;
  label: string;
  render: (f: string, s: string, sw: number) => string;
};

export const SVG_SHAPES: SvgShape[] = [
  {
    id: "rect",
    label: "Rectangle",
    render: (f, s, sw) =>
      `<rect x="8" y="18" width="84" height="64" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`,
  },
  {
    id: "rect-r",
    label: "Rounded",
    render: (f, s, sw) =>
      `<rect x="8" y="18" width="84" height="64" rx="14" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`,
  },
  {
    id: "circle",
    label: "Circle",
    render: (f, s, sw) =>
      `<circle cx="50" cy="50" r="40" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`,
  },
  {
    id: "ellipse",
    label: "Ellipse",
    render: (f, s, sw) =>
      `<ellipse cx="50" cy="50" rx="45" ry="28" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`,
  },
  {
    id: "triangle",
    label: "Triangle",
    render: (f, s, sw) =>
      `<polygon points="50,6 94,90 6,90" fill="${f}" stroke="${s}" stroke-width="${sw}" stroke-linejoin="round"/>`,
  },
  {
    id: "diamond",
    label: "Diamond",
    render: (f, s, sw) =>
      `<polygon points="50,4 96,50 50,96 4,50" fill="${f}" stroke="${s}" stroke-width="${sw}" stroke-linejoin="round"/>`,
  },
  {
    id: "star",
    label: "Star",
    render: (f, s, sw) => {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 44 : 18;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        pts.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`);
      }
      return `<polygon points="${pts.join(" ")}" fill="${f}" stroke="${s}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    },
  },
  {
    id: "arrow-r",
    label: "Arrow \u2192",
    render: (f, s, sw) =>
      `<polygon points="5,33 62,33 62,12 95,50 62,88 62,67 5,67" fill="${f}" stroke="${s}" stroke-width="${sw}" stroke-linejoin="round"/>`,
  },
  {
    id: "arrow-l",
    label: "Arrow \u2190",
    render: (f, s, sw) =>
      `<polygon points="95,33 38,33 38,12 5,50 38,88 38,67 95,67" fill="${f}" stroke="${s}" stroke-width="${sw}" stroke-linejoin="round"/>`,
  },
  {
    id: "arrow-u",
    label: "Arrow \u2191",
    render: (f, s, sw) =>
      `<polygon points="33,95 33,38 12,38 50,5 88,38 67,38 67,95" fill="${f}" stroke="${s}" stroke-width="${sw}" stroke-linejoin="round"/>`,
  },
  {
    id: "line-h",
    label: "Line \u2014",
    render: (f, s, sw) =>
      `<line x1="5" y1="50" x2="95" y2="50" stroke="${sw > 0 ? s : f}" stroke-width="${Math.max(sw, 4)}" stroke-linecap="round"/>`,
  },
  {
    id: "check",
    label: "Checkmark",
    render: (f, s, sw) =>
      `<polyline points="8,52 36,78 92,20" fill="none" stroke="${f}" stroke-width="${Math.max(sw, 8)}" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    id: "cross",
    label: "Cross \u2715",
    render: (f, s, sw) =>
      `<line x1="14" y1="14" x2="86" y2="86" stroke="${f}" stroke-width="${Math.max(sw, 8)}" stroke-linecap="round"/><line x1="86" y1="14" x2="14" y2="86" stroke="${f}" stroke-width="${Math.max(sw, 8)}" stroke-linecap="round"/>`,
  },
  {
    id: "plus",
    label: "Plus +",
    render: (f, s, sw) =>
      `<line x1="50" y1="10" x2="50" y2="90" stroke="${f}" stroke-width="${Math.max(sw, 8)}" stroke-linecap="round"/><line x1="10" y1="50" x2="90" y2="50" stroke="${f}" stroke-width="${Math.max(sw, 8)}" stroke-linecap="round"/>`,
  },
  {
    id: "speech",
    label: "Speech",
    render: (f, s, sw) =>
      `<path d="M8,8 H92 A6,6 0 0,1 98,14 V60 A6,6 0 0,1 92,66 H42 L28,90 28,66 H8 A6,6 0 0,1 2,60 V14 A6,6 0 0,1 8,8 Z" fill="${f}" stroke="${s}" stroke-width="${sw}" stroke-linejoin="round"/>`,
  },
  {
    id: "heart",
    label: "Heart",
    render: (f, s, sw) =>
      `<path d="M50,82 C50,82 8,54 8,28 A22,22 0 0,1 50,18 A22,22 0 0,1 92,28 C92,54 50,82 50,82 Z" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`,
  },
];
