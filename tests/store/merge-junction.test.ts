/**
 * `mergeJunctionInto` — dropping a free wire end on a pin, bus or joint
 * connects it there. Before 0.30 the end only moved and sat on the pin,
 * looking connected while it was not (10-25 walkthrough).
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
    { id: 'QF1', kind: 'breaker' },
    { id: 'QF2', kind: 'breaker' },
  ],
  buses: [{ id: 'B1', layout: { at: [0, 300], span: 400 } }],
  junctions: [{ id: 'J1', layout: { at: [200, 60] } }, { id: 'J2', layout: { at: [260, 60] } }],
  layout: { QF1: { at: [0, 0] }, QF2: { at: [120, 100] } },
  wires: [
    { id: 'w1', ends: ['QF1.t2', 'J1'], path: [[0, 30], [200, 60]] },
    { id: 'w2', ends: ['J2', 'QF2.t1'] },
  ],
};

const store = () => useEditorStore.getState();

beforeEach(() => {
  store().setDiagram(structuredClone(DIAGRAM));
});

describe('mergeJunctionInto', () => {
  it('re-ends the wire on the pin, drops the junction and the stale route', () => {
    const before = store().past.length;
    store().mergeJunctionInto('J1', 'QF2.t1');
    const d = store().diagram;
    expect(d.junctions?.map((j) => j.id)).toEqual(['J2']);
    const w = d.wires!.find((x) => x.ends.includes('QF1.t2'))!;
    expect(w.ends).toEqual(['QF1.t2', 'QF2.t1']);
    expect(w.path).toBeUndefined();
    expect(store().past.length).toBe(before + 1);
  });

  it('joins two free ends into one joint', () => {
    store().mergeJunctionInto('J1', 'J2');
    const d = store().diagram;
    expect(d.junctions?.map((j) => j.id)).toEqual(['J2']);
    expect(d.wires!.map((w) => w.ends)).toEqual([['QF1.t2', 'J2'], ['J2', 'QF2.t1']]);
  });

  it('drops a wire that would run from a point to itself', () => {
    store().mergeJunctionInto('J2', 'QF2.t1');
    expect(store().diagram.wires!.map((w) => w.ends)).toEqual([['QF1.t2', 'J1']]);
  });

  it('connects to a bus', () => {
    store().mergeJunctionInto('J1', 'B1');
    expect(store().diagram.wires![0].ends).toEqual(['QF1.t2', 'B1']);
  });
});
