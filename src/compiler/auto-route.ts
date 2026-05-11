/**
 * Best-effort orthogonal routing per Wire. Each visible polyline maps 1-to-1
 * to a Wire, so selecting / deleting at the wire level just works.
 *
 * Routing rules per wire `[a, b]`:
 *   - If one end is a bus: project the other end onto the bus axis, L-shape
 *     to that point.
 *   - Otherwise: simple L-shape between the two terminal world coords.
 */

import type { Wire, WireEnd, WireId } from '../model';
import type { InternalModel } from './internal-model';

type Pt = [number, number];

export interface WireRoute {
  wireId: WireId;
  path: Pt[];
}

export function routeWire(wire: Wire, model: InternalModel): WireRoute | null {
  const a = wire.ends[0];
  const b = wire.ends[1];
  const aBus = isBus(a, model);
  const bBus = isBus(b, model);
  // Bus end → project the other end onto the bus axis.
  if (aBus || bBus) {
    const bus = aBus ? a : b;
    const other = aBus ? b : a;
    const otherWorld = endWorld(other, model);
    if (!otherWorld) return null;
    const rb = model.buses.get(bus);
    if (!rb) return null;
    const { axis, at, span } = rb.geometry;
    const half = span / 2;
    let target: Pt;
    if (axis === 'x') {
      const x = clamp(otherWorld[0], at[0] - half, at[0] + half);
      target = [x, at[1]];
    } else {
      const y = clamp(otherWorld[1], at[1] - half, at[1] + half);
      target = [at[0], y];
    }
    return { wireId: wire.id, path: orthogonalPath(otherWorld, target) };
  }
  const aw = endWorld(a, model);
  const bw = endWorld(b, model);
  if (!aw || !bw) return null;
  return { wireId: wire.id, path: orthogonalPath(aw, bw) };
}

function isBus(end: WireEnd, model: InternalModel): boolean {
  return !end.includes('.') && model.buses.has(end);
}

function endWorld(end: WireEnd, model: InternalModel): Pt | null {
  if (!end.includes('.')) {
    const rb = model.buses.get(end);
    return rb ? (rb.geometry.at as Pt) : null;
  }
  const term = model.terminals.get(end as `${string}.${string}`);
  return term ? (term.world as Pt) : null;
}

function orthogonalPath(a: Pt, b: Pt): Pt[] {
  if (a[0] === b[0] || a[1] === b[1]) return [a, b];
  return [a, [a[0], b[1]], b];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
