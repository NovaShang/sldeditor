/**
 * Wire numbering by potential (circuit diagrams). One number per electrical
 * node, in reading order; rails and hand-named nodes keep their names.
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import { isMainCircuitEntry, numberWiresByPotential } from '../../src/model/wire-numbers';
import { LIBRARY } from '../../src/compiler/library-index';
import type { DiagramFile } from '../../src/model';

const run = (d: DiagramFile) => numberWiresByPotential(d, compile(d));
const labels = (d: DiagramFile) => Object.fromEntries((d.wires ?? []).map((w) => [w.id, w.label]));

/**
 * Two current paths between rails L (top) and N (bottom):
 *   left:  L → S1 → K1 (coil) → N
 *   right: L → K1 contact → H1 (lamp) → N
 * Nodes: S1.t2–K1.t1 (top at y 100, x -100) and KA.t2–H1.t1 (y 100, x 100).
 */
const control = (extra: Partial<DiagramFile> = {}): DiagramFile => ({
  version: '1',
  meta: { diagramType: 'circuit' },
  elements: [
    { id: 'S1', kind: 'push-button', name: '-S1' },
    { id: 'K1', kind: 'relay-coil', name: '-K1' },
    { id: 'KA', kind: 'make-contact', name: '-K1' },
    { id: 'H1', kind: 'indicator-light', name: '-H1' },
  ],
  buses: [
    { id: 'L', name: 'L', layout: { at: [0, 0], span: 400 } },
    { id: 'N', name: 'N', layout: { at: [0, 300], span: 400 } },
  ],
  wires: [
    { id: 'w1', ends: ['L', 'S1.t1'] },
    { id: 'w2', ends: ['S1.t2', 'K1.t1'] },
    { id: 'w3', ends: ['K1.t2', 'N'] },
    { id: 'w4', ends: ['L', 'KA.t1'] },
    { id: 'w5', ends: ['KA.t2', 'H1.t1'] },
    { id: 'w6', ends: ['H1.t2', 'N'] },
  ],
  layout: {
    S1: { at: [-100, 140] },
    K1: { at: [-100, 200] },
    KA: { at: [100, 140] },
    H1: { at: [100, 200] },
  },
  ...extra,
});

describe('numberWiresByPotential', () => {
  it('numbers each potential once, in reading order, and leaves the rails alone', () => {
    const r = run(control());
    expect(r.count).toBe(2);
    expect(labels(r.diagram)).toEqual({
      w1: undefined, w2: '1', w3: undefined,
      w4: undefined, w5: '2', w6: undefined,
    });
  });

  it('gives every wire of one node the same number, through junctions', () => {
    const d = control();
    d.elements.push({ id: 'H2', kind: 'indicator-light' });
    d.layout!.H2 = { at: [-180, 260] };
    d.junctions = [{ id: 'J1', layout: { at: [-100, 160] } }];
    d.wires = d.wires!.filter((w) => w.id !== 'w2');
    d.wires.push(
      { id: 'a', ends: ['S1.t2', 'J1'] },
      { id: 'b', ends: ['J1', 'K1.t1'] },
      { id: 'c', ends: ['J1', 'H2.t1'] },
      { id: 'd', ends: ['H2.t2', 'N'] },
    );
    const l = labels(run(d).diagram);
    expect([l.a, l.b, l.c]).toEqual(['1', '1', '1']);
    expect(l.w5).toBe('2');
    expect(l.d).toBeUndefined(); // on the N rail
  });

  it('numbers a node on an UNNAMED bus like any other', () => {
    const d = control();
    d.buses!.push({ id: 'B9', layout: { at: [0, 120], span: 40 } });
    d.wires!.push({ id: 'w7', ends: ['B9', 'KA.t2'] });
    const r = run(d);
    expect(r.count).toBe(2);
    expect(labels(r.diagram).w7).toBe(labels(r.diagram).w5);
  });

  it('replaces numbers, removes stale ones on rails, keeps hand-written names', () => {
    const d = control();
    d.wires = d.wires!.map((w) =>
      w.id === 'w1' ? { ...w, label: '7' } // stale number on the L rail
      : w.id === 'w2' ? { ...w, label: ' 12 ' } // old number, becomes 1
      : w.id === 'w5' ? { ...w, label: 'X5' } // named by hand
      : w,
    );
    const r = run(d);
    expect(r.count).toBe(1);
    const l = labels(r.diagram);
    expect(l.w1).toBeUndefined();
    expect('label' in r.diagram.wires!.find((w) => w.id === 'w1')!).toBe(false);
    expect(l.w2).toBe('1');
    expect(l.w5).toBe('X5');
  });

  it('a hand-named node drops a stale number on its other wires and takes none', () => {
    const d = control();
    d.elements.push({ id: 'H2', kind: 'indicator-light' });
    d.layout!.H2 = { at: [180, 260] };
    d.wires!.push(
      { id: 'w7', ends: ['KA.t2', 'H2.t1'], label: '4' },
      { id: 'w8', ends: ['H2.t2', 'N'] },
    );
    d.wires = d.wires!.map((w) => (w.id === 'w5' ? { ...w, label: 'PE' } : w));
    const l = labels(run(d).diagram);
    expect(l.w5).toBe('PE');
    expect(l.w7).toBeUndefined();
  });

  it('reads the drawn route, not just the end points (manually routed wire)', () => {
    const d = control();
    // Route the right-hand node up above the left one: it now reads first.
    d.wires = d.wires!.map((w) =>
      w.id === 'w5' ? { ...w, path: [[100, 160], [100, 60], [140, 60], [140, 180], [100, 180]] } : w,
    );
    const l = labels(run(d).diagram);
    expect(l.w5).toBe('1');
    expect(l.w2).toBe('2');
  });

  it('is idempotent: a second run changes nothing and returns the same document', () => {
    const once = run(control()).diagram;
    const twice = run(once);
    expect(twice.diagram).toBe(once);
    expect(twice.count).toBe(2);
  });

  it('does not depend on the order of the wires array', () => {
    const d = control();
    const rev = { ...d, wires: [...d.wires!].reverse() };
    expect(labels(run(rev).diagram)).toEqual(labels(run(d).diagram));
  });

  it('leaves wires the compiler rejected untouched', () => {
    const d = control();
    d.wires!.push({ id: 'bad', ends: ['S1.nope', 'K1.t1'], label: '9' });
    expect(labels(run(d).diagram).bad).toBe('9');
  });

  it('handles an empty document', () => {
    const d: DiagramFile = { version: '1', elements: [] };
    const r = run(d);
    expect(r.count).toBe(0);
    expect(r.diagram).toBe(d);
  });
});

/**
 * Direct-on-line starter. Power circuit: supply → Q1 → KM1 main poles → F1
 * overload → M1, three phases. Control circuit between rails L and N:
 * L → F1 (95-96) → S0 stop → S1 start ∥ KM1 13-14 seal-in → KM1 coil → N.
 */
const dol = (): DiagramFile => {
  const phases: [string, string, string][] = [
    ['X.t_l1', 'Q1.t1', 'L1'], ['X.t_l2', 'Q1.t3', 'L2'], ['X.t_l3', 'Q1.t5', 'L3'],
  ];
  return {
    version: '1',
    meta: { diagramType: 'circuit' },
    elements: [
      { id: 'X', kind: 'supply-3ph', name: '-X0' },
      { id: 'Q1', kind: 'breaker-3p', name: '-Q1' },
      { id: 'KM1', kind: 'contactor-3p', name: '-KM1' },
      { id: 'F1', kind: 'overload-relay-3p', name: '-F1' },
      { id: 'M1', kind: 'motor-3ph', name: '-M1' },
      { id: 'F1c', kind: 'overload-contact-break', name: '-F1' },
      { id: 'S0', kind: 'push-button-break', name: '-S0' },
      { id: 'S1', kind: 'push-button', name: '-S1' },
      { id: 'KA', kind: 'make-contact', name: '-KM1' },
      { id: 'K', kind: 'relay-coil', name: '-KM1' },
    ],
    buses: [
      { id: 'L', name: 'L', layout: { at: [400, 20], span: 200 } },
      { id: 'N', name: 'N', layout: { at: [400, 500], span: 200 } },
    ],
    wires: [
      // Phase labels on the top segment only; the rest of the power circuit
      // is unlabelled, one wire carries a stale number.
      ...phases.map(([a, b, label], i) => ({ id: `p${i}`, ends: [a, b] as [string, string], label })),
      { id: 'q1', ends: ['Q1.t2', 'KM1.t1'], label: '9' },
      { id: 'q2', ends: ['Q1.t4', 'KM1.t3'] },
      { id: 'q3', ends: ['Q1.t6', 'KM1.t5'] },
      { id: 'k1', ends: ['KM1.t2', 'F1.t1'] },
      { id: 'k2', ends: ['KM1.t4', 'F1.t3'] },
      { id: 'k3', ends: ['KM1.t6', 'F1.t5'] },
      { id: 'f1', ends: ['F1.t2', 'M1.t_u'] },
      { id: 'f2', ends: ['F1.t4', 'M1.t_v'] },
      { id: 'f3', ends: ['F1.t6', 'M1.t_w'] },
      { id: 'c1', ends: ['L', 'F1c.t1'] },
      { id: 'c2', ends: ['F1c.t2', 'S0.t1'] },
      { id: 'c3', ends: ['S0.t2', 'S1.t1'] },
      { id: 'c4', ends: ['S0.t2', 'KA.t1'] },
      { id: 'c5', ends: ['S1.t2', 'K.t1'] },
      { id: 'c6', ends: ['KA.t2', 'K.t1'] },
      { id: 'c7', ends: ['K.t2', 'N'] },
    ],
    layout: {
      X: { at: [0, 0] },
      Q1: { at: [0, 80] },
      KM1: { at: [0, 160] },
      F1: { at: [0, 240] },
      M1: { at: [0, 320] },
      F1c: { at: [360, 80] },
      S0: { at: [360, 160] },
      S1: { at: [360, 280] },
      KA: { at: [440, 280] },
      K: { at: [360, 420] },
    },
  };
};

describe('main circuit vs control circuit', () => {
  it('reads the power symbols from the library: circuit-only, three pins or more', () => {
    for (const id of ['supply-3ph', 'breaker-3p', 'contactor-3p', 'overload-relay-3p', 'motor-3ph', 'rcd-4p', 'mcb-1pn']) {
      expect(isMainCircuitEntry(LIBRARY.get(id)), id).toBe(true);
    }
    for (const id of ['relay-coil', 'make-contact', 'overload-contact-break', 'terminal-block', 'breaker', 'busduct-tap', 'transformer-3w']) {
      expect(isMainCircuitEntry(LIBRARY.get(id)), id).toBe(false);
    }
  });

  it('numbers only the control circuit; phase labels stay, stale numbers go', () => {
    const r = run(dol());
    const l = labels(r.diagram);
    expect([l.p0, l.p1, l.p2]).toEqual(['L1', 'L2', 'L3']);
    for (const id of ['q1', 'q2', 'q3', 'k1', 'k2', 'k3', 'f1', 'f2', 'f3']) expect(l[id], id).toBeUndefined();
    expect(r.count).toBe(3);
    expect(l.c2).toBe('1'); // F1 95-96 → stop
    expect([l.c3, l.c4]).toEqual(['2', '2']); // stop → start ∥ seal-in
    expect([l.c5, l.c6]).toEqual(['3', '3']); // → coil
    expect([l.c1, l.c7]).toEqual([undefined, undefined]); // rails
  });
});
