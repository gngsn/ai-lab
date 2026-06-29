export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** Run any pending call immediately. */
  flush(): void;
  /** Drop any pending call. */
  cancel(): void;
}

/** Trailing debounce with flush/cancel — for debounced saves that must flush on blur/switch. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const fire = (): void => {
    timer = null;
    if (pending) {
      const args = pending;
      pending = null;
      fn(...args);
    }
  };

  const debounced = ((...args: A) => {
    pending = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, ms);
  }) as Debounced<A>;

  debounced.flush = () => {
    if (timer) clearTimeout(timer);
    fire();
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  return debounced;
}
