/**
 * Sheets in the exporters: the maths a host needs to turn one drawing sheet
 * into one page, and the shared step that turns `diagram.sheets` into
 * primitives for the SVG and DXF writers.
 *
 * Kept here rather than in the host (SmartSLD's PDF writer) so the page a
 * sheet becomes is derived in exactly one place: the region is the sheet's
 * outer border (the 10 mm margin is already inside it, so a page maps
 * edge-to-edge), and the stroke floor follows the sheet's frame enlargement.
 */

import {
  MM_PER_UNIT,
  PRINT_STROKE_MIN_MM,
  clampSheetScale,
  sheetRect,
  type Sheet,
  type TitleBlockShared,
} from '../model/sheet';
import { sheetPrimitives, type SheetPrimitives } from '../model/sheet-render';
import { sheetFieldLabels, sheetOfText } from '../i18n/sheet-labels';

/** A world-space rectangle an export is cropped to. */
export interface ExportRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The world rect that becomes the page when this sheet is exported alone. */
export function sheetExportRegion(sheet: Sheet): ExportRegion {
  return sheetRect(sheet);
}

/**
 * Thinnest stroke (world units) to keep when this sheet is printed.
 *
 * A sheet at scale `s` prints shrunk by `s`, so a 1-unit wire (0.26 mm on the
 * canvas) lands on paper at 0.26/s mm — at 1:2 already fainter than the
 * 0.25 mm `PRINT_STROKE_MIN_MM`, which is the "lines are too faint" complaint.
 * The floor is expressed in world units so the exporter can compare it with
 * the widths it emits.
 */
export function sheetMinStroke(sheet: Sheet): number {
  return (PRINT_STROKE_MIN_MM * clampSheetScale(sheet.scale)) / MM_PER_UNIT;
}

/** `{ region, minStrokeWidth }` for `buildExportSvg` — one sheet as a page. */
export function sheetExportOptions(sheet: Sheet): { region: ExportRegion; minStrokeWidth: number } {
  return { region: sheetExportRegion(sheet), minStrokeWidth: sheetMinStroke(sheet) };
}

/**
 * Every sheet's primitives, labelled in the current locale and numbered by
 * array position — the same text the canvas frame shows.
 */
export function exportSheetPrimitives(
  sheets: readonly Sheet[],
  shared: TitleBlockShared | undefined,
): SheetPrimitives[] {
  const labels = sheetFieldLabels();
  return sheets.map((s, i) => sheetPrimitives(s, shared, labels, sheetOfText(i + 1, sheets.length)));
}

/** Whether two world boxes overlap (edges touching counts). */
export function regionHits(
  r: ExportRegion,
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return b.maxX >= r.x && b.minX <= r.x + r.w && b.maxY >= r.y && b.minY <= r.y + r.h;
}
