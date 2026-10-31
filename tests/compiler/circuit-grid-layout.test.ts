/**
 * Circuit diagrams have no auto-layout: explicit positions render verbatim
 * and anything unplaced is set down on a plain grid beside the drawing.
 * Single-line documents keep the auto-layout.
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import type { DiagramFile } from '../../src/model';

const placed = (type?: 'circuit'): DiagramFile => ({
  version: '1',
  ...(type ? { meta: { diagramType: type } } : {}),
  elements: [
    { id: 'K1', kind: 'relay-coil' },
    { id: 'S1', kind: 'push-button' },
  ],
  buses: [{ id: 'L', name: 'L', layout: { at: [100, 0], span: 200 } }],
  wires: [
    { id: 'w1', ends: ['L', 'S1.t1'] },
    { id: 'w2', ends: ['S1.t2', 'K1.t1'] },
  ],
  layout: { S1: { at: [40, 80] }, K1: { at: [40, 140], rot: 90 } },
});

describe('circuit diagram placement', () => {
  it('keeps explicit positions exactly', () => {
    const m = compile(placed('circuit'));
    expect(m.layout.get('S1')).toEqual({ at: [40, 80], rot: 0, mirror: false });
    expect(m.layout.get('K1')).toEqual({ at: [40, 140], rot: 90, mirror: false });
    expect(m.buses.get('L')!.geometry).toEqual({ at: [100, 0], span: 200, rot: 0, axis: 'x' });
  });

  it('puts unplaced devices on a grid to the right of the drawing, top-aligned', () => {
    const d = placed('circuit');
    d.elements.push(
      { id: 'H1', kind: 'indicator-light' },
      { id: 'C1', kind: 'make-contact' },
      { id: 'C2', kind: 'make-contact' },
    );
    const m = compile(d);
    // Drawing extent: the bus runs to x = 200; nothing placed sits above y = 0.
    const ats = ['H1', 'C1', 'C2'].map((id) => m.layout.get(id)!);
    for (const p of ats) {
      expect(p.rot).toBe(0);
      expect(p.at[0] % 10).toBe(0);
      expect(p.at[1] % 10).toBe(0);
    }
    // indicator-light viewBox -12 -22 24 24 → its top-left corner on the cell.
    expect(ats[0].at[0] - 12).toBeGreaterThanOrEqual(200);
    expect(ats[0].at[1] - 22).toBeGreaterThanOrEqual(0);
    expect(ats[0].at[1] - 22).toBeLessThan(10);
    // One row, left to right, no two in the same cell.
    expect(ats[1].at[0]).toBeGreaterThan(ats[0].at[0]);
    expect(ats[2].at[0]).toBeGreaterThan(ats[1].at[0]);
    expect(new Set(ats.map((p) => p.at.join(','))).size).toBe(3);
  });

  it('is deterministic', () => {
    const d = placed('circuit');
    d.elements.push({ id: 'H1', kind: 'indicator-light' });
    d.buses!.push({ id: 'N', name: 'N' });
    const a = compile(d);
    const b = compile(structuredClone(d));
    expect(a.layout.get('H1')).toEqual(b.layout.get('H1'));
    expect(a.buses.get('N')!.geometry).toEqual(b.buses.get('N')!.geometry);
  });

  it('sets an unplaced rail down as a horizontal bus beside the drawing, above the devices', () => {
    const d = placed('circuit');
    d.buses!.push({ id: 'N', name: 'N' });
    d.elements.push({ id: 'H1', kind: 'indicator-light' });
    const m = compile(d);
    const g = m.buses.get('N')!.geometry;
    expect(g.axis).toBe('x');
    expect(g.at[0] - g.span / 2).toBeGreaterThanOrEqual(200);
    expect(g.at[1]).toBe(0);
    expect(m.layout.get('H1')!.at[1] - 22).toBeGreaterThan(g.at[1]);
  });

  it('starts at the origin on an empty drawing, and wires still compile', () => {
    const d: DiagramFile = {
      version: '1',
      meta: { diagramType: 'circuit' },
      elements: [
        { id: 'S1', kind: 'push-button' },
        { id: 'K1', kind: 'relay-coil' },
      ],
      wires: [{ id: 'w', ends: ['S1.t2', 'K1.t1'] }],
    };
    const m = compile(d);
    // push-button viewBox -37 -42 39 64: top-left corner just inside (0, 0).
    expect(m.layout.get('S1')!.at).toEqual([40, 50]);
    expect(m.wireRenders.get('w')!.path.length).toBeGreaterThanOrEqual(2);
  });

  it('leaves single-line documents to the auto-layout', () => {
    const d = placed();
    d.elements.push({ id: 'C1', kind: 'make-contact' });
    d.wires!.push({ id: 'w3', ends: ['K1.t2', 'C1.t1'] });
    const sld = compile(d).layout.get('C1')!;
    const circuit = compile({ ...d, meta: { diagramType: 'circuit' } }).layout.get('C1')!;
    // The single-line auto-layout chains C1 off the coil; the grid does not.
    expect(sld).not.toEqual(circuit);
    // And an explicit `diagramType: 'sld'` is the same as absent.
    expect(compile({ ...d, meta: { diagramType: 'sld' } }).layout).toEqual(compile(d).layout);
  });
});
