/**
 * Resolve a WireEnd under the cursor into a concrete world-coord target,
 * including the bus body case. The wire tool drags toward terminals — but
 * for buses we accept a hit on the body itself and project the cursor onto
 * the bus axis to get a connection point.
 */

import { useEditorStore } from '../store';
import type { WireEnd } from '../model';
import type { WireTarget } from './wire-target-bus';

export function resolveWireTarget(
  ref: WireEnd,
  cursorWorld: [number, number],
): WireTarget | null {
  const internal = useEditorStore.getState().internal;
  // Bare id: a bus (project cursor onto its axis) or a junction (a point).
  if (!ref.includes('.')) {
    const rb = internal.buses.get(ref);
    if (rb) {
      const { axis, at, span } = rb.geometry;
      if (axis === 'x') {
        const minX = at[0] - span / 2;
        const maxX = at[0] + span / 2;
        const x = Math.max(minX, Math.min(maxX, cursorWorld[0]));
        return { ref, world: [x, at[1]], isBus: true };
      }
      const minY = at[1] - span / 2;
      const maxY = at[1] + span / 2;
      const y = Math.max(minY, Math.min(maxY, cursorWorld[1]));
      return { ref, world: [at[0], y], isBus: true };
    }
    const rj = internal.junctions.get(ref);
    if (rj) return { ref, world: [rj.world[0], rj.world[1]], isBus: false };
    return null;
  }
  // Real device terminal.
  const term = internal.terminals.get(ref as `${string}.${string}`);
  if (term) {
    return { ref, world: term.world, isBus: false };
  }
  return null;
}
