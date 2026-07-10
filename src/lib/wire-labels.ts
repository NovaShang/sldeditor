/**
 * Wire label placement shared by the canvas annotation layer and the
 * SVG / DXF exporters — the wire-side sibling of `element-labels.ts`.
 * Keeping the math in one place ensures the three surfaces stay
 * byte-identical: what the user sees on the canvas is what lands in the
 * exported file.
 *
 * Wires never rotate or mirror, so placement is simpler than `placeLabel`:
 * anchor at the midpoint of the wire's *longest* rendered segment (the most
 * visually prominent stretch — short stubs near terminals make bad homes for
 * text) and offset perpendicular so the label never sits on the line. Text
 * always stays upright:
 *   - horizontal segment → centered above the midpoint
 *   - vertical segment   → to the right of the midpoint, flowing right
 */

import { LABEL_FONT_SIZE } from './element-labels';

/** Perpendicular clearance between the wire line and the label text. */
export const WIRE_LABEL_OFFSET = 8;

/** Fully-resolved label placement for one wire. */
export interface PlacedWireLabel {
  /** World position of the text anchor point (SVG baseline). */
  world: [number, number];
  /** SVG `text-anchor`: horizontal segments center, vertical ones flow right. */
  textAnchor: 'start' | 'middle';
}

/**
 * Place a wire label along a rendered polyline. Returns `null` when the path
 * is degenerate (fewer than two points, or zero length) — callers skip the
 * label entirely in that case.
 */
export function placeWireLabel(
  path: readonly [number, number][],
): PlacedWireLabel | null {
  if (path.length < 2) return null;

  // Longest segment wins; ties keep the earliest (deterministic).
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const len = Math.hypot(
      path[i + 1][0] - path[i][0],
      path[i + 1][1] - path[i][1],
    );
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  if (best < 0 || bestLen <= 0) return null;

  const [ax, ay] = path[best];
  const [bx, by] = path[best + 1];
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;

  // Paths are orthogonal by invariant; classify by dominant axis so a stray
  // diagonal from legacy data still gets a sensible placement.
  if (Math.abs(bx - ax) >= Math.abs(by - ay)) {
    // Horizontal run: center the text above the midpoint.
    return { world: [mx, my - WIRE_LABEL_OFFSET], textAnchor: 'middle' };
  }
  // Vertical run: text to the right of the midpoint. The +FONT_SIZE/3 nudges
  // the baseline so the line sits visually centered on the wire (same
  // convention as `fallbackAnchor` in element-labels.ts).
  return {
    world: [mx + WIRE_LABEL_OFFSET, my + LABEL_FONT_SIZE / 3],
    textAnchor: 'start',
  };
}
