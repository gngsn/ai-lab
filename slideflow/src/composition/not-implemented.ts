/**
 * A port placeholder for capabilities not yet wired on a given backend. Any method
 * call throws a clear, actionable error. Lets the container assemble a full Ports
 * bundle phase-by-phase: pages that don't touch a port keep working; one that does
 * fails loudly instead of silently misbehaving.
 */
export function notImplemented<T extends object>(portName: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      return () => {
        throw new Error(
          `Port "${portName}.${String(prop)}" is not wired for this backend yet (lands in a later phase).`,
        );
      };
    },
  });
}
