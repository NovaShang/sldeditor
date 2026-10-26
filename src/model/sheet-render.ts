/**
 * What a sheet draws — outer border, inner border, title block and its text —
 * as plain world-coordinate primitives. The canvas layer and every exporter
 * (SVG / PNG / PDF / DXF) render from this one function, so the frame on
 * screen and the frame on paper can never disagree.
 */

import {
  SHEET_MARGIN_MM,
  TITLE_COLS_MM,
  TITLE_LABEL_FONT_MM,
  TITLE_ROW_MM,
  TITLE_ROWS,
  TITLE_VALUE_FONT_MM,
  TITLE_W_MM,
  UNITS_PER_MM,
  clampSheetScale,
  sheetRect,
  type Sheet,
  type SheetOwnField,
  type SheetSharedField,
  type TitleBlockShared,
} from './sheet';

export interface SheetRectPrim {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stroke width, world units. */
  stroke: number;
}
export interface SheetLinePrim {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: number;
}
export interface SheetTextPrim {
  x: number;
  /** Baseline. */
  y: number;
  text: string;
  /** Font size, world units. */
  size: number;
  /** `'label'` = field name (muted), `'value'` = what the user typed. */
  role: 'label' | 'value';
}

export interface SheetPrimitives {
  /** Outer border (index 0) and inner border (index 1). */
  rects: SheetRectPrim[];
  /** Title block outline and grid. */
  lines: SheetLinePrim[];
  texts: SheetTextPrim[];
  /** Title block outline, world units — the clickable "title block" area. */
  titleBlock: { x: number; y: number; w: number; h: number };
}

/** Field names, already translated by the caller. */
export type SheetFieldLabels = Record<SheetOwnField | SheetSharedField | 'sheetNo', string>;

/** Title-block rows: [left field, right field]; `sheetNo` spans the last row. */
const ROWS: [SheetOwnField | SheetSharedField | 'sheetNo', SheetOwnField | SheetSharedField | null][] = [
  ['project', 'client'],
  ['title', 'number'],
  ['designer', 'checker'],
  ['date', 'scaleText'],
  ['sheetNo', null],
];

/**
 * @param sheetOf  the "sheet n of N" text, already formatted by the caller.
 */
export function sheetPrimitives(
  sheet: Sheet,
  shared: TitleBlockShared | undefined,
  labels: SheetFieldLabels,
  sheetOf: string,
): SheetPrimitives {
  const r = sheetRect(sheet);
  const k = UNITS_PER_MM * clampSheetScale(sheet.scale);
  const m = SHEET_MARGIN_MM * k;
  const thick = 0.5 * k; // ≈ 0.5 mm printed
  const thin = 0.25 * k;

  const rects: SheetRectPrim[] = [
    { x: r.x, y: r.y, w: r.w, h: r.h, stroke: thin },
    { x: r.x + m, y: r.y + m, w: r.w - 2 * m, h: r.h - 2 * m, stroke: thick },
  ];

  const tw = TITLE_W_MM * k;
  const rh = TITLE_ROW_MM * k;
  const th = rh * TITLE_ROWS;
  const tx = r.x + r.w - m - tw;
  const ty = r.y + r.h - m - th;
  const cols = TITLE_COLS_MM.map((c) => c * k);
  const colX = [tx, tx + cols[0], tx + cols[0] + cols[1], tx + cols[0] + cols[1] + cols[2]];

  const lines: SheetLinePrim[] = [];
  // Outline (top and left; right/bottom are the inner border).
  lines.push({ x1: tx, y1: ty, x2: tx + tw, y2: ty, stroke: thick });
  lines.push({ x1: tx, y1: ty, x2: tx, y2: ty + th, stroke: thick });
  for (let i = 1; i < TITLE_ROWS; i++) {
    lines.push({ x1: tx, y1: ty + i * rh, x2: tx + tw, y2: ty + i * rh, stroke: thin });
  }
  // Column rules; the last row has one label and a value spanning the rest.
  for (let c = 1; c < 4; c++) {
    const bottom = c === 1 ? ty + th : ty + (TITLE_ROWS - 1) * rh;
    lines.push({ x1: colX[c], y1: ty, x2: colX[c], y2: bottom, stroke: thin });
  }

  const value = (f: SheetOwnField | SheetSharedField | 'sheetNo'): string => {
    if (f === 'sheetNo') return sheetOf;
    if (f === 'project' || f === 'client' || f === 'designer' || f === 'checker') return shared?.[f] ?? '';
    return sheet[f] ?? '';
  };
  const pad = 1.5 * k;
  const labelSize = TITLE_LABEL_FONT_MM * k;
  const valueSize = TITLE_VALUE_FONT_MM * k;
  const texts: SheetTextPrim[] = [];
  ROWS.forEach(([left, right], i) => {
    const base = ty + i * rh + rh / 2 + valueSize * 0.35;
    const cells: [typeof left, number][] = [[left, 0]];
    if (right) cells.push([right, 2]);
    for (const [f, c] of cells) {
      texts.push({ x: colX[c] + pad, y: base, text: labels[f], size: labelSize, role: 'label' });
      const v = value(f);
      if (v) texts.push({ x: colX[c + 1] + pad, y: base, text: v, size: valueSize, role: 'value' });
    }
  });

  return { rects, lines, texts, titleBlock: { x: tx, y: ty, w: tw, h: th } };
}
