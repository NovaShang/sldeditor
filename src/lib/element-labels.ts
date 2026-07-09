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
  // Anchor at the symbol's right edge, vertically centered. The small
  // +FONT_SIZE/3 nudges the text baseline so a single line sits visually
  // centered on the symbol's mid-height rather than hanging below it.
  return {
    x: vb.x + vb.w + 2,
    y: vb.y + vb.h / 2 + LABEL_FONT_SIZE / 3,
    anchor: 'start',
  };
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

/** Fully-resolved label block placement for one element. */
export interface PlacedLabel {
  /** World position of the anchor point. */
  world: [number, number];
  /** Effective SVG `text-anchor` after accounting for rotation/mirror. */
  textAnchor: 'start' | 'middle' | 'end';
  /**
   * Baseline offset of the *first* line relative to `world[1]`. Line `i`
   * renders at `world[1] + dy + i * LABEL_LINE_HEIGHT`.
   */
  dy: number;
}

/**
 * Place a label block next to a (possibly rotated/mirrored) symbol. The
 * declared anchor position rotates with the placement (`anchorWorld`), but
 * text stays upright — so the *alignment* must rotate too, or a right-side
 * `start` label ends up running back across the symbol body at rot 180, and
 * across the wire at rot 90/270.
 *
 * We classify which side of the symbol the anchor landed on (dominant axis
 * of the centre→anchor vector, pushed through mirror+rotation) and align the
 * block so it extends *away* from the symbol:
 *   +x → 'start'   −x → 'end'
 *   +y → 'middle', first baseline dropped below the anchor
 *   −y → 'middle', lines stacked upward so the block ends at the anchor
 * At rot 0 / no mirror this reproduces the declared anchor exactly.
 */
export function placeLabel(
  anchor: LibraryLabelAnchor,
  lib: LibraryEntry,
  place: ResolvedPlacement,
  lineCount: number,
): PlacedLabel {
  const world = anchorWorld(anchor, place);
  const declared = anchor.anchor ?? 'start';

  // Outward vector: viewBox centre → anchor, in library space, then through
  // the placement's mirror+rotation (direction only — no translation).
  const vb = parseViewBox(lib.viewBox);
  let ox = anchor.x - (vb ? vb.x + vb.w / 2 : 0);
  let oy = anchor.y - (vb ? vb.y + vb.h / 2 : 0);
  if (place.mirror) ox = -ox;
  switch (place.rot) {
    case 90:
      [ox, oy] = [-oy, ox];
      break;
    case 180:
      [ox, oy] = [-ox, -oy];
      break;
    case 270:
      [ox, oy] = [oy, -ox];
      break;
    default:
      break;
  }

  // Degenerate anchor at the symbol centre — keep the declared alignment.
  if (Math.abs(ox) < 1e-6 && Math.abs(oy) < 1e-6) {
    return { world, textAnchor: declared, dy: 0 };
  }

  if (Math.abs(ox) >= Math.abs(oy)) {
    // Label sits beside the symbol: flow the text away horizontally, first
    // baseline at the anchor (matches historical rot-0 behavior).
    return { world, textAnchor: ox >= 0 ? 'start' : 'end', dy: 0 };
  }
  if (oy > 0) {
    // Below the symbol: centre the block and drop the first baseline clear
    // of the anchor point (which sits on the symbol's outer edge).
    return { world, textAnchor: 'middle', dy: LABEL_FONT_SIZE };
  }
  // Above the symbol: centre the block and stack extra lines upward so the
  // whole block stays clear of the symbol.
  return {
    world,
    textAnchor: 'middle',
    dy: -(lineCount - 1) * LABEL_LINE_HEIGHT,
  };
}

function parseViewBox(
  s: string,
): { x: number; y: number; w: number; h: number } | null {
  const parts = s.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}
