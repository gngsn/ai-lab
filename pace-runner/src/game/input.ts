/** Left/right steering from keyboard (A/D, arrows) or touching either half of the screen. */
export class SteerInput {
  private keys = new Set<string>();
  private pointers = new Map<number, number>();
  /** smoothed value in [-1, 1] */
  value = 0;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.pointers.clear();
    });
    const set = (e: PointerEvent) => this.pointers.set(e.pointerId, e.clientX);
    target.addEventListener('pointerdown', set);
    target.addEventListener('pointermove', (e) => this.pointers.has(e.pointerId) && set(e));
    const clear = (e: PointerEvent) => this.pointers.delete(e.pointerId);
    window.addEventListener('pointerup', clear);
    window.addEventListener('pointercancel', clear);
  }

  private raw(): number {
    let left = this.keys.has('ArrowLeft') || this.keys.has('KeyA');
    let right = this.keys.has('ArrowRight') || this.keys.has('KeyD');
    const mid = window.innerWidth / 2;
    for (const x of this.pointers.values()) {
      if (x < mid) left = true;
      else right = true;
    }
    return (right ? 1 : 0) - (left ? 1 : 0);
  }

  update(dt: number): number {
    const target = this.raw();
    this.value += (target - this.value) * Math.min(1, dt * 12);
    return this.value;
  }

  reset(): void {
    this.value = 0;
  }
}
