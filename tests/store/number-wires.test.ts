/**
 * `numberWires` store action: one undo step, returns the count, and a re-run
 * on an already numbered drawing adds no history entry. Plus: auto-arrange
 * is off on circuit diagrams.
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

import { useEditorStore } from '../../src/store';
import type { DiagramFile } from '../../src/model';

const DIAGRAM: DiagramFile = {
  version: '1',
  meta: { diagramType: 'circuit' },
  elements: [
    { id: 'S1', kind: 'push-button', name: '-S1' },
    { id: 'K1', kind: 'relay-coil', name: '-K1' },
  ],
  buses: [
    { id: 'L', name: 'L', layout: { at: [0, 0], span: 200 } },
    { id: 'N', name: 'N', layout: { at: [0, 300], span: 200 } },
  ],
  wires: [
    { id: 'w1', ends: ['L', 'S1.t1'] },
    { id: 'w2', ends: ['S1.t2', 'K1.t1'], label: '5' },
    { id: 'w3', ends: ['K1.t2', 'N'] },
  ],
  layout: { S1: { at: [0, 140] }, K1: { at: [0, 200] } },
};

describe('numberWires (store)', () => {
  beforeEach(() => {
    useEditorStore.getState().setDiagram(structuredClone(DIAGRAM));
  });

  it('numbers in one undo step and returns the count', () => {
    const s = useEditorStore.getState();
    const before = s.past.length;
    expect(s.numberWires()).toBe(1);
    const after = useEditorStore.getState();
    expect(after.past.length).toBe(before + 1);
    expect(after.diagram.wires!.find((w) => w.id === 'w2')!.label).toBe('1');
    after.undo();
    expect(useEditorStore.getState().diagram.wires!.find((w) => w.id === 'w2')!.label).toBe('5');
  });

  it('adds no history entry when nothing changes', () => {
    useEditorStore.getState().numberWires();
    const len = useEditorStore.getState().past.length;
    expect(useEditorStore.getState().numberWires()).toBe(1);
    expect(useEditorStore.getState().past.length).toBe(len);
  });
});

describe('auto-arrange on a circuit diagram', () => {
  beforeEach(() => {
    useEditorStore.getState().setDiagram(structuredClone(DIAGRAM));
  });

  it('is off: positions are kept and no history entry is added', () => {
    const s = useEditorStore.getState();
    const len = s.past.length;
    s.autoArrangeAll();
    s.setSelection(['S1']);
    useEditorStore.getState().autoArrangeSelection();
    const after = useEditorStore.getState();
    expect(after.past.length).toBe(len);
    expect(after.diagram.layout).toEqual(DIAGRAM.layout);
  });
});
