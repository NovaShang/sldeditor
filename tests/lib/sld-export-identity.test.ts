/**
 * Single-line documents must export byte-for-byte as they did before circuit
 * diagrams existed.
 *
 * The snapshots under `__snapshots__/sld-identity/` were written by the code
 * BEFORE the circuit-diagram rendering (pin designations, circuit solder
 * dots, PE stripes) landed, and are never to be regenerated to make this test
 * pass: a diff here means a single-line user's SVG / DXF changed. Every
 * fixture deliberately exercises the shapes circuit mode draws differently —
 * a device terminal with two wires on it (a T at a pin), wires tapping a bus,
 * a degree-3 junction, coloured and labelled wires, terminals of symbols that
 * carry pin designations — so the new rules are proven not to leak.
 * (A `green-yellow` wire is deliberately absent: that colour is new with
 * circuit diagrams and draws its PE stripes in either drawing type.)
 *
 * @vitest-environment jsdom
 *
 * (jsdom because the DXF writer parses each symbol's SVG with `DOMParser`.)
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import { buildExportSvg } from '../../src/lib/export-image';
import { buildExportDxf } from '../../src/lib/export-dxf';
import type { DiagramFile } from '../../src/model';
import sample from '../../src/fixtures/sample-substation.json';
import complex from '../../src/fixtures/complex-substation.json';
import { SAMPLE_DIAGRAM } from '../../src/demo/sample-diagram';

/** A small control-style drawing — but a single-line document (no type). */
const CONTROLISH: DiagramFile = {
  version: '1',
  elements: [
    { id: 'K1', kind: 'relay-coil', name: '-K1' },
    { id: 'S1', kind: 'make-contact', name: '-S1' },
    { id: 'S2', kind: 'make-contact', name: '-S2' },
    { id: 'QF1', kind: 'breaker', name: '-QF1' },
  ],
  buses: [
    { id: 'L', name: 'L', layout: { at: [100, 0], span: 200 } },
    { id: 'N', name: 'N', layout: { at: [100, 200], span: 200 } },
  ],
  junctions: [{ id: 'J1', layout: { at: [100, 120] } }],
  wires: [
    { id: 'w1', ends: ['L', 'S1.t1'], label: 'L1', color: 'brown' },
    { id: 'w2', ends: ['L', 'S2.t1'] },
    { id: 'w3', ends: ['S1.t2', 'J1'] },
    { id: 'w4', ends: ['S2.t2', 'J1'] },
    { id: 'w5', ends: ['J1', 'K1.t1'] },
    { id: 'w6', ends: ['K1.t2', 'N'], color: 'blue', label: 'N' },
    // A T at a device pin: two wires on QF1.t2.
    { id: 'w7', ends: ['QF1.t2', 'S1.t1'] },
    { id: 'w8', ends: ['QF1.t2', 'S2.t1'], color: 'green', label: 'PE' },
  ],
  layout: {
    S1: { at: [60, 60] },
    S2: { at: [140, 60] },
    K1: { at: [100, 160] },
    QF1: { at: [20, 60], rot: 90 },
  },
};

const FIXTURES: [string, DiagramFile][] = [
  ['sample-substation', sample as DiagramFile],
  ['complex-substation', complex as DiagramFile],
  ['demo-sample', SAMPLE_DIAGRAM],
  ['controlish', CONTROLISH],
];

describe('single-line export is unchanged by circuit-diagram rendering', () => {
  for (const [name, file] of FIXTURES) {
    it(`${name}: SVG byte-identical`, async () => {
      const svg = buildExportSvg(compile(file), { title: name });
      await expect(svg).toMatchFileSnapshot(`__snapshots__/sld-identity/${name}.svg`);
    });
    it(`${name}: DXF byte-identical`, async () => {
      const dxf = buildExportDxf(compile(file), { title: name });
      await expect(dxf).toMatchFileSnapshot(`__snapshots__/sld-identity/${name}.dxf`);
    });
  }
});
