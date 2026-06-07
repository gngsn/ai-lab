// Port of personal-log/Kprintf2026/v4/controller.js :: SlidePresentation.
// Stripped down to the runtime concerns (nav + fragments + scroll).
// InlineEditor / SpeakerNotes will land in M3 / M4 as separate modules.

export class SlidePresentation {
  constructor({ onSlideChange } = {}) {
    this.slides = Array.from(document.querySelectorAll("section.slide"));
    this.currentSlide = 0;
    this.mainEl = document.querySelector("main");
    this.mobileMedia = window.matchMedia(
      "(max-width: 900px), (max-width: 1024px) and (orientation: landscape)",
    );
    this.touchStartY = null;
    this.wheelLock = false;
    // True while `goTo()` is animating a programmatic scroll. The intersection
    // observer must NOT update currentSlide while we're mid-flight, otherwise
    // passing through intermediate slides fires extra emitSlideChange events
    // (= sync broadcast spam) and the runtime ends up resolving to whichever
    // slide the viewport last crossed instead of the requested target.
    this.navLock = false;
    this._navLockTimer = 0;
    this.onSlideChange = onSlideChange;

    this.setupIntersectionObserver();
    this.setupMobileScrollSync();
    this.setupKeyboardNav();
    this.setupTouchNav();
    this.setupWheelNav();

    this.slides[0]?.classList.add("visible");
    this._activeStepperSlide = null;
    this.syncStepperState(this.slides[0]);
    this.emitSlideChange();
  }

  getStepperConfig(slide) {
    if (!slide) return null;

    const activeClass = slide.dataset.stepperActiveClass || "mint";
    const explicitSelector = slide.dataset.stepper?.trim();
    if (explicitSelector) return { selector: explicitSelector, activeClass };

    if (slide.querySelector("[data-stepper-item], .stepper-item")) {
      return {
        selector: "[data-stepper-item], .stepper-item",
        activeClass,
      };
    }

    if (
      slide.querySelector(
        ".stepper [data-stepper-item], .stepper .stepper-item",
      )
    ) {
      return {
        selector: ".stepper [data-stepper-item], .stepper .stepper-item",
        activeClass,
      };
    }

    const cardCount = slide.querySelectorAll(".card").length;
    if (cardCount >= 2 && slide.querySelector(`.card.${activeClass}`)) {
      return { selector: ".card", activeClass };
    }

    return null;
  }

  getStepperItems(slide) {
    const config = this.getStepperConfig(slide);
    if (!config) return [];
    return Array.from(slide.querySelectorAll(config.selector));
  }

  getActiveStepperIndex(slide) {
    const config = this.getStepperConfig(slide);
    if (!config) return -1;

    const items = Array.from(slide.querySelectorAll(config.selector));
    if (!items.length) return -1;
    return items.findIndex((item) =>
      item.classList.contains(config.activeClass),
    );
  }

  syncStepperState(slide) {
    const config = this.getStepperConfig(slide);
    if (!config) {
      this._activeStepperSlide = null;
      return;
    }

    if (this._activeStepperSlide === slide) return;

    const items = Array.from(slide.querySelectorAll(config.selector));
    if (!items.length) return;

    items.forEach((item) => item.classList.remove(config.activeClass));
    items[0]?.classList.add(config.activeClass);
    this._activeStepperSlide = slide;
  }

  stepStepper(slide, direction) {
    const config = this.getStepperConfig(slide);
    if (!config) return false;

    const items = Array.from(slide.querySelectorAll(config.selector));
    if (!items.length) return false;

    const activeIdx = this.getActiveStepperIndex(slide);
    const nextIdx = activeIdx === -1 ? 0 : activeIdx + direction;
    if (nextIdx < 0 || nextIdx >= items.length) return false;

    items[activeIdx]?.classList.remove(config.activeClass);
    items[nextIdx]?.classList.add(config.activeClass);
    this._activeStepperSlide = slide;
    return true;
  }

  setupIntersectionObserver() {
    // Add `.visible` when slides enter the viewport — CSS .reveal/.reveal-blur
    // transitions trigger from this class. On mobile the scroll container is
    // `main` (zoom-shrunk), so observe relative to that.
    const isMobile = this.mobileMedia.matches;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
            entry.target.classList.add("visible");
            // Skip when goTo() is mid-flight — see navLock comment in ctor.
            if (this.navLock) return;
            if (!this.mobileMedia.matches) {
              const idx = this.slides.indexOf(entry.target);
              if (idx !== -1 && idx !== this.currentSlide) {
                this.currentSlide = idx;
                this.emitSlideChange();
              }
            }
          }
        });
      },
      { root: isMobile ? this.mainEl : null, threshold: [0, 0.5, 0.9] },
    );
    this.slides.forEach((s) => observer.observe(s));
  }

  setupMobileScrollSync() {
    // On mobile, `currentSlide` is driven by `main`'s scrollTop (not by
    // intersection ratio). v4 mobile shrinks layout to 720px-tall slides.
    if (!this.mainEl) return;
    let raf = 0;
    const SLIDE_H = 720;
    const sync = () => {
      raf = 0;
      if (!this.mobileMedia.matches) return;
      const idx = Math.round(this.mainEl.scrollTop / SLIDE_H);
      const clamped = Math.max(0, Math.min(this.slides.length - 1, idx));
      if (clamped !== this.currentSlide) {
        this.currentSlide = clamped;
        this.slides[clamped].classList.add("visible");
        this.emitSlideChange();
      }
    };
    this.mainEl.addEventListener(
      "scroll",
      () => {
        if (raf) return;
        raf = requestAnimationFrame(sync);
      },
      { passive: true },
    );
  }

  setupKeyboardNav() {
    document.addEventListener("keydown", (e) => {
      // Ignore OS autorepeat — holding ↓ otherwise skips through slides.
      if (e.repeat) return;
      // Skip when editing text inline (M3+).
      if (e.target?.getAttribute?.("contenteditable") === "true") return;
      switch (e.key) {
        case "ArrowDown":
        case "ArrowRight":
        case "PageDown":
        case " ":
          e.preventDefault();
          this.next();
          break;
        case "ArrowUp":
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          this.prev();
          break;
        case "Home":
          e.preventDefault();
          this.goTo(0);
          break;
        case "End":
          e.preventDefault();
          this.goTo(this.slides.length - 1);
          break;
      }
    });
  }

  setupTouchNav() {
    document.addEventListener(
      "touchstart",
      (e) => {
        this.touchStartY = e.touches[0].clientY;
      },
      { passive: true },
    );
    document.addEventListener(
      "touchend",
      (e) => {
        if (this.touchStartY === null) return;
        const dy = e.changedTouches[0].clientY - this.touchStartY;
        if (Math.abs(dy) > 50) dy < 0 ? this.next() : this.prev();
        this.touchStartY = null;
      },
      { passive: true },
    );
  }

  setupWheelNav() {
    // One slide step per gesture. A "gesture" lasts as long as wheel events
    // keep arriving with < 250ms gaps — covers Mac trackpad inertia, which
    // can stretch a single swipe to ~800ms. A fixed 700ms lock would let
    // late inertia events fire a second advance.
    let lastWheelAt = 0;
    const SETTLE_MS = 250;

    const release = () => {
      if (Date.now() - lastWheelAt >= SETTLE_MS) {
        this.wheelLock = false;
      } else {
        setTimeout(release, 100);
      }
    };

    document.addEventListener(
      "wheel",
      (e) => {
        const now = Date.now();
        if (this.wheelLock) {
          // Inertia continuation — keep extending the settle window so we
          // don't release the lock prematurely.
          lastWheelAt = now;
          return;
        }
        if (Math.abs(e.deltaY) < 30) return;
        this.wheelLock = true;
        lastWheelAt = now;
        if (e.deltaY > 0) this.next();
        else this.prev();
        setTimeout(release, SETTLE_MS);
      },
      { passive: true },
    );
  }

  goTo(idx) {
    if (idx < 0 || idx >= this.slides.length) return;
    // Lock the intersection observer for the duration of the smooth scroll
    // so it doesn't reset currentSlide to an in-between slide.
    this.navLock = true;
    clearTimeout(this._navLockTimer);
    this._navLockTimer = setTimeout(() => {
      this.navLock = false;
    }, 700);

    if (this.mobileMedia.matches && this.mainEl) {
      this.mainEl.scrollTo({ top: idx * 720, behavior: "smooth" });
    } else {
      this.slides[idx].scrollIntoView({ behavior: "smooth", block: "start" });
    }
    this.currentSlide = idx;
    this.emitSlideChange();
  }

  next() {
    // Reveal next .fragment (or group) in place rather than advancing pages.
    const slide = this.slides[this.currentSlide];
    const pending = slide?.querySelector(".fragment:not(.show)");
    if (pending) {
      const group = pending.dataset.fragmentGroup;
      if (group) {
        slide
          .querySelectorAll(
            `.fragment[data-fragment-group="${group}"]:not(.show)`,
          )
          .forEach((el) => el.classList.add("show"));
      } else {
        pending.classList.add("show");
      }
      return;
    }
    if (this.stepStepper(slide, 1)) return;
    if (this.currentSlide < this.slides.length - 1) {
      this.goTo(this.currentSlide + 1);
    }
  }

  prev() {
    // Hide last revealed .fragment (or group) before going back a page.
    const slide = this.slides[this.currentSlide];
    const revealed = [...(slide?.querySelectorAll(".fragment.show") || [])];
    if (revealed.length > 0) {
      const last = revealed[revealed.length - 1];
      const group = last.dataset.fragmentGroup;
      if (group) {
        slide
          .querySelectorAll(`.fragment[data-fragment-group="${group}"].show`)
          .forEach((el) => el.classList.remove("show"));
      } else {
        last.classList.remove("show");
      }
      return;
    }
    if (this.stepStepper(slide, -1)) return;
    if (this.currentSlide > 0) this.goTo(this.currentSlide - 1);
  }

  emitSlideChange() {
    const slide = this.slides[this.currentSlide];
    this.syncStepperState(slide);
    const detail = {
      index: this.currentSlide,
      section_id: slide?.dataset?.sectionId || null,
      total: this.slides.length,
    };
    document.dispatchEvent(new CustomEvent("slidechange", { detail }));
    this.onSlideChange?.(detail);
  }
}
