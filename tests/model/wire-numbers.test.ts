/**
 * Wire numbering by potential (circuit diagrams). One number per electrical
 * node, in reading order; rails and hand-named nodes keep their names.
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import { numberWiresByPotential } from '../../src/model/wire-numbers';
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
