/**
 * `setSelectionColor` — recolour a mixed selection in ONE undo entry.
 *
 * The contract that matters here is not "does it set a field": it is that
 * `default` DELETES the field (an uncoloured diagram has to keep serialising
 * the way it did before colours existed, which the SVG/DXF exporters depend
 * on), that a change nothing can see never reaches the undo stack, and that
 * junctions — which carry no `color` — are skipped rather than corrupted.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same memory-localStorage shim as the sibling selection suite: the persist
// middleware writes on every `set` and this runs in plain node.
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
  elements: [
    { id: 'QF1', kind: 'breaker' },
    { id: 'QF2', kind: 'breaker' },
  ],
  buses: [{ id: 'B1', layout: { at: [0, 300], span: 400 } }],
  junctions: [{ id: 'J1', layout: { at: [200, 60] } }],
  layout: { QF1: { at: [0, 0] }, QF2: { at: [120, 100] } },
  wires: [{ id: 'w1', ends: ['QF1.t2', 'QF2.t1'] }],
  annotations: [
    { id: 'A1', at: [10, 200], text: 'note' },
    { id: 'A2', type: 'rect', at: [50, 250], size: [60, 30] },
  ],
};

const store = () => useEditorStore.getState();
const el = (id: string) => store().diagram.elements.find((e) => e.id === id);
const bus = (id: string) => store().diagram.buses?.find((b) => b.id === id);
const wire = (id: string) => store().diagram.wires?.find((w) => w.id === id);
const ann = (id: string) => store().diagram.annotations?.find((a) => a.id === id);
const undoDepth = () => store().past.length;

beforeEach(() => {
  store().setDiagram(structuredClone(DIAGRAM));
});

describe('setSelectionColor', () => {
  it('paints every selected element and bus in one undo entry', () => {
    store().setSelection(['QF1', 'QF2', 'B1']);
    const before = undoDepth();
    store().setSelectionColor('red');

    expect(el('QF1')?.color).toBe('red');
    expect(el('QF2')?.color).toBe('red');
    expect(bus('B1')?.color).toBe('red');
    expect(undoDepth()).toBe(before + 1);
  });

  it('paints annotations on their own channel in the same entry', () => {
    store().setSelection(['QF1'], ['A1', 'A2']);
    const before = undoDepth();
    store().setSelectionColor('blue');

    expect(el('QF1')?.color).toBe('blue');
    expect(ann('A1')?.color).toBe('blue');
    expect(ann('A2')?.color).toBe('blue');
    expect(undoDepth()).toBe(before + 1);
  });

  it('paints the selected wire', () => {
    store().setSelectedWire('w1');
    store().setSelectionColor('green');
    expect(wire('w1')?.color).toBe('green');
  });

  it('DELETES the field for `default` rather than storing the word', () => {
    store().setSelection(['QF1']);
    store().setSelectionColor('amber');
    expect(el('QF1')?.color).toBe('amber');

    store().setSelectionColor('default');
    expect(el('QF1')?.color).toBeUndefined();
    expect('color' in (el('QF1') as object)).toBe(false);
  });

  it('leaves an already-uncoloured object byte-identical under `default`', () => {
    const snapshot = JSON.stringify(store().diagram);
    store().setSelection(['QF1', 'QF2', 'B1']);
    store().setSelectionColor('default');
    expect(JSON.stringify(store().diagram)).toBe(snapshot);
  });

  it('does not touch objects outside the selection', () => {
    store().setSelection(['QF1']);
    store().setSelectionColor('red');
    expect(el('QF2')?.color).toBeUndefined();
    expect(bus('B1')?.color).toBeUndefined();
    expect(ann('A1')?.color).toBeUndefined();
  });

  it('pushes no undo entry when nothing would change', () => {
    store().setSelection(['QF1']);
    store().setSelectionColor('red');
    const after = undoDepth();
    // Same colour again — the user cannot see a difference, so Ctrl+Z must not
    // have to be pressed twice to undo the one change they made.
    store().setSelectionColor('red');
    expect(undoDepth()).toBe(after);
  });

  it('pushes no undo entry for a junction-only selection', () => {
    store().setSelection(['J1']);
    const before = undoDepth();
    store().setSelectionColor('red');
    expect(undoDepth()).toBe(before);
    // And the junction is not given a field its type does not have.
    expect('color' in (store().diagram.junctions?.[0] as object)).toBe(false);
  });

  it('does nothing at all with an empty selection', () => {
    store().setSelection([]);
    const before = undoDepth();
    store().setSelectionColor('red');
    expect(undoDepth()).toBe(before);
  });

  it('is undoable as a single step', () => {
    store().setSelection(['QF1', 'QF2', 'B1']);
    store().setSelectionColor('red');
    store().undo();
    expect(el('QF1')?.color).toBeUndefined();
    expect(el('QF2')?.color).toBeUndefined();
    expect(bus('B1')?.color).toBeUndefined();
  });

  it('recolours from one colour straight to another', () => {
    store().setSelection(['QF1']);
    store().setSelectionColor('red');
    store().setSelectionColor('gray');
    expect(el('QF1')?.color).toBe('gray');
  });
});
