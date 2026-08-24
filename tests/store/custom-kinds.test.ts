/**
 * Removing a symbol a document defines.
 *
 * The guard is the whole test: dropping a definition while elements still use
 * it turns them into unresolvable kinds, which is the difference between a
 * drawing that is wrong and a drawing that will not open.
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

import { useEditorStore } from '../../src/store';
import type { LibraryEntry } from '../../src/model';

const panel: LibraryEntry = {
  id: 'custom:panel-2way',
  name: '2-way panel',
  category: 'distribution',
  viewBox: '-20 -30 40 60',
  width: 40,
  height: 60,
  svg: '<rect x="-20" y="-30" width="40" height="60" fill="none" stroke="black"/>',
  terminals: [
    { id: 't1', x: 0, y: -28, orientation: 'n' },
    { id: 't2', x: 0, y: 28, orientation: 's' },
  ],
};

describe('removeCustomKind', () => {
  beforeEach(() => {
    useEditorStore.getState().setDiagram({ version: '1', elements: [] });
  });

  it('refuses while instances are placed, and reports how many', () => {
    useEditorStore.getState().setDiagram({
      version: '1',
      customKinds: [panel],
      elements: [
        { id: 'P1', kind: 'custom:panel-2way' },
        { id: 'P2', kind: 'custom:panel-2way' },
      ],
    });
    // The count is what a confirmation prompt needs to say something true.
    expect(useEditorStore.getState().removeCustomKind('custom:panel-2way')).toBe(2);
    expect(useEditorStore.getState().diagram.customKinds).toHaveLength(1);
  });

  it('removes it once nothing uses it', () => {
    useEditorStore.getState().setDiagram({
      version: '1',
      customKinds: [panel],
      elements: [],
    });
    expect(useEditorStore.getState().removeCustomKind('custom:panel-2way')).toBe(0);
    expect(useEditorStore.getState().diagram.customKinds).toBeUndefined();
  });

  it('is a no-op for a kind this document never defined', () => {
    expect(useEditorStore.getState().removeCustomKind('custom:nope')).toBe(0);
  });

  it('leaves other definitions alone', () => {
    const other = { ...panel, id: 'custom:other', name: 'Other' };
    useEditorStore.getState().setDiagram({
      version: '1',
      customKinds: [panel, other],
      elements: [],
    });
    useEditorStore.getState().removeCustomKind('custom:panel-2way');
    expect(useEditorStore.getState().diagram.customKinds?.map((k) => k.id)).toEqual([
      'custom:other',
    ]);
  });
});
