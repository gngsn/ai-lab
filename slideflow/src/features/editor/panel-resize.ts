import { StorageKeys } from '@ui/constants';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Wire the slide-list and props panel resizers (SPEC §9.3). Widths are written to
 * CSS custom properties on `#body` and persisted to localStorage.
 */
export function installPanelResizers(
  body: HTMLElement,
  slideHandle: HTMLElement,
  propsHandle: HTMLElement,
): void {
  restore(body);

  drag(slideHandle, (event) => {
    const rect = body.getBoundingClientRect();
    const width = clamp(event.clientX - rect.left, 160, 520);
    body.style.setProperty('--slide-list-width', `${width}px`);
    localStorage.setItem(StorageKeys.slideListWidth, String(width));
  });

  drag(propsHandle, (event) => {
    const rect = body.getBoundingClientRect();
    const width = clamp(rect.right - event.clientX, 220, 560);
    body.style.setProperty('--props-width', `${width}px`);
    localStorage.setItem(StorageKeys.propsPanelWidth, String(width));
  });
}

function restore(body: HTMLElement): void {
  const apply = (key: string, cssVar: string) => {
    const value = localStorage.getItem(key);
    if (value) body.style.setProperty(cssVar, `${value}px`);
  };
  apply(StorageKeys.slideListWidth, '--slide-list-width');
  apply(StorageKeys.propsPanelWidth, '--props-width');
}

function drag(handle: HTMLElement, onMove: (event: PointerEvent) => void): void {
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging');

    const move = (ev: PointerEvent) => onMove(ev);
    const up = () => {
      handle.releasePointerCapture(event.pointerId);
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}
