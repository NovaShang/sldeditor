/**
 * `resetSelectionLabelOffset` — put dragged label blocks back on the anchor
 * their library entry declares.
 *
 * The drag itself lives in SelectTool (DOM gesture); what the store owes is
 * the way out of a nudge the user regrets, and the same two properties every
 * other bulk action here holds: the field is DELETED rather than zeroed, so a
 * diagram nobody has nudged serialises exactly as it did before the field
 * existed, and nothing reaches the undo stack when nothing would change.
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
  elements: [
    { id: 'QF1', kind: 'breaker', labelOffset: [12, -8] },
    { id: 'QF2', kind: 'breaker', labelOffset: [-4, 30] },
    { id: 'QF3', kind: 'breaker' },
  ],
  layout: { QF1: { at: [0, 0] }, QF2: { at: [120, 0] }, QF3: { at: [240, 0] } },
};

const store = () => useEditorStore.getState();
const el = (id: string) => store().diagram.elements.find((e) => e.id === id);
const undoDepth = () => store().past.length;

beforeEach(() => {
  store().setDiagram(structuredClone(DIAGRAM));
});

describe('resetSelectionLabelOffset', () => {
  it('clears every selected element in one undo entry', () => {
    store().setSelection(['QF1', 'QF2']);
    const before = undoDepth();
    store().resetSelectionLabelOffset();

    expect(el('QF1')?.labelOffset).toBeUndefined();
    expect(el('QF2')?.labelOffset).toBeUndefined();
    expect(undoDepth()).toBe(before + 1);
  });

  it('DELETES the field rather than storing a zero', () => {
    store().setSelection(['QF1']);
    store().resetSelectionLabelOffset();
    expect('labelOffset' in (el('QF1') as object)).toBe(false);
  });

  it('leaves unselected elements alone', () => {
    store().setSelection(['QF1']);
    store().resetSelectionLabelOffset();
    expect(el('QF2')?.labelOffset).toEqual([-4, 30]);
  });

  it('dispatches nothing when no selected element carries an offset', () => {
    store().setSelection(['QF3']);
    const snapshot = JSON.stringify(store().diagram);
    const before = undoDepth();
    store().resetSelectionLabelOffset();

    expect(JSON.stringify(store().diagram)).toBe(snapshot);
    expect(undoDepth()).toBe(before);
  });

  it('does nothing with an empty selection', () => {
    store().clearSelection();
    const before = undoDepth();
    store().resetSelectionLabelOffset();
    expect(undoDepth()).toBe(before);
  });

  it('survives a round trip through undo', () => {
    store().setSelection(['QF1']);
    store().resetSelectionLabelOffset();
    store().undo();
    expect(el('QF1')?.labelOffset).toEqual([12, -8]);
  });
});
