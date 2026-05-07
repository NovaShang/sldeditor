/**
 * Build the SVG `transform` string for an element placement. Shared between
 * the React renderer (ElementLayer / SelectionOverlay) and DOM-direct drag
 * updates (SelectTool) so what React commits matches what the drag drew.
 *
 * Composition (SVG applies left-to-right, parent-frame first):
 *   translate(at) → rotate(rot) → scale(mirror?-1:1, 1) → stretch(span)
 */

import type { LibraryEntry } from '../model';
import type { ResolvedPlacement } from '../compiler';

export function transformAttr(
  p: ResolvedPlacement,
  lib?: LibraryEntry,
): string {
  const parts = [`translate(${p.at[0]} ${p.at[1]})`];
  if (p.rot) parts.push(`rotate(${p.rot})`);
  if (p.mirror) parts.push(`scale(-1 1)`);

  const stretch = lib?.stretchable;
  if (stretch && p.span) {
    const k = p.span / stretch.naturalSpan;
    parts.push(stretch.axis === 'x' ? `scale(${k} 1)` : `scale(1 ${k})`);
  }
  return parts.join(' ');
}
