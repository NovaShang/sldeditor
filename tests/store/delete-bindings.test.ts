/**
 * Deleting an element in the editor drops the bindings that target it — and
 * only those. A binding to a gone element is dead weight the viewer would
 * skip forever; one to a surviving element is the user's work.
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

import { createEditorStore, useEditorStore } from '../../src/store';
import type { DiagramFile } from '../../src/model';

const DIAGRAM: DiagramFile = {
  version: '1',
  elements: [
    { id: 'QF1', kind: 'breaker' },
    { id: 'QF2', kind: 'breaker' },
  ],
  buses: [{ id: 'B1', layout: { at: [0, 300], span: 400 } }],
  layout: { QF1: { at: [0, 0] }, QF2: { at: [120, 100] } },
  wires: [{ id: 'w1', ends: ['B1', 'QF1.t1'] }],
  tags: [{ path: 'QF1/I', type: 'float', unit: 'A' }],
  bindings: [
    { target: 'QF1', prop: 'value', tag: 'QF1/I' },
    { target: 'QF1', prop: 'alarm', tag: 'QF1/h' },
    { target: 'QF2', prop: 'value', tag: 'QF2/I' },
    { target: 'B1', prop: 'badge', tag: 'B1/b' },
  ],
};

const store = () => useEditorStore.getState();

beforeEach(() => {
  store().setDiagram(structuredClone(DIAGRAM));
});

describe('deleteSelection drops bindings of deleted targets', () => {
  it('removes only the deleted element’s bindings', () => {
    store().setSelection(['QF1']);
    store().deleteSelection();
    expect(store().diagram.elements.map((e) => e.id)).toEqual(['QF2']);
    expect(store().diagram.bindings).toEqual([
      { target: 'QF2', prop: 'value', tag: 'QF2/I' },
      { target: 'B1', prop: 'badge', tag: 'B1/b' },
    ]);
    // `tags` is a declaration index, not owned by any element — untouched.
    expect(store().diagram.tags).toEqual(DIAGRAM.tags);
  });

  it('covers buses and a mixed selection, and undo brings them back', () => {
    store().setSelection(['QF2', 'B1']);
    store().deleteSelection();
    expect(store().diagram.bindings).toEqual([
      { target: 'QF1', prop: 'value', tag: 'QF1/I' },
      { target: 'QF1', prop: 'alarm', tag: 'QF1/h' },
    ]);
    store().undo();
    expect(store().diagram.bindings).toEqual(DIAGRAM.bindings);
  });

  it('drops the field entirely when the last binding goes', () => {
    store().setSelection(['QF1', 'QF2', 'B1']);
    store().deleteSelection();
    expect('bindings' in store().diagram).toBe(false);
  });

  it('leaves a file without bindings exactly as it was', () => {
    const { tags: _t, bindings: _b, ...bare } = structuredClone(DIAGRAM);
    store().setDiagram(bare);
    store().setSelection(['QF1']);
    store().deleteSelection();
    expect('bindings' in store().diagram).toBe(false);
  });
});

describe('createEditorStore', () => {
  it('is a private instance with the same behaviour, not the singleton', () => {
    const priv = createEditorStore();
    priv.getState().setDiagram(structuredClone(DIAGRAM));
    priv.getState().setSelection(['QF1']);
    priv.getState().deleteSelection();
    expect(priv.getState().diagram.elements.map((e) => e.id)).toEqual(['QF2']);
    expect(priv.getState().diagram.bindings).toHaveLength(2);
    // The singleton did not move.
    expect(store().diagram.elements).toHaveLength(2);
    expect(store().diagram.bindings).toHaveLength(4);
  });
});
