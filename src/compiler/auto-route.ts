/**
 * Best-effort orthogonal routing per ConnectivityNode.
 *
 * Cases:
 *   - Bus node (any terminal belongs to a bus element): every external
 *     terminal stubs straight to its projection on the bus axis.
 *   - 2-terminal node: single L-shape.
 *   - N-terminal node: each terminal L-shapes to the centroid of the cluster.
 *   - Dangling node (1 terminal): no path.
 */

import type { ConnectivityNode, InternalModel, InternalRoute } from './internal-model';

type Pt = [number, number];

export function autoRoute(node: ConnectivityNode, model: InternalModel): InternalRoute {
  // Resolve terminals; bucket by whether they belong to a bus element.
  const externals: { world: Pt }[] = [];
  const buses: { axis: 'x' | 'y'; pos: Pt; span: number }[] = [];
  const busIdsSeen = new Set<string>();

  for (const ref of node.terminals) {
    const term = model.terminals.get(ref);
    if (!term) continue;
    const re = model.elements.get(term.elementId);
    if (re?.element.kind === 'busbar') {
      if (busIdsSeen.has(term.elementId)) continue;
      busIdsSeen.add(term.elementId);
      const place = model.layout.get(term.elementId);
      if (!place) continue;
      const span = place.span ?? 600;
      const axis: 'x' | 'y' = place.rot === 90 || place.rot === 270 ? 'y' : 'x';
      buses.push({ axis, pos: place.at as Pt, span });
    } else {
      externals.push({ world: term.world });
    }
  }

  // Bus node: project externals onto closest bus axis.
  if (buses.length > 0) {
    const paths: Pt[][] = [];
    for (const ex of externals) {
      const bus = buses[0];
      let target: Pt;
      if (bus.axis === 'x') {
        const minX = bus.pos[0] - bus.span / 2;
        const maxX = bus.pos[0] + bus.span / 2;
        const px = clamp(ex.world[0], minX, maxX);
        target = [px, bus.pos[1]];
      } else {
        const minY = bus.pos[1] - bus.span / 2;
        const maxY = bus.pos[1] + bus.span / 2;
        const py = clamp(ex.world[1], minY, maxY);
        target = [bus.pos[0], py];
      }
      paths.push(makeOrthogonalPath(ex.world, target));
    }
    return { paths };
  }

  if (externals.length < 2) return { paths: [] };

  if (externals.length === 2) {
    return { paths: [makeOrthogonalPath(externals[0].world, externals[1].world)] };
  }

  // N-terminal: star to centroid.
  const cx = avg(externals.map((e) => e.world[0]));
  const cy = avg(externals.map((e) => e.world[1]));
  const centroid: Pt = [cx, cy];
  return {
    paths: externals.map((ex) => makeOrthogonalPath(ex.world, centroid)),
  };
}

function makeOrthogonalPath(a: Pt, b: Pt): Pt[] {
  if (a[0] === b[0] || a[1] === b[1]) return [a, b];
  // L-shape with knee on (a.x, b.y); arbitrary but consistent.
  return [a, [a[0], b[1]], b];
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const x of arr) s += x;
  return s / arr.length;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
