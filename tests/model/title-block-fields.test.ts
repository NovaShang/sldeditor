/**
 * Title-block fields the document hides or renames (`meta.titleBlock.hidden`
 * / `.labels`). Users asked to drop the DESIGNED field or call it "Elaborado
 * por"; the setting is document-wide, and absent it every frame — and every
 * export — must come out exactly as before.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() {
      return mem.size;
    },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
    clear: () => {
      mem.clear();
    },
  } as Storage;
});
import { compile } from '../../src/compiler';
import { buildExportDxf } from '../../src/lib/export-dxf';
import { buildExportSvg } from '../../src/lib/export-image';
import { TITLE_ROW_MM, UNITS_PER_MM, type Sheet, type TitleBlockShared } from '../../src/model/sheet';
import { sheetPrimitives, type SheetFieldLabels } from '../../src/model/sheet-render';
import type { DiagramFile } from '../../src/model';
import { useEditorStore } from '../../src/store';

const S1: Sheet = { id: 'S1', paper: 'a4', orientation: 'landscape', at: [0, 0], title: 'Main board', date: '2026-11-25' };
const LABELS: SheetFieldLabels = {
  project: 'Project',
  client: 'Client',
  title: 'Title',
  number: 'Drawing no.',
  designer: 'Designed',
  checker: 'Checked',
  date: 'Date',
  scaleText: 'Scale',
  sheetNo: 'Sheet',
};
const prims = (shared: TitleBlockShared | undefined) => sheetPrimitives(S1, shared, LABELS, '1 of 1');
const textOf = (p: ReturnType<typeof prims>, s: string) => p.texts.find((t) => t.text === s);

describe('title-block field labels and visibility', () => {
  it('absent settings draw the frame exactly as before', () => {
    const base = prims({ designer: 'GS' });
    expect(prims({ designer: 'GS', labels: {}, hidden: [] })).toEqual(base);
    expect(base.texts.filter((t) => t.role === 'label').map((t) => t.text)).toEqual([
      'Project', 'Client', 'Title', 'Drawing no.', 'Designed', 'Checked', 'Date', 'Scale', 'Sheet',
    ]);
  });

  it('a renamed field prints the new caption in its own cell', () => {
    const base = prims({ designer: 'GS' });
    const p = prims({ designer: 'GS', labels: { designer: 'Elaborado por' } });
    expect(textOf(p, 'Designed')).toBeUndefined();
    const caption = textOf(p, 'Elaborado por')!;
    expect([caption.x, caption.y, caption.role]).toEqual([textOf(base, 'Designed')!.x, textOf(base, 'Designed')!.y, 'label']);
    expect(textOf(p, 'GS')).toEqual(textOf(base, 'GS'));
  });

  it('a hidden field prints neither caption nor value; its row partner takes the whole row', () => {
    const base = prims({ designer: 'GS', checker: 'AB' });
    const p = prims({ designer: 'GS', checker: 'AB', hidden: ['designer'] });
    expect(textOf(p, 'Designed')).toBeUndefined();
    expect(textOf(p, 'GS')).toBeUndefined();
    // "Checked" moves into the left cell of the same row.
    expect(textOf(p, 'Checked')!.x).toBe(textOf(base, 'Designed')!.x);
    expect(textOf(p, 'Checked')!.y).toBe(textOf(base, 'Checked')!.y);
    expect(textOf(p, 'AB')!.x).toBe(textOf(base, 'GS')!.x);
    // That row lost its middle column rules.
    const midRule = (q: typeof p) => {
      const x = textOf(base, 'Checked')!.x - 1.5 * UNITS_PER_MM; // label padding
      const y = textOf(base, 'Checked')!.y;
      return q.lines.some(
        (l) => l.x1 === l.x2 && Math.abs(l.x1 - x) < 1e-6 && Math.min(l.y1, l.y2) < y && Math.max(l.y1, l.y2) > y,
      );
    };
    expect(midRule(base)).toBe(true);
    expect(midRule(p)).toBe(false);
    expect(p.titleBlock).toEqual(base.titleBlock);
  });

  it('a row whose fields are all hidden is dropped and the block gets shorter', () => {
    const base = prims(undefined);
    const p = prims({ hidden: ['designer', 'checker'] });
    const row = TITLE_ROW_MM * UNITS_PER_MM;
    expect(p.titleBlock.h).toBeCloseTo(base.titleBlock.h - row, 6);
    // Bottom edge stays on the inner border.
    expect(p.titleBlock.y + p.titleBlock.h).toBeCloseTo(base.titleBlock.y + base.titleBlock.h, 6);
    expect(textOf(p, 'Sheet')!.y).toBeCloseTo(textOf(base, 'Sheet')!.y, 6);
  });

  it('the automatic sheet number can be hidden and renamed too', () => {
    expect(textOf(prims({ hidden: ['sheetNo'] }), '1 of 1')).toBeUndefined();
    expect(textOf(prims({ labels: { sheetNo: 'Hoja' } }), 'Hoja')).toBeDefined();
  });

  it('every field hidden leaves the frame without a title block', () => {
    const p = prims({
      hidden: ['project', 'client', 'title', 'number', 'designer', 'checker', 'date', 'scaleText', 'sheetNo'],
    });
    expect(p.texts).toEqual([]);
    expect(p.titleBlock.h).toBe(0);
  });
});

describe('exports honour it', () => {
  const diagram: DiagramFile = {
    version: '1',
    elements: [{ id: 'QF1', kind: 'breaker' }],
    layout: { QF1: { at: [300, 200] } },
  };
  const titleBlock: TitleBlockShared = { designer: 'GS', labels: { checker: 'Revisado' }, hidden: ['designer'] };

  it('SVG (and so PNG / PDF)', () => {
    const svg = buildExportSvg(compile(diagram), { sheets: [S1], titleBlock });
    expect(svg).toContain('>Revisado<');
    expect(svg).not.toContain('>GS<');
  });

  it('DXF', () => {
    const dxf = buildExportDxf(compile(diagram), { sheets: [S1], titleBlock });
    expect(dxf).toContain('Revisado');
    expect(dxf).not.toMatch(/\nGS\r?\n/);
  });
});

describe('store: updateTitleBlock', () => {
  const st = () => useEditorStore.getState();
  beforeEach(() => st().setDiagram({ version: '1', elements: [] }));

  it('keeps only real overrides and drops empty settings entirely', () => {
    st().updateTitleBlock({ labels: { designer: 'Elaborado por', checker: '  ' }, hidden: ['client', 'client'] });
    expect(st().diagram.meta?.titleBlock).toEqual({ labels: { designer: 'Elaborado por' }, hidden: ['client'] });
    st().updateTitleBlock({ labels: { designer: '' }, hidden: [] });
    expect(st().diagram.meta?.titleBlock).toBeUndefined();
  });

  it('ignores field names the title block does not have', () => {
    st().updateTitleBlock({ hidden: ['designer', 'nonsense' as never], labels: { bogus: 'x' } as never });
    expect(st().diagram.meta?.titleBlock).toEqual({ hidden: ['designer'] });
  });
});
