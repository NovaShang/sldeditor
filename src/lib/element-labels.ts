/**
 * Structural label helpers shared by the canvas annotation layer and the
 * SVG / DXF exporters. Keeping these in one place ensures the three surfaces
 * stay byte-identical: what the user sees on the canvas is what lands in the
 * exported file.
 */

import type { ResolvedElement, ResolvedPlacement } from '../compiler';
import type { LabelMode, LibraryEntry, LibraryLabelAnchor } from '../model';

/** Vertical step between stacked label lines, in canvas units. */
export const LABEL_LINE_HEIGHT = 9;

/** Font size used for element structural labels, in canvas units. */
export const LABEL_FONT_SIZE = 7;

export function labelLines(re: ResolvedElement, mode: LabelMode): string[] {
  const lines: string[] = [];
  const head = re.element.name?.trim() || re.element.id;
  if (head) lines.push(head);
  if (mode !== 'all' || !re.libraryDef?.params) return lines;
  const params = re.element.params ?? {};
  for (const p of re.libraryDef.params) {
    if (!p.showOnCanvas) continue;
    const v = params[p.name];
    if (v === undefined || v === null || v === '') continue;
    lines.push(`${v}${p.unit ?? ''}`);
  }
  return lines;
}

export function fallbackAnchor(lib: LibraryEntry): LibraryLabelAnchor {
  const vb = parseViewBox(lib.viewBox);
  if (!vb) return { x: 0, y: 0, anchor: 'start' };
  return { x: vb.x + vb.w + 2, y: vb.y + 4, anchor: 'start' };
}

/**
 * Project the library-local anchor through the element's placement so the
 * label lands next to the symbol regardless of rotation/mirror, but the text
 * itself stays upright (we never rotate the label group).
 */
export function anchorWorld(
  anchor: LibraryLabelAnchor,
  place: ResolvedPlacement,
): [number, number] {
  let x = anchor.x;
  let y = anchor.y;
  if (place.mirror) x = -x;
  switch (place.rot) {
    case 90:
      [x, y] = [-y, x];
      break;
    case 180:
      [x, y] = [-x, -y];
      break;
    case 270:
      [x, y] = [y, -x];
      break;
    default:
      break;
  }
  return [x + place.at[0], y + place.at[1]];
}

function parseViewBox(
  s: string,
): { x: number; y: number; w: number; h: number } | null {
  const parts = s.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}
