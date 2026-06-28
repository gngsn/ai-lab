/** Generate a fresh, collision-resistant section id (SPEC §9.3 add-slide). */
export function newSectionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Return `base`, or `base-02`, `base-03`, … until it is not in `taken` (SPEC §9.2). */
export function dedupeSectionId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  let candidate = `${base}-${pad2(n)}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${base}-${pad2(n)}`;
  }
  return candidate;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
