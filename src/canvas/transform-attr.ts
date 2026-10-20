/**
 * Build the SVG `transform` string for a device placement. Buses are
 * rendered separately by `BusLayer` and don't go through this helper.
 *
 * Composition (SVG applies left-to-right, parent-frame first):
 *   translate(at) → rotate(rot) → scale(mirror?-s:s, s)   (s = placement scale)
 */

import type { ResolvedPlacement } from '../compiler';

export function transformAttr(p: ResolvedPlacement): string {
  const parts = [`translate(${p.at[0]} ${p.at[1]})`];
  if (p.rot) parts.push(`rotate(${p.rot})`);
  const s = p.scale ?? 1;
  if (p.mirror || s !== 1) parts.push(`scale(${p.mirror ? -s : s} ${s})`);
  return parts.join(' ');
}
