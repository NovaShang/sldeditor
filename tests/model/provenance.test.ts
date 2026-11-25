/**
 * @vitest-environment jsdom
 *
 * `by` provenance: who created an item. Metadata only — exports must be
 * byte-identical with and without it, and a copy the user pastes is theirs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The store's persist middleware needs a working localStorage before the
// module is evaluated (same shim as tests/store/selection.test.ts).
vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return mem.size;
      },
      key: (i: number) => [...mem.keys()][i] ?? null,
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    },
  });
});
import { compile } from '../../src/compiler';
import { buildExportSvg } from '../../src/lib/export-image';
import { buildExportDxf } from '../../src/lib/export-dxf';
import { useEditorStore } from '../../src/store';
import type { DiagramFile } from '../../src/model';

const PLAIN: DiagramFile = {
  version: '1',
  elements: [
    { id: 'QF1', kind: 'breaker', name: 'Main' },
    { id: 'QF2', kind: 'breaker' },
  ],
  layout: { QF1: { at: [0, 0] }, QF2: { at: [0, 120] } },
  buses: [{ id: 'B1', layout: { at: [-60, 200], span: 120 } }],
  wires: [{ id: 'w1', ends: ['QF1.t2', 'QF2.t1'] }],
  annotations: [
    { id: 'A1', at: [100, 0], text: 'note' },
    { id: 'A2', type: 'rect', at: [80, -20], size: [60, 30], label: 'MCC' },
  ],
};

/** The same document with every item marked as AI-made. */
function markedAi(d: DiagramFile): DiagramFile {
  const c = structuredClone(d);
  for (const e of c.elements) e.by = 'ai';
  for (const b of c.buses ?? []) b.by = 'ai';
  for (const w of c.wires ?? []) w.by = 'ai';
  for (const a of c.annotations ?? []) a.by = 'ai';
  return c;
}

describe('provenance never reaches an export', () => {
  const svg = (d: DiagramFile) => buildExportSvg(compile(d), { annotations: d.annotations });
  const dxf = (d: DiagramFile) => buildExportDxf(compile(d), { annotations: d.annotations });

  it('SVG is byte-identical', () => {
    expect(svg(markedAi(PLAIN))).toBe(svg(PLAIN));
  });

  it('DXF is byte-identical', () => {
    expect(dxf(markedAi(PLAIN))).toBe(dxf(PLAIN));
  });
});

describe('provenance in the editor', () => {
  const store = () => useEditorStore.getState();
  beforeEach(() => store().setDiagram(markedAi(PLAIN)));

  it('survives a load unchanged', () => {
    expect(store().diagram.annotations?.every((a) => a.by === 'ai')).toBe(true);
    expect(store().diagram.elements.every((e) => e.by === 'ai')).toBe(true);
  });

  it('a pasted copy is the user’s — the mark is dropped', () => {
    store().setSelection(['QF1', 'QF2'], ['A1']);
    store().copySelection();
    store().pasteClipboard();
    const d = store().diagram;
    const pastedEls = d.elements.filter((e) => e.id !== 'QF1' && e.id !== 'QF2');
    const pastedAnns = (d.annotations ?? []).filter((a) => a.id !== 'A1' && a.id !== 'A2');
    expect(pastedEls).toHaveLength(2);
    expect(pastedAnns).toHaveLength(1);
    for (const x of [...pastedEls, ...pastedAnns]) expect(x.by).toBeUndefined();
    // The originals keep theirs.
    expect(d.elements.find((e) => e.id === 'QF1')?.by).toBe('ai');
    expect(d.annotations?.find((a) => a.id === 'A1')?.by).toBe('ai');
  });
});
