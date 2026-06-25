import type { Ports } from '@ports/ports';
import { buildPorts } from './container';

let cached: Ports | null = null;

/** Pages call this once at boot to obtain every backend capability behind ports. */
export function getPorts(): Ports {
  if (!cached) cached = buildPorts();
  return cached;
}
