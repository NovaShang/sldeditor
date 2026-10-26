/**
 * Drawing sheets: geometry, fitting, legibility and the one-time migration of
 * SmartSLD's old three-annotation frame.
 */
import { describe, expect, it } from 'vitest';
import {
  fitScale,
  labelFontForPrint,
  migrateLegacyFrame,
  printedMm,
  sheetContentArea,
  sheetRect,
  UNITS_PER_MM,
} from '../../src/model/sheet';
import { sheetPrimitives } from '../../src/model/sheet-render';
import type { DiagramFile } from '../../src/model';

describe('sheet geometry', () => {
  it('is paper size at 1 unit per CSS px, times the frame scale', () => {
    const r = sheetRect({ id: 'S1', paper: 'a4', orientation: 'landscape', at: [10, 20] });
    expect(r.w).toBeCloseTo(297 * UNITS_PER_MM);
    expect(r.h).toBeCloseTo(210 * UNITS_PER_MM);
    const p = sheetRect({ id: 'S1', paper: 'a4', orientation: 'portrait', at: [0, 0], scale: 1.5 });
    expect(p.w).toBeCloseTo(210 * UNITS_PER_MM * 1.5);
  });

  it('keeps the content area clear of the margins and the title block', () => {
    const a = sheetContentArea({ id: 'S1', paper: 'a4', orientation: 'landscape', at: [0, 0] });
    expect(a.x).toBeCloseTo(10 * UNITS_PER_MM);
    expect(a.h).toBeCloseTo((210 - 20 - 40) * UNITS_PER_MM);
  });
});

describe('fitting', () => {
  it('stays at 1:1 when the drawing fits, and steps up to a nice ratio when not', () => {
    expect(fitScale(500, 300, 'a4', 'landscape')).toBe(1);
    const a = sheetContentArea({ id: '', paper: 'a4', orientation: 'landscape', at: [0, 0] });
    expect(fitScale(a.w * 1.3, 100, 'a4', 'landscape')).toBe(1.5);
  });
});

describe('legibility', () => {
  it('default labels print at ~1.85 mm on a 1:1 sheet and shrink with the frame', () => {
    expect(printedMm(7, 1)).toBeCloseTo(1.85, 2);
    expect(printedMm(7, 2)).toBeCloseTo(0.93, 2);
  });
  it('suggests a label size that prints at 2.5 mm', () => {
    expect(printedMm(labelFontForPrint(1.5), 1.5)).toBeGreaterThanOrEqual(2.5);
  });
});

describe('legacy frame migration', () => {
  const W = Math.round(297 * UNITS_PER_MM);
  const H = Math.round(210 * UNITS_PER_MM);
  const legacy: DiagramFile = {
    version: '1',
    elements: [],
    annotations: [
      { id: 'note', at: [5, 5], text: 'keep me' },
      { id: 'frame_border', type: 'rect', at: [-100, -50], size: [W, H] },
      { id: 'frame_inner', type: 'rect', at: [-62, -12], size: [W - 76, H - 76] },
      {
        id: 'frame_title',
        type: 'table',
        at: [0, 0],
        colWidths: [113, 227],
        rowHeights: [30, 30, 30, 30, 30],
        cells: [['Title', 'Plant A'], ['Drawing No.', 'E-01'], ['Date', '2026-09-01'], ['Scale', ''], ['Drawn by', 'Ana']],
      },
    ] as DiagramFile['annotations'],
  };

  it('becomes sheet 1 in place, with the typed fields carried over', () => {
    const d = migrateLegacyFrame(legacy);
    expect(d.sheets).toEqual([
      { id: 'S1', paper: 'a4', orientation: 'landscape', at: [-100, -50], title: 'Plant A', number: 'E-01', date: '2026-09-01' },
    ]);
    expect(d.meta?.titleBlock?.designer).toBe('Ana');
    expect(d.annotations?.map((a) => a.id)).toEqual(['note']);
  });

  it('leaves drawings without the old frame (or with sheets) alone', () => {
    const plain: DiagramFile = { version: '1', elements: [] };
    expect(migrateLegacyFrame(plain)).toBe(plain);
    const migrated = migrateLegacyFrame(legacy);
    expect(migrateLegacyFrame(migrated)).toBe(migrated);
  });
});

describe('title block', () => {
  it('prints shared and per-sheet fields and the sheet number', () => {
    const labels = {
      project: 'Project', client: 'Client', title: 'Title', number: 'No.', designer: 'Designed',
      checker: 'Checked', date: 'Date', scaleText: 'Scale', sheetNo: 'Sheet',
    };
    const p = sheetPrimitives(
      { id: 'S2', paper: 'a3', orientation: 'landscape', at: [0, 0], title: 'Building 1' },
      { project: 'Mall', client: 'ACME' },
      labels,
      '2 of 3',
    );
    const values = p.texts.filter((t) => t.role === 'value').map((t) => t.text);
    expect(values).toEqual(['Mall', 'ACME', 'Building 1', '2 of 3']);
    expect(p.rects).toHaveLength(2);
  });
});
