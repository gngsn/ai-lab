/**
 * Runtime for a rendered deck document (SPEC §10.4). Drives slide navigation by
 * keyboard / wheel / touch, reveals fragments before advancing, marks the visible
 * slide via IntersectionObserver, and emits `slidechange`.
 */
export interface SlideChangeInfo {
  index: number;
  section_id: string;
  total: number;
}

export interface SlidePresentationOptions {
  onSlideChange?: (info: SlideChangeInfo) => void;
}

const MOBILE_QUERY = '(max-width: 900px), (max-width: 1024px) and (orientation: landscape)';
const WHEEL_THRESHOLD = 30;
const WHEEL_SETTLE_MS = 250;
const TOUCH_THRESHOLD = 50;
const PROGRAMMATIC_LOCK_MS = 700;
const MOBILE_SLIDE_HEIGHT = 720;

export class SlidePresentation {
  private readonly slides: HTMLElement[];
  private index = 0;
  private programmaticLock = false;
  private wheelLock = false;
  private touchStartY = 0;
  private observer: IntersectionObserver | null = null;

  constructor(
    private readonly doc: Document,
    private readonly opts: SlidePresentationOptions = {},
  ) {
    this.slides = [...doc.querySelectorAll<HTMLElement>('section.slide')];
    this.attach();
    this.observeVisibility();
    if (this.slides.length) this.go(0, { silent: true });
  }

  get total(): number {
    return this.slides.length;
  }

  current(): number {
    return this.index;
  }

  /** Navigate to the slide whose section id matches, if present. */
  goToSection(sectionId: string): void {
    const target = this.slides.findIndex((s) => s.dataset.sectionId === sectionId);
    if (target >= 0) this.go(target);
  }

  go(index: number, opts: { silent?: boolean } = {}): void {
    const clamped = Math.max(0, Math.min(this.slides.length - 1, index));
    this.index = clamped;
    const slide = this.slides[clamped];
    if (!slide) return;

    this.resetFragments(slide);
    this.programmaticLock = true;
    this.doc.defaultView?.setTimeout(() => (this.programmaticLock = false), PROGRAMMATIC_LOCK_MS);

    if (this.isMobile()) {
      this.doc
        .querySelector('main')
        ?.scrollTo({ top: clamped * MOBILE_SLIDE_HEIGHT, behavior: 'smooth' });
    } else {
      slide.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (!opts.silent) this.emit();
  }

  next(): void {
    const slide = this.slides[this.index];
    const fragments = this.fragmentsOf(slide);
    const revealed = Number(slide?.dataset.revealed ?? 0);
    if (slide && revealed < fragments.length) {
      fragments[revealed].classList.add('visible');
      slide.dataset.revealed = String(revealed + 1);
      return;
    }
    this.go(this.index + 1);
    this.emit();
  }

  prev(): void {
    const slide = this.slides[this.index];
    const revealed = Number(slide?.dataset.revealed ?? 0);
    if (slide && revealed > 0) {
      this.fragmentsOf(slide)[revealed - 1].classList.remove('visible');
      slide.dataset.revealed = String(revealed - 1);
      return;
    }
    this.go(this.index - 1);
    this.emit();
  }

  destroy(): void {
    this.observer?.disconnect();
    this.doc.defaultView?.removeEventListener('keydown', this.onKey);
    this.doc.removeEventListener('wheel', this.onWheel);
    this.doc.removeEventListener('touchstart', this.onTouchStart);
    this.doc.removeEventListener('touchend', this.onTouchEnd);
  }

  private attach(): void {
    this.doc.defaultView?.addEventListener('keydown', this.onKey);
    this.doc.addEventListener('wheel', this.onWheel, { passive: false });
    this.doc.addEventListener('touchstart', this.onTouchStart, { passive: true });
    this.doc.addEventListener('touchend', this.onTouchEnd, { passive: true });
  }

  private observeVisibility(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        if (this.programmaticLock) return;
        for (const entry of entries) {
          if (entry.intersectionRatio > 0.5) {
            entry.target.classList.add('visible');
            const idx = this.slides.indexOf(entry.target as HTMLElement);
            if (idx >= 0 && idx !== this.index) {
              this.index = idx;
              this.emit();
            }
          }
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    for (const slide of this.slides) this.observer.observe(slide);
  }

  private onKey = (event: KeyboardEvent): void => {
    if (['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(event.key)) {
      event.preventDefault();
      this.next();
    } else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(event.key)) {
      event.preventDefault();
      this.prev();
    } else if (event.key === 'Home') {
      this.go(0);
    } else if (event.key === 'End') {
      this.go(this.slides.length - 1);
    }
  };

  private onWheel = (event: WheelEvent): void => {
    if (this.wheelLock || Math.abs(event.deltaY) < WHEEL_THRESHOLD) return;
    this.wheelLock = true;
    this.doc.defaultView?.setTimeout(() => (this.wheelLock = false), WHEEL_SETTLE_MS);
    if (event.deltaY > 0) this.next();
    else this.prev();
  };

  private onTouchStart = (event: TouchEvent): void => {
    this.touchStartY = event.changedTouches[0]?.clientY ?? 0;
  };

  private onTouchEnd = (event: TouchEvent): void => {
    const delta = (event.changedTouches[0]?.clientY ?? 0) - this.touchStartY;
    if (Math.abs(delta) < TOUCH_THRESHOLD) return;
    if (delta < 0) this.next();
    else this.prev();
  };

  private fragmentsOf(slide: HTMLElement | undefined): HTMLElement[] {
    return slide ? [...slide.querySelectorAll<HTMLElement>('.fragment')] : [];
  }

  private resetFragments(slide: HTMLElement): void {
    slide.dataset.revealed = '0';
    for (const fragment of this.fragmentsOf(slide)) fragment.classList.remove('visible');
  }

  private isMobile(): boolean {
    return this.doc.defaultView?.matchMedia(MOBILE_QUERY).matches ?? false;
  }

  private emit(): void {
    const slide = this.slides[this.index];
    const info: SlideChangeInfo = {
      index: this.index,
      section_id: slide?.dataset.sectionId ?? '',
      total: this.slides.length,
    };
    this.opts.onSlideChange?.(info);
    this.doc.dispatchEvent(new CustomEvent('slidechange', { detail: info }));
  }
}
