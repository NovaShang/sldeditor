/**
 * Shared geometry + defaults for free annotations (text / rect / line /
 * table). The canvas layer, the draft previews, the SVG exporter and the DXF
 * exporter all read from here so their renderings can't drift apart.
 */

import type {
  Annotation,
  LineAnnotation,
  RectAnnotation,
  TableAnnotation,
  TextAnnotation,
} from '../model';

// ---- Shared visual constants ---------------------------------------------

/** Base font for text annotations, rect labels and table cells. */
export const ANNOTATION_FONT_SIZE = 8;
export const ANNOTATION_LINE_HEIGHT = 1.25;

/** SVG dash pattern used by `stroke: 'dashed'` rects and lines. */
export const ANNOTATION_DASH = '6 4';

/** Faint wash used by `fill: 'tint'` (foreground color at this opacity). */
export const TINT_OPACITY = 0.05;

/** Arrowhead geometry (world units). */
export const ARROW_LENGTH = 8;
export const ARROW_HALF_WIDTH = 3;

/** Rect label inset from the top-left corner. */
export const RECT_LABEL_PAD = 4;

/** Table cell text padding and default grid cell size for the table tool. */
export const TABLE_CELL_PAD_X = 3;
export const TABLE_DEFAULT_CELL_W = 60;
export const TABLE_DEFAULT_CELL_H = 20;
export const TABLE_MIN_COL_W = 16;
export const TABLE_MIN_ROW_H = 12;

/** Minimum committed rect size / line length; smaller gestures are ignored. */
export const MIN_RECT_SIZE = 10;
export const MIN_LINE_LEN = 10;

// ---- Text ----------------------------------------------------------------

/**
 * Heuristic block size of a text annotation (~0.55 em per char). Mirrors the
 * canvas halo estimate; used for export bboxes.
 */
export function textBlockSize(
  text: string,
  fontSize: number,
): [number, number] {
  const lines = text === '' ? [''] : text.split('\n');
  const w = Math.max(20, ...lines.map((l) => l.length * fontSize * 0.55));
  return [w, lines.length * fontSize * ANNOTATION_LINE_HEIGHT];
}

// ---- Line ----------------------------------------------------------------

/** Absolute vertices of a line annotation (`points` are relative to `at`). */
export function lineAbsPoints(ann: LineAnnotation): [number, number][] {
  return ann.points.map(([dx, dy]) => [ann.at[0] + dx, ann.at[1] + dy]);
}

/**
 * Filled-triangle arrowheads for a polyline. Returns one triangle (3 world
 * points) per requested end, oriented along the adjacent segment.
 */
export function lineArrowHeads(
  pts: [number, number][],
  arrow: LineAnnotation['arrow'],
): [number, number][][] {
  if (!arrow || arrow === 'none' || pts.length < 2) return [];
  const heads: [number, number][][] = [];
  if (arrow === 'end' || arrow === 'both') {
    heads.push(arrowTriangle(pts[pts.length - 2], pts[pts.length - 1]));
  }
  if (arrow === 'both') {
    heads.push(arrowTriangle(pts[1], pts[0]));
  }
  return heads;
}

function arrowTriangle(
  from: [number, number],
  tip: [number, number],
): [number, number][] {
  const dx = tip[0] - from[0];
  const dy = tip[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = tip[0] - ux * ARROW_LENGTH;
  const by = tip[1] - uy * ARROW_LENGTH;
  // Perpendicular.
  const px = -uy;
  const py = ux;
  return [
    tip,
    [bx + px * ARROW_HALF_WIDTH, by + py * ARROW_HALF_WIDTH],
    [bx - px * ARROW_HALF_WIDTH, by - py * ARROW_HALF_WIDTH],
  ];
}

// ---- Table ---------------------------------------------------------------

export function tableSize(ann: TableAnnotation): [number, number] {
  return [sum(ann.colWidths), sum(ann.rowHeights)];
}

/** Cumulative x-offsets of column edges: `[0, w0, w0+w1, …, total]`. */
export function tableColEdges(ann: TableAnnotation): number[] {
  return cumulative(ann.colWidths);
}

/** Cumulative y-offsets of row edges: `[0, h0, h0+h1, …, total]`. */
export function tableRowEdges(ann: TableAnnotation): number[] {
  return cumulative(ann.rowHeights);
}

/**
 * Row/col index of the world point, or null when outside the table.
 */
export function tableCellAt(
  ann: TableAnnotation,
  world: [number, number],
): [number, number] | null {
  const x = world[0] - ann.at[0];
  const y = world[1] - ann.at[1];
  const [w, h] = tableSize(ann);
  if (x < 0 || y < 0 || x > w || y > h) return null;
  const col = edgeIndex(tableColEdges(ann), x);
  const row = edgeIndex(tableRowEdges(ann), y);
  if (col === null || row === null) return null;
  return [row, col];
}

function edgeIndex(edges: number[], v: number): number | null {
  for (let i = 0; i < edges.length - 1; i++) {
    if (v >= edges[i] && v <= edges[i + 1]) return i;
  }
  return null;
}

function cumulative(sizes: number[]): number[] {
  const out = [0];
  let acc = 0;
  for (const s of sizes) {
    acc += s;
    out.push(acc);
  }
  return out;
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

// ---- Draft gestures (drag-to-draw) ---------------------------------------

/** In-progress drag published by the rect/line/table tools. */
export interface AnnotationDraft {
  kind: 'rect' | 'line' | 'table';
  start: [number, number];
  current: [number, number];
  /** Shift held: square rects / 45°-stepped lines. */
  constrain: boolean;
}

/** Normalized rect from a draft (shift → square). Never zero-sized. */
export function draftRect(d: AnnotationDraft): {
  at: [number, number];
  size: [number, number];
} {
  let dx = d.current[0] - d.start[0];
  let dy = d.current[1] - d.start[1];
  if (d.constrain) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * m;
    dy = Math.sign(dy || 1) * m;
  }
  const at: [number, number] = [
    Math.min(d.start[0], d.start[0] + dx),
    Math.min(d.start[1], d.start[1] + dy),
  ];
  return { at, size: [Math.abs(dx), Math.abs(dy)] };
}

/** Line endpoint from a draft (shift → snap direction to 45° steps). */
export function draftLineEnd(d: AnnotationDraft): [number, number] {
  if (!d.constrain) return d.current;
  return constrain45(d.start, d.current);
}

/** Snap `to` so the segment `from → to` lies on a 45°-multiple direction. */
export function constrain45(
  from: [number, number],
  to: [number, number],
): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return to;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return [from[0] + Math.cos(angle) * len, from[1] + Math.sin(angle) * len];
}

/** Column/row counts + geometry for a table draft (Word-style grid dragger). */
export function draftTable(d: AnnotationDraft): {
  at: [number, number];
  cols: number;
  rows: number;
} {
  const w = Math.abs(d.current[0] - d.start[0]);
  const h = Math.abs(d.current[1] - d.start[1]);
  const cols = Math.min(30, Math.max(1, Math.round(w / TABLE_DEFAULT_CELL_W)));
  const rows = Math.min(60, Math.max(1, Math.round(h / TABLE_DEFAULT_CELL_H)));
  const at: [number, number] = [
    Math.min(d.start[0], d.current[0]),
    Math.min(d.start[1], d.current[1]),
  ];
  return { at, cols, rows };
}

/** Fresh table annotation body with uniform default cells. */
export function makeTableBody(
  cols: number,
  rows: number,
): Pick<TableAnnotation, 'colWidths' | 'rowHeights' | 'cells'> {
  return {
    colWidths: Array.from({ length: cols }, () => TABLE_DEFAULT_CELL_W),
    rowHeights: Array.from({ length: rows }, () => TABLE_DEFAULT_CELL_H),
    cells: Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ''),
    ),
  };
}

// ---- Bounding boxes -------------------------------------------------------

export interface AnnBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** World-space bbox of any annotation (text uses the width heuristic). */
export function annotationBBox(a: Annotation): AnnBBox {
  switch (a.type) {
    case 'rect': {
      const r = a as RectAnnotation;
      return {
        minX: r.at[0],
        minY: r.at[1],
        maxX: r.at[0] + r.size[0],
        maxY: r.at[1] + r.size[1],
      };
    }
    case 'line': {
      const pts = lineAbsPoints(a as LineAnnotation);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
      };
    }
    case 'table': {
      const t = a as TableAnnotation;
      const [w, h] = tableSize(t);
      return {
        minX: t.at[0],
        minY: t.at[1],
        maxX: t.at[0] + w,
        maxY: t.at[1] + h,
      };
    }
    default: {
      const t = a as TextAnnotation;
      const fs = t.fontSize ?? ANNOTATION_FONT_SIZE;
      const [w, h] = textBlockSize(t.text, fs);
      return {
        minX: t.at[0],
        minY: t.at[1],
        maxX: t.at[0] + w,
        maxY: t.at[1] + h,
      };
    }
  }
}
