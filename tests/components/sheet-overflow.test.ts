/**
 * The sheet inspector's "part of the drawing runs past the frame" warning.
 *
 * It exists to tell the user to press "Enlarge frame to fit the drawing", so
 * it is tested from both ends: it fires for things cut off by the border or
 * hidden under the title block, stays quiet for things on another sheet, and
 * — the part that matters most — is gone after `fitSheet` has run.
 */

import { describe, expect, it, vi } from 'vitest';

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
import { sheetOverflowIds } from '../../src/components/SheetInspector';
import type { DiagramFile, Sheet } from '../../src/model';
import { useEditorStore } from '../../src/store';

// A4 landscape at 1:1 from the origin: 1122 × 794 units; content area is
// roughly x 38…1085, y 38…605 (the title-block band sits below it).
const SHEET: Sheet = { id: 'S1', paper: 'a4', orientation: 'landscape', at: [0, 0] };

const diagram = (extra: Partial<DiagramFile> = {}): DiagramFile => ({
  version: '1',
  elements: [{ id: 'QF1', kind: 'breaker' }],
  layout: { QF1: { at: [300, 300] } },
  sheets: [SHEET],
  ...extra,
});

const overflow = (d: DiagramFile, sheet: Sheet = d.sheets![0]) =>
  sheetOverflowIds(d, compile(d), sheet).sort();

describe('sheetOverflowIds', () => {
  it('is empty when everything sits inside the content area', () => {
    const d = diagram({
      annotations: [
        { id: 'n1', type: 'rect', at: [100, 100], size: [200, 100] },
        { id: 't1', at: [500, 200], text: 'Note' },
      ],
    });
    expect(overflow(d)).toEqual([]);
  });

  it('flags a device under the title-block band', () => {
    const d = diagram({ layout: { QF1: { at: [300, 700] } } });
    expect(overflow(d)).toEqual(['QF1']);
  });

  it('flags a device cut by the outer border', () => {
    const d = diagram({ layout: { QF1: { at: [1120, 300] } } });
    expect(overflow(d)).toEqual(['QF1']);
  });

  it('flags an annotation by its full extent, not just its anchor', () => {
    const d = diagram({
      annotations: [
        { id: 'r1', type: 'rect', at: [1000, 100], size: [200, 50] },
        { id: 'l1', type: 'line', at: [100, 100], points: [[0, 0], [0, 600]] },
      ],
    });
    expect(overflow(d)).toEqual(['l1', 'r1']);
  });

  it('ignores things that do not touch the sheet at all', () => {
    const d = diagram({
      layout: { QF1: { at: [5000, 300] } },
      annotations: [{ id: 'r1', type: 'rect', at: [5000, 100], size: [200, 50] }],
    });
    expect(overflow(d)).toEqual([]);
  });

  it('tracks the frame scale: an enlarged frame takes in what overflowed', () => {
    const d = diagram({ layout: { QF1: { at: [300, 700] } } });
    expect(overflow(d, { ...SHEET, scale: 1.5 })).toEqual([]);
  });

  it('is cleared by fitSheet', () => {
    // QF2 overlaps the sheet but sits past its right edge, under the title block.
    const d = diagram({
      elements: [
        { id: 'QF1', kind: 'breaker' },
        { id: 'QF2', kind: 'breaker' },
      ],
      layout: { QF1: { at: [60, 300] }, QF2: { at: [1110, 750] } },
    });
    expect(overflow(d)).toEqual(['QF2']);
    const st = useEditorStore.getState();
    st.setDiagram(d);
    st.fitSheet('S1');
    const after = useEditorStore.getState();
    const sheet = after.diagram.sheets![0];
    expect(sheet.scale ?? 1).toBeGreaterThan(1);
    expect(sheetOverflowIds(after.diagram, after.internal, sheet)).toEqual([]);
  });
});
