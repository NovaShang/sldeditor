/**
 * Circuit-diagram rendering rules (`lib/circuit-marks.ts`) and their three
 * outputs — SVG (and so PNG/PDF), DXF — plus the conductor presets.
 *
 * Pin designations come from a document-defined symbol with terminal labels
 * (so these tests do not depend on which shipped symbols carry labels) and
 * from per-instance `pinLabels` on shipped ones.
 *
 * @vitest-environment jsdom
 *
 * (jsdom because the DXF writer parses each symbol's SVG with `DOMParser`.)
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import { buildExportSvg } from '../../src/lib/export-image';
import { buildExportDxf } from '../../src/lib/export-dxf';
import {
  circuitSolderDots,
  placePinLabel,
  placePinLabels,
  stripeSegments,
  PE_STRIPE_DASHARRAY,
} from '../../src/lib/circuit-marks';
import { PE_STRIPE } from '../../src/lib/colors';
import {
  applyConductor,
  CONDUCTOR_PRESETS,
  longestWire,
  nodeHasConductor,
} from '../../src/lib/conductors';
import type { DiagramFile, LibraryEntry } from '../../src/model';

/** A coil-like symbol with A1 (top) / A2 (bottom) — the test's own library entry. */
const COIL: LibraryEntry = {
  id: 'custom:test-coil',
  name: 'Test coil',
  category: 'control',
  viewBox: '-22 -22 44 44',
  width: 44,
  height: 44,
  svg: '<rect x="-20" y="-10" width="40" height="20" fill="none" stroke="black" stroke-width="1"/><line x1="0" y1="-20" x2="0" y2="-10" stroke="black" stroke-width="1"/><line x1="0" y1="10" x2="0" y2="20" stroke="black" stroke-width="1"/>',
  terminals: [
    { id: 't1', x: 0, y: -20, orientation: 'n', label: 'A1' },
    { id: 't2', x: 0, y: 20, orientation: 's', label: 'A2' },
  ],
  source: { type: 'custom' },
} as LibraryEntry;

function doc(diagramType?: 'circuit'): DiagramFile {
  return {
    version: '1',
    meta: diagramType ? { diagramType } : undefined,
    customKinds: [COIL],
    elements: [
      { id: 'K1', kind: 'custom:test-coil', name: '-K1' },
      // Rotated: designations must stay upright and beside the leads.
      { id: 'K2', kind: 'custom:test-coil', name: '-K2', pinLabels: { t1: 'X1', t2: '' } },
      { id: 'S1', kind: 'make-contact', name: '-S1', pinLabels: { t1: '13', t2: '14' } },
      { id: 'S2', kind: 'make-contact', name: '-S2' },
    ],
    buses: [
      { id: 'L', name: 'L', layout: { at: [100, 0], span: 200 } },
      { id: 'N', name: 'N', layout: { at: [100, 300], span: 200 } },
    ],
    wires: [
      // Taps off the L rail, one of them at the rail's very end (x = 0).
      { id: 'w1', ends: ['L', 'S1.t1'] },
      { id: 'w2', ends: ['L', 'S2.t1'] },
      // A T at S1.t2: two wires on one pin.
      { id: 'w3', ends: ['S1.t2', 'K1.t1'] },
      { id: 'w4', ends: ['S1.t2', 'S2.t2'] },
      { id: 'w5', ends: ['K1.t2', 'N'], color: 'green-yellow', label: 'PE' },
    ],
    layout: {
      S1: { at: [60, 60] },
      S2: { at: [0, 60] },
      K1: { at: [60, 200] },
      K2: { at: [200, 200], rot: 90 },
    },
  };
}

describe('pin designation placement', () => {
  it('sits on the inner side of the terminal, beside the lead', () => {
    const fs = 5.6;
    // Top terminal (exit up): left of the lead, below the terminal point.
    const n = placePinLabel([0, 0], 'n', fs);
    expect(n.anchor).toBe('end');
    expect(n.x).toBeLessThan(0);
    expect(n.y - fs).toBeGreaterThan(-1); // glyph top inside, not on the wire above
    // Bottom terminal (exit down): left of the lead, above the point.
    const s = placePinLabel([0, 0], 's', fs);
    expect(s.x).toBeLessThan(0);
    expect(s.y).toBeLessThan(0);
    // Right terminal (exit right): above the lead, left of the point.
    const e = placePinLabel([0, 0], 'e', fs);
    expect(e).toMatchObject({ anchor: 'end' });
    expect(e.x).toBeLessThan(0);
    expect(e.y).toBeLessThan(0);
    // Left terminal (exit left): above the lead, right of the point.
    const w = placePinLabel([0, 0], 'w', fs);
    expect(w).toMatchObject({ anchor: 'start' });
    expect(w.x).toBeGreaterThan(0);
    expect(w.y).toBeLessThan(0);
  });

  it('resolves library defaults, instance overrides and hidden pins', () => {
    const labels = placePinLabels(compile(doc('circuit')), 7);
    const byRef = Object.fromEntries(labels.map((l) => [l.ref, l.text]));
    expect(byRef['K1.t1']).toBe('A1');
    expect(byRef['K1.t2']).toBe('A2');
    expect(byRef['K2.t1']).toBe('X1');
    expect(byRef['K2.t2']).toBeUndefined(); // '' hides
    expect(byRef['S1.t1']).toBe('13');
    expect(byRef['S1.t2']).toBe('14');
  });

  it('follows the rotated terminal, not the symbol frame', () => {
    const m = compile(doc('circuit'));
    const k2 = placePinLabels(m, 7).find((l) => l.ref === 'K2.t1')!;
    const term = m.terminals.get('K2.t1')!;
    // rot 90 turns the top pin into a right-hand pin: text above the lead.
    expect(term.orientation).toBe('e');
    expect(k2).toMatchObject(placePinLabel(term.world, 'e', 5.6));
  });

  it('is empty for a single-line document', () => {
    expect(placePinLabels(compile(doc()), 7)).toEqual([]);
  });
});

describe('circuit solder dots', () => {
  it('dots a T at a pin and a tap off a bus, not a single wire or a rail end', () => {
    const m = compile(doc('circuit'));
    const dots = circuitSolderDots(m).map(([x, y]) => `${x},${y}`).sort();
    const at = (ref: string) => m.terminals.get(ref)!.world.join(',');
    // T at S1.t2 (two wires on the pin).
    expect(dots).toContain(at('S1.t2'));
    // w1 taps the L rail mid-span; w2 meets it at its left end (x = 0).
    expect(dots).toContain('60,0');
    expect(dots).not.toContain('0,0');
    // A pin with a single wire gets nothing.
    expect(dots).not.toContain(at('K1.t1'));
    expect(dots).not.toContain(at('S1.t1'));
  });

  it('leaves junctions to the junction layer', () => {
    const d = doc('circuit');
    d.junctions = [{ id: 'J1', layout: { at: [300, 100] } }];
    d.elements.push({ id: 'S3', kind: 'make-contact' }, { id: 'S4', kind: 'make-contact' });
    d.layout = { ...d.layout, S3: { at: [300, 160] }, S4: { at: [340, 160] } };
    d.wires!.push(
      { id: 'j1', ends: ['J1', 'S3.t1'] },
      { id: 'j2', ends: ['J1', 'S4.t1'] },
      { id: 'j3', ends: ['J1', 'L'] },
    );
    const dots = circuitSolderDots(compile(d)).map(([x, y]) => `${x},${y}`);
    expect(dots).not.toContain('300,100');
  });

  it('is empty for a single-line document', () => {
    expect(circuitSolderDots(compile(doc()))).toEqual([]);
  });
});

describe('SVG export', () => {
  it('prints pin designations and solder dots only on circuit diagrams', () => {
    const circuit = buildExportSvg(compile(doc('circuit')));
    expect(circuit).toMatch(/<text x="[-\d.]+" y="[-\d.]+" text-anchor="end">A1<\/text>/);
    expect(circuit).toContain('>13</text>');
    expect(circuit).toContain('font-size="5.6"');
    // Upright: no designation is rotated with its symbol.
    const pinGroup = circuit.slice(circuit.indexOf('font-size="5.6"'));
    expect(pinGroup.slice(0, pinGroup.indexOf('</g>'))).not.toMatch(/rotate|transform/);
    expect(circuit).toContain('<circle cx="60" cy="0" r="3.5" fill="black"/>');

    const sld = buildExportSvg(compile(doc()));
    expect(sld).not.toContain('>A1</text>');
    expect(sld).not.toContain('>13</text>');
    expect(sld).not.toContain('<circle cx="60" cy="0"');
  });

  it('hides pin designations with the other labels at label mode off', () => {
    const svg = buildExportSvg(compile(doc('circuit')), { labelMode: 'off' });
    expect(svg).not.toContain('>A1</text>');
  });

  it('stripes a green-yellow wire', () => {
    const svg = buildExportSvg(compile(doc('circuit')));
    expect(svg).toContain(`stroke="${PE_STRIPE.light}" stroke-dasharray="${PE_STRIPE_DASHARRAY}"`);
  });
});

describe('DXF export', () => {
  const entities = (dxf: string) => dxf.slice(dxf.indexOf('ENTITIES'));

  it('writes pin designations, filled dots and yellow PE dashes on circuit diagrams', () => {
    const dxf = entities(buildExportDxf(compile(doc('circuit'))));
    expect(dxf).toContain('\n1\nA1\n');
    expect(dxf).toContain('\n1\n14\n');
    // Donut dot: a closed POLYLINE with bulge-1 vertices.
    expect(dxf).toMatch(/POLYLINE\n8\nWIRES\n66\n1\n70\n1\n10\n0\n20\n0\n30\n0\n40\n3\.5/);
    // PE stripes: yellow (ACI 2) LINEs on the wire layer.
    expect(dxf).toMatch(/LINE\n8\nWIRES\n62\n2\n/);
  });

  it('writes none of it for a single-line document (bar the PE stripes)', () => {
    const dxf = entities(buildExportDxf(compile(doc())));
    expect(dxf).not.toContain('\n1\nA1\n');
    expect(dxf).not.toMatch(/\n40\n3\.5\n/);
  });
});

describe('stripeSegments', () => {
  it('dashes on/off along the polyline, continuing around corners', () => {
    const segs = stripeSegments([[0, 0], [10, 0], [10, 6]], 4);
    expect(segs).toEqual([
      [[0, 0], [4, 0]],
      [[8, 0], [10, 0]],
      [[10, 0], [10, 2]],
    ]);
  });
});

describe('conductor presets', () => {
  const base: DiagramFile = {
    version: '1',
    elements: [],
    wires: [
      { id: 'a', ends: ['x.t1', 'y.t1'], color: 'red', label: '7' },
      { id: 'b', ends: ['x.t2', 'y.t2'] },
      { id: 'c', ends: ['x.t3', 'y.t3'] },
    ],
  };
  const preset = (l: string) => CONDUCTOR_PRESETS.find((p) => p.label === l)!;

  it('sets colour and label together on every picked wire', () => {
    const d = applyConductor(base, ['a', 'b'], preset('L1'));
    expect(d.wires![0]).toMatchObject({ color: 'brown', label: 'L1' });
    expect(d.wires![1]).toMatchObject({ color: 'brown', label: 'L1' });
    expect(d.wires![2]).toBe(base.wires![2]);
  });

  it('L2 is the default ink: it clears the colour instead of storing it', () => {
    const d = applyConductor(base, ['a'], preset('L2'));
    expect(d.wires![0]).toEqual({ id: 'a', ends: ['x.t1', 'y.t1'], label: 'L2' });
  });

  it('on a whole node: colours every wire, labels only the chosen one', () => {
    const node: DiagramFile = {
      ...base,
      wires: [
        { id: 'a', ends: ['x.t1', 'y.t1'], label: 'L1' },
        { id: 'b', ends: ['x.t1', 'z.t1'], label: '7', color: 'red' },
        { id: 'c', ends: ['x.t1', 'q.t1'], label: 'L2' },
      ],
    };
    const d = applyConductor(node, ['a', 'b', 'c'], preset('L1'), 'c');
    // The designation moves to the chosen wire; a stale one elsewhere goes.
    expect(d.wires![0]).toEqual({ id: 'a', ends: ['x.t1', 'y.t1'], color: 'brown' });
    // Non-designation labels (wire numbers) stay.
    expect(d.wires![1]).toMatchObject({ color: 'brown', label: '7' });
    expect(d.wires![2]).toMatchObject({ color: 'brown', label: 'L1' });
    expect(nodeHasConductor(d.wires!, preset('L1'), 'c')).toBe(true);
    expect(nodeHasConductor(d.wires!, preset('L1'), 'a')).toBe(false);
    expect(applyConductor(d, ['a', 'b', 'c'], preset('L1'), 'c')).toBe(d);
  });

  it('longestWire picks the longest drawn wire, ties to the smaller id', () => {
    const renders = new Map([
      ['b', { path: [[0, 0], [0, 30]] as [number, number][] }],
      ['a', { path: [[0, 0], [10, 0], [10, 20]] as [number, number][] }],
      ['c', { path: [[0, 0], [5, 0]] as [number, number][] }],
    ]);
    expect(longestWire(['c', 'b', 'a'], renders)).toBe('a');
  });

  it('returns the document itself when nothing changes', () => {
    const d = applyConductor(base, ['b'], preset('PE'));
    expect(applyConductor(d, ['b'], preset('PE'))).toBe(d);
  });
});
