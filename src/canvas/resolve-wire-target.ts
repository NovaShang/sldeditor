/**
 * Resolve a TerminalRef under the cursor into a concrete world-coord target,
 * including the bus "virtual tap" case. The wire tool drags toward terminals
 * — but for buses we accept a hit on the body itself and treat the closest
 * point on the bus axis as the connection point. WirePreview uses this to
 * paint a marker so the user sees where a release will land.
 */

import { useEditorStore } from '../store';
import type { TerminalRef } from '../model';
import type { WireTarget } from './wire-target-bus';

export function resolveWireTarget(
  ref: TerminalRef,
  cursorWorld: [number, number],
): WireTarget | null {
  const internal = useEditorStore.getState().internal;
  // Direct: a real terminal we already computed world coords for.
  const term = internal.terminals.get(ref);
  if (term) {
    return { ref, world: term.world, isBusTap: false };
  }
  // Bus virtual tap: ref looks like "BUS.tap" but isn't in `terminals`.
  const dot = ref.indexOf('.');
  if (dot <= 0) return null;
  const elemId = ref.slice(0, dot);
  const pin = ref.slice(dot + 1);
  if (pin !== 'tap') return null;
  const re = internal.elements.get(elemId);
  if (re?.element.kind !== 'busbar' || !re.libraryDef?.stretchable) return null;
  const place = internal.layout.get(elemId);
  if (!place) return null;

  const { axis, naturalSpan } = re.libraryDef.stretchable;
  const span = place.span ?? naturalSpan;
  // Project cursor onto the bus axis, clamped to its span.
  if (axis === 'x') {
    const minX = place.at[0] - span / 2;
    const maxX = place.at[0] + span / 2;
    const x = Math.max(minX, Math.min(maxX, cursorWorld[0]));
    return { ref, world: [x, place.at[1]], isBusTap: true };
  }
  const minY = place.at[1] - span / 2;
  const maxY = place.at[1] + span / 2;
  const y = Math.max(minY, Math.min(maxY, cursorWorld[1]));
  return { ref, world: [place.at[0], y], isBusTap: true };
}
