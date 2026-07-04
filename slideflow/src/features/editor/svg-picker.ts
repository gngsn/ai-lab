/**
 * SVG picker (SPEC §9.3): built-in shapes with fill/stroke/size controls, plus a
 * validated custom-SVG tab. Inserts the SVG wrapped in a non-editable inline span.
 */
type ShapeBuilder = (fill: string, stroke: string, sw: number) => string;

const SHAPES: { key: string; label: string; build: ShapeBuilder }[] = [
  {
    key: 'rect',
    label: 'Rect',
    build: (f, s, w) =>
      `<rect x="8" y="20" width="84" height="60" fill="${f}" stroke="${s}" stroke-width="${w}"/>`,
  },
  {
    key: 'rounded',
    label: 'Rounded',
    build: (f, s, w) =>
      `<rect x="8" y="20" width="84" height="60" rx="12" fill="${f}" stroke="${s}" stroke-width="${w}"/>`,
  },
  {
    key: 'circle',
    label: 'Circle',
    build: (f, s, w) =>
      `<circle cx="50" cy="50" r="40" fill="${f}" stroke="${s}" stroke-width="${w}"/>`,
  },
  {
    key: 'ellipse',
    label: 'Ellipse',
    build: (f, s, w) =>
      `<ellipse cx="50" cy="50" rx="44" ry="30" fill="${f}" stroke="${s}" stroke-width="${w}"/>`,
  },
  {
    key: 'triangle',
    label: 'Triangle',
    build: (f, s, w) =>
      `<polygon points="50,12 90,86 10,86" fill="${f}" stroke="${s}" stroke-width="${w}"/>`,
  },
  {
    key: 'diamond',
    label: 'Diamond',
    build: (f, s, w) =>
      `<polygon points="50,8 92,50 50,92 8,50" fill="${f}" stroke="${s}" stroke-width="${w}"/>`,
  },
  {
    key: 'star',
    label: 'Star',
    build: (f, s, w) =>
      `<polygon points="50,8 61,38 94,38 67,58 78,90 50,70 22,90 33,58 6,38 39,38" fill="${f}" stroke="${s}" stroke-width="${w}"/>`,
  },
  {
    key: 'arrow',
    label: 'Arrow',
    build: (f, s, w) =>
      `<polygon points="10,40 60,40 60,22 92,50 60,78 60,60 10,60" fill="${f}" stroke="${s}" stroke-width="${w}"/>`,
  },
  {
    key: 'plus',
    label: 'Plus',
    build: (f, s, w) =>
      `<polygon points="40,10 60,10 60,40 90,40 90,60 60,60 60,90 40,90 40,60 10,60 10,40 40,40" fill="${f}" stroke="${s}" stroke-width="${w}"/>`,
  },
  {
    key: 'check',
    label: 'Check',
    build: (_f, s, w) =>
      `<polyline points="18,52 42,76 84,24" fill="none" stroke="${s}" stroke-width="${Math.max(w, 8)}" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    key: 'line',
    label: 'Line',
    build: (_f, s, w) =>
      `<line x1="10" y1="50" x2="90" y2="50" stroke="${s}" stroke-width="${Math.max(w, 4)}" stroke-linecap="round"/>`,
  },
  {
    key: 'heart',
    label: 'Heart',
    build: (f, s, w) =>
      `<path d="M50 86 C10 58 16 24 50 40 C84 24 90 58 50 86 Z" fill="${f}" stroke="${s}" stroke-width="${w}"/>`,
  },
];

export function openSvgPicker(insert: (html: string) => void): void {
  const bg = document.createElement('div');
  bg.className = 'modal-bg show';
  bg.innerHTML = `
    <div class="modal" style="width:min(820px,92vw);height:min(640px,86vh)">
      <h2>Insert SVG</h2>
      <div class="svg-tabs">
        <button class="svg-tab active" data-tab="shapes">Shapes</button>
        <button class="svg-tab" data-tab="custom">Custom</button>
      </div>
      <div id="svg-shapes">
        <div class="svg-controls">
          <label>Fill <input type="color" id="svg-fill" value="#2e49d4" /></label>
          <label>Stroke <input type="color" id="svg-stroke" value="#1c1a16" /></label>
          <label>Stroke <input type="number" id="svg-stroke-w" value="0" min="0" max="20" style="width:52px" /></label>
          <label>Size <input type="number" id="svg-size" value="120" min="20" max="500" step="10" style="width:62px" /></label>
        </div>
        <div id="svg-shape-grid" class="svg-shape-grid"></div>
      </div>
      <div id="svg-custom" hidden>
        <textarea id="svg-custom-code" spellcheck="false" placeholder='<svg viewBox="0 0 100 100">…</svg>'></textarea>
        <div id="svg-custom-status" class="svg-status"></div>
        <div class="actions"><span style="flex:1"></span><button class="btn btn-primary" id="svg-custom-insert">Insert</button></div>
      </div>
      <div class="actions"><span style="flex:1"></span><button class="btn" id="svg-close">Close</button></div>
    </div>`;
  document.body.appendChild(bg);

  const close = () => bg.remove();
  const fill = bg.querySelector<HTMLInputElement>('#svg-fill')!;
  const stroke = bg.querySelector<HTMLInputElement>('#svg-stroke')!;
  const strokeW = bg.querySelector<HTMLInputElement>('#svg-stroke-w')!;
  const size = bg.querySelector<HTMLInputElement>('#svg-size')!;
  const grid = bg.querySelector<HTMLElement>('#svg-shape-grid')!;

  const renderGrid = () => {
    grid.innerHTML = SHAPES.map(
      (s) =>
        `<button class="svg-shape-btn" data-shape="${s.key}">${wrapSvg(s.build(fill.value, stroke.value, Number(strokeW.value)), 64)}<span>${s.label}</span></button>`,
    ).join('');
  };
  for (const input of [fill, stroke, strokeW]) input.addEventListener('input', renderGrid);
  renderGrid();

  grid.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-shape]');
    if (!button) return;
    const shape = SHAPES.find((s) => s.key === button.dataset.shape);
    if (shape) {
      const svg = wrapSvg(
        shape.build(fill.value, stroke.value, Number(strokeW.value)),
        Number(size.value),
      );
      insert(`<span contenteditable="false" style="display:inline-block">${svg}</span>`);
      close();
    }
  });

  // Tabs
  for (const tab of bg.querySelectorAll<HTMLElement>('.svg-tab')) {
    tab.addEventListener('click', () => {
      bg.querySelectorAll('.svg-tab').forEach((t) => t.classList.toggle('active', t === tab));
      bg.querySelector<HTMLElement>('#svg-shapes')!.hidden = tab.dataset.tab !== 'shapes';
      bg.querySelector<HTMLElement>('#svg-custom')!.hidden = tab.dataset.tab !== 'custom';
    });
  }

  // Custom
  const code = bg.querySelector<HTMLTextAreaElement>('#svg-custom-code')!;
  const status = bg.querySelector<HTMLElement>('#svg-custom-status')!;
  bg.querySelector('#svg-custom-insert')!.addEventListener('click', () => {
    const svg = code.value.trim();
    if (!isValidSvg(svg)) {
      status.textContent = 'Invalid SVG: must have a single <svg> root.';
      return;
    }
    insert(`<span contenteditable="false" style="display:inline-block">${svg}</span>`);
    close();
  });

  bg.querySelector('#svg-close')!.addEventListener('click', close);
  bg.addEventListener('click', (e) => {
    if (e.target === bg) close();
  });
}

function wrapSvg(inner: string, sizePx: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${sizePx}" height="${sizePx}">${inner}</svg>`;
}

function isValidSvg(source: string): boolean {
  if (!source) return false;
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  return doc.documentElement.nodeName.toLowerCase() === 'svg' && !doc.querySelector('parsererror');
}
