/**
 * Helpers for committing a group move.
 *
 * The interesting one is `translateManualWirePaths`: a wire's manual route
 * only travels with the drag when the *whole* conductor is being moved.
 */

import type { ElementId, Wire, WireEnd } from '../model';

/** Element/bus/junction a wire endpoint belongs to ("QF1.t2" → "QF1"). */
export function endOwner(end: WireEnd): ElementId {
  const dot = end.indexOf('.');
  return dot < 0 ? end : end.slice(0, dot);
}

/**
 * Translate the stored route of every wire whose two endpoints are both in
 * the moving set and move by the same delta. Wires with no manual route, or
 * with only one end moving, are returned untouched.
 *
 * Why this exists: `Wire.path` waypoints are absolute world coordinates and
 * the compiler rebases only the first and last point onto the live endpoint
 * positions — intermediate points pass through verbatim. That is exactly
 * right when a single device is repositioned (the route should re-adapt
 * around it) and exactly wrong when a whole region is dragged: the detour
 * stays pinned where it was while the devices slide past it, and because
 * `normalizePath` keeps the result orthogonal it reads as a plausible but
 * wrong route rather than as obvious breakage.
 *
 * Only the mover knows which of the two gestures happened, so the fix has to
 * live in the drag commit — the compiler sees final coordinates and cannot
 * tell a region translate from an individual reposition.
 */
export function translateManualWirePaths(
  wires: Wire[] | undefined,
  deltas: ReadonlyMap<ElementId, [number, number]>,
): Wire[] | undefined {
  if (!wires || wires.length === 0 || deltas.size === 0) return wires;
  let changed = false;
  const next = wires.map((w) => {
    // <= 2 points is endpoints only — nothing the compiler doesn't already
    // rebase, so leave the document untouched.
    if (!w.path || w.path.length <= 2) return w;
    const a = deltas.get(endOwner(w.ends[0]));
    const b = deltas.get(endOwner(w.ends[1]));
    if (!a || !b) return w;
    // Both ends moving but by different amounts isn't a translate; the route
    // has to re-adapt, same as the single-end case.
    if (a[0] !== b[0] || a[1] !== b[1]) return w;
    if (a[0] === 0 && a[1] === 0) return w;
    changed = true;
    return {
      ...w,
      path: w.path.map(([x, y]) => [x + a[0], y + a[1]] as [number, number]),
    };
  });
  return changed ? next : wires;
}
