/**
 * Drawing sheets (图纸页): a paper-sized frame with a title block, placed on
 * the same canvas as the drawing. A project can hold several, side by side,
 * and each exports as its own page.
 *
 * Why sheets are a model object and not annotations: SmartSLD used to build
 * the frame from three plain annotations (two rects and a table). Users then
 * hit every limit of that at once (2026-09/10 chats): a marquee over the
 * devices dragged the frame along, the title block could only be edited cell
 * by cell, nothing could export "just page 2", and a drawing larger than A4
 * could not be put "into the frame" the way CAD does with a plot scale.
 *
 * Scale, the one idea to hold on to: a sheet never moves or shrinks the user's
 * drawing. When the drawing is bigger than the paper, the FRAME grows on the
 * canvas (`scale` 1.5 = the sheet is drawn 1.5× paper size) and the export
 * shrinks the whole page back onto the paper — CAD's plot scale. Everything
 * the frame draws itself (border, title block, its text) grows with it, so it
 * prints at the same physical size on every sheet.
 *
 * Units: a canvas unit is a CSS px at 96 dpi, 1 unit = 25.4/96 mm — the same
 * convention the old annotation frame used, so its sizes carry over.
 */

import type { Annotation, DiagramFile } from './types';

export type PaperId = 'a4' | 'a3' | 'a2' | 'a1';
export type SheetOrientation = 'landscape' | 'portrait';

export interface Sheet {
  id: string;
  paper: PaperId;
  orientation: SheetOrientation;
  /** Top-left corner of the sheet's outer border, world units. */
  at: [number, number];
  /**
   * Frame enlargement: the sheet is drawn `scale`× paper size on the canvas
   * and printed back at 1×. Absent → 1. Clamped to SHEET_SCALE_MIN…MAX.
   */
  scale?: number;
  /** Per-sheet title-block fields. */
  title?: string;
  number?: string;
  date?: string;
  /** Free text for the title block's "scale" cell (e.g. "NTS"). The frame
   *  enlargement above is NOT written here: on a schematic it is a plot
   *  factor, not a drawing scale, and printing "1:1.5" would mislead. */
  scaleText?: string;
}

/** Title-block fields shared by every sheet of the document (`meta.titleBlock`). */
export interface TitleBlockShared {
  project?: string;
  client?: string;
  designer?: string;
  checker?: string;
}

/** Per-sheet title-block field names (on `Sheet`). */
export const SHEET_OWN_FIELDS = ['title', 'number', 'date', 'scaleText'] as const;
/** Shared title-block field names (on `meta.titleBlock`). */
export const SHEET_SHARED_FIELDS = ['project', 'client', 'designer', 'checker'] as const;
export type SheetOwnField = (typeof SHEET_OWN_FIELDS)[number];
export type SheetSharedField = (typeof SHEET_SHARED_FIELDS)[number];

// ── paper ────────────────────────────────────────────────────────────────

export const UNITS_PER_MM = 96 / 25.4;
export const MM_PER_UNIT = 25.4 / 96;

/** Landscape [width, height], mm (ISO 216). Portrait swaps them. */
export const PAPER_MM: Record<PaperId, readonly [number, number]> = {
  a4: [297, 210],
  a3: [420, 297],
  a2: [594, 420],
  a1: [841, 594],
};
export const PAPER_ORDER: readonly PaperId[] = ['a4', 'a3', 'a2', 'a1'];
export const PAPER_LABEL: Record<PaperId, string> = { a4: 'A4', a3: 'A3', a2: 'A2', a1: 'A1' };

/** Border inset, mm. 10 all round is the common minimum on ISO 5457 sheets. */
export const SHEET_MARGIN_MM = 10;
/** Gap between sheets placed side by side, mm (times the sheet's scale). */
export const SHEET_GAP_MM = 20;

export const SHEET_SCALE_MIN = 1;
export const SHEET_SCALE_MAX = 20;
/** Enlargements offered when fitting a frame to a drawing, so the user sees
 *  "1 : 1.5", not "1 : 1.4373". */
export const NICE_SCALES = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20] as const;

export function clampSheetScale(s: unknown): number {
  if (typeof s !== 'number' || !Number.isFinite(s) || s <= 0) return 1;
  return Math.min(SHEET_SCALE_MAX, Math.max(SHEET_SCALE_MIN, s));
}

/** Paper size in mm, oriented. */
export function paperMm(paper: PaperId, orientation: SheetOrientation): [number, number] {
  const [long, short] = PAPER_MM[paper] ?? PAPER_MM.a4;
  return orientation === 'portrait' ? [short, long] : [long, short];
}

/** The sheet's outer border on the canvas: `{ x, y, w, h }`, world units. */
export function sheetRect(sheet: Sheet): { x: number; y: number; w: number; h: number } {
  const [wmm, hmm] = paperMm(sheet.paper, sheet.orientation);
  const s = clampSheetScale(sheet.scale);
  return { x: sheet.at[0], y: sheet.at[1], w: wmm * UNITS_PER_MM * s, h: hmm * UNITS_PER_MM * s };
}

/** "1 : 1.5" style. */
export function formatSheetScale(scale: number | undefined): string {
  const s = clampSheetScale(scale);
  return `1 : ${Number.isInteger(s) ? s : String(Math.round(s * 100) / 100)}`;
}

// ── title block geometry (mm at scale 1, bottom-right of the inner border) ──

/** Column widths: label, value, label, value. */
export const TITLE_COLS_MM = [20, 70, 20, 70] as const;
export const TITLE_ROW_MM = 7;
export const TITLE_ROWS = 5;
export const TITLE_W_MM = TITLE_COLS_MM.reduce((a, b) => a + b, 0);
export const TITLE_H_MM = TITLE_ROW_MM * TITLE_ROWS;
/** Text sizes inside the title block, mm (font size, not cap height). */
export const TITLE_LABEL_FONT_MM = 2.2;
export const TITLE_VALUE_FONT_MM = 3;

/**
 * The drawing area a sheet leaves for content: inside the inner border and
 * above the title block band (world units). Used to fit a frame around a
 * drawing so nothing lands under the title block.
 */
export function sheetContentArea(sheet: Sheet): { x: number; y: number; w: number; h: number } {
  const r = sheetRect(sheet);
  const k = UNITS_PER_MM * clampSheetScale(sheet.scale);
  const m = SHEET_MARGIN_MM * k;
  return { x: r.x + m, y: r.y + m, w: r.w - 2 * m, h: r.h - 2 * m - (TITLE_H_MM + 5) * k };
}

// ── legibility ───────────────────────────────────────────────────────────

/** Label font size the editor uses when `meta.labelFontSize` is absent. */
export const DEFAULT_LABEL_FONT = 7;
/**
 * Printed text below this font size (mm) is flagged. 1.8 mm is the smallest
 * nominal size in ISO 3098; the editor's default 7-unit labels print at
 * 1.85 mm on a 1:1 sheet, so a plain sheet is fine and the warning appears
 * exactly when a frame is enlarged and the labels shrink on paper.
 */
export const PRINT_TEXT_MIN_MM = 1.8;
/** What "enlarge labels for print" aims for (common minimum on drawings). */
export const PRINT_TEXT_TARGET_MM = 2.5;
/** Thinnest printed line the export keeps (mm). */
export const PRINT_STROKE_MIN_MM = 0.25;

/** Printed size (mm) of text `fontUnits` tall on a sheet at `scale`. */
export function printedMm(fontUnits: number, scale: number | undefined): number {
  return (fontUnits * MM_PER_UNIT) / clampSheetScale(scale);
}

/** Label font size (units) that prints at the target size on this sheet. */
export function labelFontForPrint(scale: number | undefined): number {
  return Math.ceil((PRINT_TEXT_TARGET_MM * clampSheetScale(scale)) / MM_PER_UNIT);
}

// ── fitting ──────────────────────────────────────────────────────────────

/**
 * Smallest NICE_SCALES enlargement whose content area holds a box of
 * `w × h` world units on this paper. Beyond the list, the exact ratio.
 */
export function fitScale(
  w: number,
  h: number,
  paper: PaperId,
  orientation: SheetOrientation,
): number {
  const probe: Sheet = { id: '', paper, orientation, at: [0, 0], scale: 1 };
  const a = sheetContentArea(probe);
  const need = Math.max(w / a.w, h / a.h, 1);
  const nice = NICE_SCALES.find((s) => s >= need - 1e-9);
  return clampSheetScale(nice ?? Math.ceil(need));
}

/**
 * Where a sheet goes so its content area is centred on `box` (world
 * `{ minX, minY, maxX, maxY }`).
 */
export function sheetAroundBox(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  paper: PaperId,
  orientation: SheetOrientation,
  scale: number,
): [number, number] {
  const probe: Sheet = { id: '', paper, orientation, at: [0, 0], scale };
  const a = sheetContentArea(probe);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return [Math.round(cx - (a.x + a.w / 2)), Math.round(cy - (a.y + a.h / 2))];
}

/** A fresh `S<n>` id not used by any sheet. */
export function nextSheetId(sheets: readonly Sheet[] | undefined): string {
  const used = new Set((sheets ?? []).map((s) => s.id));
  let n = 1;
  while (used.has(`S${n}`)) n++;
  return `S${n}`;
}

/** Index of the sheet whose border contains the point, or -1. */
export function sheetIndexAt(sheets: readonly Sheet[] | undefined, p: readonly [number, number]): number {
  return (sheets ?? []).findIndex((s) => {
    const r = sheetRect(s);
    return p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
  });
}

// ── the old annotation frame ─────────────────────────────────────────────

/** Ids SmartSLD gave the three annotations of its pre-sheet frame. */
export const LEGACY_FRAME_IDS = { border: 'frame_border', inner: 'frame_inner', title: 'frame_title' } as const;

/**
 * Turn the old three-annotation frame into sheet 1, unchanged in place and
 * size, carrying over what was typed into its title table. Returns the input
 * untouched when there is nothing to migrate (no frame, or sheets already).
 *
 * The old table's rows were, in order: title, drawing no., date, scale,
 * drawn by (see SmartSLD's `drawing-frame.ts`); its sizes were exact ISO
 * paper at 1 unit = 1 CSS px.
 */
export function migrateLegacyFrame(d: DiagramFile): DiagramFile {
  if (d.sheets?.length) return d;
  const anns = d.annotations ?? [];
  const border = anns.find((a) => a.id === LEGACY_FRAME_IDS.border) as
    | (Annotation & { type: 'rect'; size: [number, number] })
    | undefined;
  if (!border || (border as { type?: string }).type !== 'rect') return d;
  const [bw, bh] = border.size;
  let best: { paper: PaperId; orientation: SheetOrientation; err: number } | null = null;
  for (const paper of PAPER_ORDER) {
    for (const orientation of ['landscape', 'portrait'] as const) {
      const [w, h] = paperMm(paper, orientation).map((v) => v * UNITS_PER_MM);
      const err = Math.abs(w - bw) / w + Math.abs(h - bh) / h;
      if (!best || err < best.err) best = { paper, orientation, err };
    }
  }
  // Not one of ours (a user rect that happens to carry the id): leave it.
  if (!best || best.err > 0.05) return d;
  const title = anns.find((a) => a.id === LEGACY_FRAME_IDS.title) as
    | { cells?: string[][] }
    | undefined;
  const cell = (r: number) => {
    const v = title?.cells?.[r]?.[1];
    return typeof v === 'string' && v.trim() ? v : undefined;
  };
  const sheet: Sheet = {
    id: 'S1',
    paper: best.paper,
    orientation: best.orientation,
    at: [border.at[0], border.at[1]],
    ...(cell(0) ? { title: cell(0) } : {}),
    ...(cell(1) ? { number: cell(1) } : {}),
    ...(cell(2) ? { date: cell(2) } : {}),
    ...(cell(3) ? { scaleText: cell(3) } : {}),
  };
  const designer = cell(4);
  const drop = new Set<string>(Object.values(LEGACY_FRAME_IDS));
  return {
    ...d,
    sheets: [sheet],
    annotations: anns.filter((a) => !drop.has(a.id)),
    ...(designer
      ? { meta: { ...d.meta, titleBlock: { ...d.meta?.titleBlock, designer: d.meta?.titleBlock?.designer ?? designer } } }
      : {}),
  };
}
