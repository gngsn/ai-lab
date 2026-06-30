import type { Slide } from '@core/model/slide';
import type { RealtimePort } from '@ports/realtime-port';
import { tagSection } from '@core/slide/tag-section';
import { injectSlides } from '@core/slide/frame-inject';
import { cleanFrameHtml } from '@core/render/sanitize';
import { isSlideHiddenContent } from '@core/slide/slide-visibility';
import { SlidePresentation } from '@core/render/slide-presentation';

export interface RenderDeckInput {
  frameHtml: string;
  title: string;
  slides: Slide[];
}

export interface RenderDeckOptions {
  /** Print export: keep all slides, reveal fragments, then window.print(). */
  print?: boolean;
  /** Inject scroll-snap fallback CSS (disabled by `nofallback=1`). */
  fallback?: boolean;
  /** Shared read-only view: Home + label, no presenter chrome, no sync. */
  shared?: boolean;
  startSection?: string | null;
  syncRoom?: string | null;
  realtime?: RealtimePort | null;
}

/**
 * Build and display a deck document (SPEC §9.5, §9.9). Cleans the frame, injects
 * the tagged slides, replaces the document, then mounts the runtime + chrome.
 */
export function renderDeck(input: RenderDeckInput, options: RenderDeckOptions = {}): void {
  const { print = false, fallback = true, shared = false } = options;
  const visible = print
    ? input.slides
    : input.slides.filter((s) => !isSlideHiddenContent(s.content));

  const slidesHtml = visible.map((s) => tagSection(s.content, s.sectionId)).join('\n');
  const doc = injectSlides(cleanFrameHtml(input.frameHtml), slidesHtml);
  const html = /^\s*<!doctype/i.test(doc) ? doc : `<!doctype html>${doc}`;

  document.open();
  document.write(html);
  document.close();
  document.title = input.title;

  injectRuntimeStyles({ fallback, print });

  if (print) {
    revealAllFragments();
    setTimeout(() => window.print(), 800);
    return;
  }

  const start = resolveStartIndex(visible, options.startSection ?? null);
  const channel = wireSync(options);
  const chrome = shared ? null : mountPresenterChrome(visible.length);

  const runtime = new SlidePresentation(document, {
    onSlideChange: (info) => {
      chrome?.update(info.index, info.total);
      channel?.broadcast({ section_id: info.section_id, index: info.index });
    },
  });
  if (start > 0) runtime.go(start);

  if (shared) mountSharedLabel();
}

function resolveStartIndex(slides: Slide[], sectionId: string | null): number {
  if (!sectionId) return 0;
  const exact = slides.findIndex((s) => s.sectionId === sectionId);
  return exact >= 0 ? exact : 0;
}

function wireSync(options: RenderDeckOptions) {
  if (options.shared || !options.syncRoom || !options.realtime) return null;
  return options.realtime.join(options.syncRoom, () => {
    /* presenter only broadcasts; ignore inbound */
  });
}

function injectRuntimeStyles(opts: { fallback: boolean; print: boolean }): void {
  const css: string[] = [
    '.fragment{opacity:0;transition:opacity .2s}.fragment.visible{opacity:1}',
    '#__se_progress{position:fixed;top:0;left:0;height:3px;background:#5b8cff;width:0;z-index:9999;transition:width .2s}',
    '#__se_chrome{position:fixed;top:10px;right:14px;display:flex;gap:10px;align-items:center;font:12px/1 system-ui;color:#fff;background:rgba(0,0,0,.45);padding:6px 10px;border-radius:14px;z-index:9999}',
    '#__se_sync{cursor:pointer;opacity:.8}',
    '#__se_navdots{position:fixed;top:50%;right:10px;transform:translateY(-50%);display:none;flex-direction:column;gap:6px;z-index:9999}',
    '#__se_navdots.show{display:flex}',
    '#__se_navdots button{width:8px;height:8px;border-radius:50%;border:0;background:rgba(255,255,255,.4);cursor:pointer;padding:0}',
    '#__se_navdots button.active{background:#5b8cff}',
    '#__se_share{position:fixed;top:10px;left:14px;font:12px/1 system-ui;color:#fff;background:rgba(0,0,0,.45);padding:6px 10px;border-radius:14px;z-index:9999}',
  ];
  if (opts.fallback) {
    css.push(
      'main{height:100vh;overflow-y:auto;scroll-snap-type:y mandatory}',
      'section[data-section-id]{scroll-snap-align:start;min-height:100vh}',
    );
  }
  if (opts.print) {
    css.push(
      '@page{size:1280px 720px;margin:0}',
      'section[data-section-id]{page-break-after:always}',
    );
  }
  const style = document.createElement('style');
  style.textContent = css.join('\n');
  document.head.appendChild(style);
}

interface PresenterChrome {
  update(index: number, total: number): void;
}

function mountPresenterChrome(total: number): PresenterChrome {
  const progress = create('div', { id: '__se_progress' });
  const counter = create('span', { id: '__se_counter', text: `1 / ${total}` });
  const sync = create('span', { id: '__se_sync', text: '⇄' });
  const chrome = create('div', { id: '__se_chrome' });
  chrome.append(counter, sync);

  const dots = create('div', { id: '__se_navdots' });
  const slides = [...document.querySelectorAll('section[data-section-id]')];
  slides.forEach((_, i) => {
    const dot = create('button', {});
    dot.addEventListener('click', () =>
      document.dispatchEvent(new CustomEvent('navdot', { detail: i })),
    );
    dots.appendChild(dot);
  });
  document.body.append(progress, chrome, dots);

  // Reveal nav dots when the pointer is near the right edge.
  window.addEventListener('pointermove', (e) => {
    dots.classList.toggle('show', e.clientX > window.innerWidth - 60);
  });
  document.addEventListener('navdot', (e) => {
    const idx = (e as CustomEvent<number>).detail;
    slides[idx]?.scrollIntoView({ behavior: 'smooth' });
  });

  return {
    update(index, totalCount) {
      progress.style.width = `${((index + 1) / totalCount) * 100}%`;
      counter.textContent = `${index + 1} / ${totalCount}`;
      dots.querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === index));
    },
  };
}

function mountSharedLabel(): void {
  const bar = create('div', { id: '__se_share' });
  const home = create('a', { text: '⌂ Home' });
  (home as HTMLAnchorElement).href = 'index.html';
  home.style.color = '#fff';
  home.style.marginRight = '8px';
  bar.append(home, create('span', { text: 'read-only · shared view' }));
  document.body.appendChild(bar);
}

function revealAllFragments(): void {
  for (const fragment of document.querySelectorAll('.fragment')) fragment.classList.add('visible');
}

function create(tag: string, opts: { id?: string; text?: string }): HTMLElement {
  const node = document.createElement(tag);
  if (opts.id) node.id = opts.id;
  if (opts.text) node.textContent = opts.text;
  return node;
}
