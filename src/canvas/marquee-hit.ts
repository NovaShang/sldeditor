/**
 * Marquee hit-testing: which model objects a dragged selection rect covers.
 *
 * Deliberately store-free and pure (compiled model + annotations in, ids out)
 * so the geometry can be unit-tested without a DOM. `SelectTool` is the only
 * caller; it feeds the result into the two selection channels.
 *
 * Wires are intentionally *not* hit-tested — wire selection stays a
 * single-target, click-only affordance (`selectedWire`).
 */

import type { InternalModel, ResolvedPlacement } from '../compiler';
import { annotationBBox } from '../lib/annotation-geom';
import type { Annotation, AnnotationId, ElementId } from '../model';
import type { MarqueeRect } from './marquee-bus';

export interface MarqueeHits {
  /** Devices, buses and junctions — the shared `selection` id namespace. */
  elements: ElementId[];
  /** Free annotations — a separate namespace, see `selectedAnnotations`. */
  annotations: AnnotationId[];
}

/**
 * Every object whose bbox intersects `rect`. Devices use their library
 * viewBox transformed by the resolved placement (approximated by the
 * axis-aligned bbox of the four transformed corners), buses their segment,
 * junctions their point, annotations their geometry bbox.
 */
export function hitsInRect(
  internal: InternalModel,
  annotations: readonly Annotation[] | undefined,
  rect: MarqueeRect,
): MarqueeHits {
  const elements: ElementId[] = [];

  for (const re of internal.elements.values()) {
    if (!re.libraryDef) continue;
    const place = internal.layout.get(re.element.id);
    if (!place) continue;
    const vb = parseViewBox(re.libraryDef.viewBox);
    if (!vb) continue;
    const corners: [number, number][] = [
      [vb.x, vb.y],
      [vb.x + vb.w, vb.y],
      [vb.x, vb.y + vb.h],
      [vb.x + vb.w, vb.y + vb.h],
    ].map(([x, y]) => transformLocalCorner([x, y], place));

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of corners) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (overlaps(rect, minX, minY, maxX, maxY)) elements.push(re.element.id);
  }

  // Buses: a horizontal/vertical segment is a tight rect.
  for (const { bus, geometry } of internal.buses.values()) {
    const { axis, at, span } = geometry;
    const half = span / 2;
    const minX = axis === 'x' ? at[0] - half : at[0];
    const maxX = axis === 'x' ? at[0] + half : at[0];
    const minY = axis === 'x' ? at[1] : at[1] - half;
    const maxY = axis === 'x' ? at[1] : at[1] + half;
    if (overlaps(rect, minX, minY, maxX, maxY)) elements.push(bus.id);
  }

  // Junctions: a point inside the rect.
  for (const { junction, world } of internal.junctions.values()) {
    if (overlaps(rect, world[0], world[1], world[0], world[1])) {
      elements.push(junction.id);
    }
  }

  // Free annotations: their rendered bbox (text uses the width heuristic the
  // canvas halo already draws with, so what looks caught *is* caught).
  const annotationHits: AnnotationId[] = [];
  for (const a of annotations ?? []) {
    const bb = annotationBBox(a);
    if (overlaps(rect, bb.minX, bb.minY, bb.maxX, bb.maxY)) {
      annotationHits.push(a.id);
    }
  }

  return { elements, annotations: annotationHits };
}

function overlaps(
  rect: MarqueeRect,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  return (
    maxX >= rect.x &&
    minX <= rect.x + rect.w &&
    maxY >= rect.y &&
    minY <= rect.y + rect.h
  );
}

function transformLocalCorner(
  pt: [number, number],
  p: ResolvedPlacement,
): [number, number] {
  let [x, y] = pt;
  if (p.mirror) x = -x;
  switch (p.rot) {
    case 0:
      break;
    case 90:
      [x, y] = [-y, x];
      break;
    case 180:
      [x, y] = [-x, -y];
      break;
    case 270:
      [x, y] = [y, -x];
      break;
  }
  return [x + p.at[0], y + p.at[1]];
}

function parseViewBox(s: string) {
  const parts = s.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}
