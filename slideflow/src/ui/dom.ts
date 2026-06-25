/** Typed DOM accessors — replace scattered `getElementById(...): any` (PLAN §7). */

/** Required element. Throws if missing — surfaces wiring bugs immediately. */
export function el<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Required element not found: ${selector}`);
  return found;
}

/** Optional element. Returns null if missing (SPEC §13 tolerated-missing-ids). */
export function elOpt<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

/** All matching elements as an array. */
export function els<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(selector)];
}
