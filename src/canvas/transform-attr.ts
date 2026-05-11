/**
 * Build the SVG `transform` string for a device placement. Buses are
 * rendered separately by `BusLayer` and don't go through this helper.
 *
 * Composition (SVG applies left-to-right, parent-frame first):
 *   translate(at) → rotate(rot) → scale(mirror?-1:1, 1)
 */

import type { ResolvedPlacement } from '../compiler';

export function transformAttr(p: ResolvedPlacement): string {
  const parts = [`translate(${p.at[0]} ${p.at[1]})`];
  if (p.rot) parts.push(`rotate(${p.rot})`);
  if (p.mirror) parts.push(`scale(-1 1)`);
  return parts.join(' ');
}
