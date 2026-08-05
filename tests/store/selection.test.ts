/**
 * Store-level contract for the mixed selection: elements/buses/junctions and
 * free annotations are two coexisting channels that move, copy and delete as
 * one gesture (one undo entry), while annotation-only affordances still key
 * off `soleSelectedAnnotation`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The persist middleware writes on every `set` and the suite runs in plain
// node (no jsdom), so install a memory localStorage before the store module
// is evaluated. `vi.hoisted` runs above the imports.
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

import { soleSelectedAnnotation, useEditorStore } from '../../src/store';
import type { DiagramFile } from '../../src/model';

/**
 * QF1 → QF2 wired with a manual route that detours out to x=400, plus a text
 * annotation and a rect annotation.
 */
const DIAGRAM: DiagramFile = {
  version: '1',
  elements: [
    { id: 'QF1', kind: 'breaker' },
    { id: 'QF2', kind: 'breaker' },
  ],
  layout: { QF1: { at: [0, 0] }, QF2: { at: [120, 100] } },
  wires: [
    {
      id: 'w1',
      ends: ['QF1.t2', 'QF2.t1'],
      path: [
        [0, 20],
        [400, 20],
        [400, 100],
        [120, 100],
      ],
    },
  ],
  annotations: [
    { id: 'A1', at: [10, 200], text: 'note' },
    { id: 'A2', type: 'rect', at: [50, 250], size: [60, 30] },
  ],
};

const store = () => useEditorStore.getState();
const path = () => store().diagram.wires?.[0].path;
const annAt = (id: string) =>
  store().diagram.annotations?.find((a) => a.id === id)?.at;

beforeEach(() => {
  store().setDiagram(structuredClone(DIAGRAM));
});

describe('mixed selection', () => {
  it('keeps annotations on their own channel', () => {
    store().setSelection(['QF1'], ['A1']);
    expect(store().selection).toEqual(['QF1']);
    expect(store().selectedAnnotations).toEqual(['A1']);
    // Not the sole selected object → no single-annotation affordances.
    expect(soleSelectedAnnotation(store())).toBeNull();
  });

  it('resolves a solo annotation for the single-target affordances', () => {
    store().setSelectedAnnotation('A2');
    expect(store().selection).toEqual([]);
    expect(soleSelectedAnnotation(store())).toBe('A2');
  });

  it('shift-click on an element does not drop marquee-caught annotations', () => {
    store().setSelection(['QF1'], ['A1']);
    store().toggleInSelection('QF2');
    expect(store().selection).toEqual(['QF1', 'QF2']);
    expect(store().selectedAnnotations).toEqual(['A1']);
  });

  it('toggles annotation membership without replacing the selection', () => {
    store().setSelection(['QF1'], ['A1']);
    store().toggleAnnotationInSelection('A2');
    expect(store().selectedAnnotations).toEqual(['A1', 'A2']);
    store().toggleAnnotationInSelection('A1');
    expect(store().selectedAnnotations).toEqual(['A2']);
    expect(store().selection).toEqual(['QF1']);
  });

  it('clears both channels when a wire or node is selected', () => {
    store().setSelection(['QF1'], ['A1']);
    store().setSelectedWire('w1');
    expect(store().selection).toEqual([]);
    expect(store().selectedAnnotations).toEqual([]);
  });
});

describe('group move', () => {
  it('translates annotations along with the elements, in one undo entry', () => {
    store().setSelection(['QF1', 'QF2'], ['A1', 'A2']);
    const before = store().past.length;
    store().moveElements(
      new Map([
        ['QF1', [30, 0] as [number, number]],
        ['QF2', [30, 0] as [number, number]],
      ]),
      new Map([
        ['A1', [30, 0] as [number, number]],
        ['A2', [30, 0] as [number, number]],
      ]),
    );
    expect(annAt('A1')).toEqual([40, 200]);
    expect(annAt('A2')).toEqual([80, 250]);
    expect(store().diagram.layout?.QF1.at).toEqual([30, 0]);
    expect(store().past.length).toBe(before + 1);
  });

  it('translates manual wire waypoints when both endpoints move', () => {
    store().moveElements(
      new Map([
        ['QF1', [300, 0] as [number, number]],
        ['QF2', [300, 0] as [number, number]],
      ]),
    );
    expect(path()).toEqual([
      [300, 20],
      [700, 20],
      [700, 100],
      [420, 100],
    ]);
  });

  it('leaves waypoints pinned when only one endpoint moves', () => {
    store().moveElements(
      new Map([['QF1', [300, 0] as [number, number]]]),
    );
    expect(path()).toEqual([
      [0, 20],
      [400, 20],
      [400, 100],
      [120, 100],
    ]);
  });

  it('undoes the whole gesture at once', () => {
    store().setSelection(['QF1', 'QF2'], ['A1']);
    store().moveElements(
      new Map([
        ['QF1', [30, 0] as [number, number]],
        ['QF2', [30, 0] as [number, number]],
      ]),
      new Map([['A1', [30, 0] as [number, number]]]),
    );
    store().undo();
    expect(annAt('A1')).toEqual([10, 200]);
    expect(store().diagram.layout?.QF1.at).toEqual([0, 0]);
    expect(path()?.[1]).toEqual([400, 20]);
  });
});

describe('deleteSelection with annotations', () => {
  it('drops elements and annotations together in one undo entry', () => {
    store().setSelection(['QF1'], ['A1']);
    const before = store().past.length;
    store().deleteSelection();
    expect(store().diagram.elements.map((e) => e.id)).toEqual(['QF2']);
    expect(store().diagram.annotations?.map((a) => a.id)).toEqual(['A2']);
    expect(store().past.length).toBe(before + 1);
    expect(store().selection).toEqual([]);
    expect(store().selectedAnnotations).toEqual([]);
  });

  it('handles an annotation-only selection', () => {
    store().setSelection([], ['A1', 'A2']);
    store().deleteSelection();
    expect(store().diagram.annotations).toBeUndefined();
    expect(store().diagram.elements).toHaveLength(2);
  });

  it('copy/paste round-trips a mixed selection', () => {
    store().setSelection(['QF1'], ['A1']);
    store().copySelection();
    store().pasteClipboard();
    expect(store().diagram.elements).toHaveLength(3);
    expect(store().diagram.annotations).toHaveLength(3);
    // The pasted copies become the new selection, on both channels.
    expect(store().selection).toHaveLength(1);
    expect(store().selectedAnnotations).toHaveLength(1);
  });
});
