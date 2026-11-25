/**
 * Pointer helpers for drawing sheets: which sheet a click landed on, and what
 * a sheet drag carries along.
 *
 * A sheet is only "hit" on its border lines or its title block — the blank
 * paper inside is deliberately not a target, so a click there behaves exactly
 * like a click on empty canvas (marquee, deselect) and drawing inside a sheet
 * works as it did before sheets existed. The old annotation frame got this
 * wrong in the other direction: its rect was an object like any other, so a
 * marquee over the devices dragged the frame along (2026-09/10 chats).
 */

import type { InternalModel } from '../compiler';
import { targetBox } from '../health/present';
import type {
  AnnotationId,
  DiagramFile,
  ElementId,
  EnclosureAnnotation,
} from '../model';
import { sheetRect, type Sheet } from '../model/sheet';

/** The sheet whose border / title-block hit area is under the pointer. */
export function hitSheet(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  // Only the hit shapes count. The sheet group itself also matches
  // `[data-sheet-id]`, but nothing else in it takes pointer events, so this
  // guard is about intent, not a live bug: a future visible child that opts
  // into pointer events must not turn the paper into a click target.
  if (!target.closest('.ole-sheet-hit, .ole-sheet-title-hit')) return null;
  return target.closest('[data-sheet-id]')?.getAttribute('data-sheet-id') ?? null;
}

/**
 * Ids a sheet drag carries: devices, buses and junctions whose box centre
 * lies inside the sheet's border, and annotations whose anchor does.
 *
 * This MUST match the store's `sheetContents` (store.ts), which decides what
 * `moveSheet` actually moves — the drag only previews it. SelectTool also
 * re-syncs every previewed element from the post-commit layout, so a drift
 * between the two would show as a preview that snaps back on release rather
 * than as a device left stranded at a stale DOM transform.
 */
export function sheetContentIds(
  d: DiagramFile,
  internal: InternalModel,
  sheet: Sheet,
): { elements: ElementId[]; annotations: AnnotationId[] } {
  return rectContentIds(d, internal, sheetRect(sheet));
}

/**
 * Ids an enclosure carries when it is Alt-dragged — the same containment rule
 * as a sheet (device/bus/junction box centre, annotation anchor), so "inside"
 * means one thing everywhere. The enclosure itself is never its own content.
 */
export function enclosureContentIds(
  d: DiagramFile,
  internal: InternalModel,
  enc: EnclosureAnnotation,
): { elements: ElementId[]; annotations: AnnotationId[] } {
  const r = { x: enc.at[0], y: enc.at[1], w: enc.size[0], h: enc.size[1] };
  const out = rectContentIds(d, internal, r);
  return { ...out, annotations: out.annotations.filter((id) => id !== enc.id) };
}

function rectContentIds(
  d: DiagramFile,
  internal: InternalModel,
  r: { x: number; y: number; w: number; h: number },
): { elements: ElementId[]; annotations: AnnotationId[] } {
  const inside = (p: readonly [number, number]) =>
    p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
  const elements: ElementId[] = [];
  for (const id of [
    ...internal.elements.keys(),
    ...internal.buses.keys(),
    ...internal.junctions.keys(),
  ]) {
    const b = targetBox(internal, id);
    if (b && inside([(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2])) elements.push(id);
  }
  const annotations = (d.annotations ?? []).filter((a) => inside(a.at)).map((a) => a.id);
  return { elements, annotations };
}
