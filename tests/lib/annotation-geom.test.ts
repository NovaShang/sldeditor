/**
 * Shared annotation geometry — the single source of truth consumed by the
 * canvas layer, the drag previews and both exporters. These tests pin the
 * math so a refactor in one consumer can't silently skew the others.
 */

import { describe, expect, it } from 'vitest';
import {
  annotationBBox,
  constrain45,
  draftLineEnd,
  draftRect,
  draftTable,
  lineAbsPoints,
  lineArrowHeads,
  makeTableBody,
  TABLE_DEFAULT_CELL_H,
  TABLE_DEFAULT_CELL_W,
  tableCellAt,
  tableColEdges,
  tableSize,
} from '../../src/lib/annotation-geom';
import type { LineAnnotation, TableAnnotation } from '../../src/model';

const LINE: LineAnnotation = {
  id: 'a1',
  type: 'line',
  at: [100, 50],
  points: [
    [0, 0],
    [80, 60],
  ],
};

const TABLE: TableAnnotation = {
  id: 'a2',
  type: 'table',
  at: [10, 20],
  colWidths: [40, 60],
  rowHeights: [20, 30],
  cells: [
    ['a', 'b'],
    ['c', 'd'],
  ],
};

describe('line geometry', () => {
  it('resolves points relative to the anchor', () => {
    expect(lineAbsPoints(LINE)).toEqual([
      [100, 50],
      [180, 110],
    ]);
  });

  it('emits no arrowheads by default and per-end when requested', () => {
    const pts = lineAbsPoints(LINE);
    expect(lineArrowHeads(pts, undefined)).toHaveLength(0);
    expect(lineArrowHeads(pts, 'none')).toHaveLength(0);
    const end = lineArrowHeads(pts, 'end');
    expect(end).toHaveLength(1);
    // Tip of the arrow is the line's end vertex.
    expect(end[0][0]).toEqual([180, 110]);
    expect(lineArrowHeads(pts, 'both')).toHaveLength(2);
  });
});

describe('table geometry', () => {
  it('computes size and edges from track lists', () => {
    expect(tableSize(TABLE)).toEqual([100, 50]);
    expect(tableColEdges(TABLE)).toEqual([0, 40, 100]);
  });

  it('maps world points to cells (and rejects outside points)', () => {
    expect(tableCellAt(TABLE, [15, 25])).toEqual([0, 0]);
    expect(tableCellAt(TABLE, [95, 65])).toEqual([1, 1]);
    expect(tableCellAt(TABLE, [5, 25])).toBeNull();
    expect(tableCellAt(TABLE, [15, 200])).toBeNull();
  });

  it('builds an empty body of the requested shape', () => {
    const body = makeTableBody(3, 2);
    expect(body.colWidths).toHaveLength(3);
    expect(body.rowHeights).toHaveLength(2);
    expect(body.cells).toEqual([
      ['', '', ''],
      ['', '', ''],
    ]);
  });
});

describe('draft gestures', () => {
  it('normalizes a rect drag from any direction', () => {
    const d = draftRect({
      kind: 'rect',
      start: [100, 100],
      current: [40, 60],
      constrain: false,
    });
    expect(d.at).toEqual([40, 60]);
    expect(d.size).toEqual([60, 40]);
  });

  it('constrains a shift-rect to a square', () => {
    const d = draftRect({
      kind: 'rect',
      start: [0, 0],
      current: [80, 30],
      constrain: true,
    });
    expect(d.size).toEqual([80, 80]);
  });

  it('constrains a shift-line to 45° steps', () => {
    const end = draftLineEnd({
      kind: 'line',
      start: [0, 0],
      current: [100, 8],
      constrain: true,
    });
    // Nearly horizontal → snaps to exactly horizontal, preserving length.
    expect(end[1]).toBeCloseTo(0);
    expect(end[0]).toBeCloseTo(Math.hypot(100, 8));
    const diag = constrain45([0, 0], [50, 46]);
    expect(diag[0]).toBeCloseTo(diag[1]); // 45° diagonal
  });

  it('derives table cols/rows from the swept area', () => {
    const d = draftTable({
      kind: 'table',
      start: [0, 0],
      current: [TABLE_DEFAULT_CELL_W * 3, -TABLE_DEFAULT_CELL_H * 2],
      constrain: false,
    });
    expect(d.cols).toBe(3);
    expect(d.rows).toBe(2);
    expect(d.at).toEqual([0, -TABLE_DEFAULT_CELL_H * 2]);
  });
});

describe('annotationBBox', () => {
  it('covers every variant', () => {
    expect(
      annotationBBox({ id: 'r', type: 'rect', at: [10, 20], size: [30, 40] }),
    ).toEqual({ minX: 10, minY: 20, maxX: 40, maxY: 60 });
    expect(annotationBBox(LINE)).toEqual({
      minX: 100,
      minY: 50,
      maxX: 180,
      maxY: 110,
    });
    expect(annotationBBox(TABLE)).toEqual({
      minX: 10,
      minY: 20,
      maxX: 110,
      maxY: 70,
    });
    const text = annotationBBox({ id: 't', at: [0, 0], text: 'hello' });
    expect(text.minX).toBe(0);
    expect(text.maxX).toBeGreaterThan(0);
  });
});
