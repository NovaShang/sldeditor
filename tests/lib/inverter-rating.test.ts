/**
 * The inverter's rated power. It is a NEW param key (`Prated`, stored in MW
 * like the other mega-unit ratings) so that nothing a drawing already keeps in
 * an inverter's params — free-form keys the library never defined, `P`
 * included — changes meaning or starts showing on the label.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import { labelLines } from '../../src/lib/element-labels';
import { buildExportSvg } from '../../src/lib/export-image';
import { buildExportDxf } from '../../src/lib/export-dxf';
import { libraryById } from '../../src/element-library';
import type { DiagramFile } from '../../src/model';

/** An inverter as drawings written before the param existed carry it. */
const legacy: DiagramFile = {
  version: '1',
  elements: [
    { id: 'PV1', kind: 'pv' },
    {
      id: 'INV1',
      kind: 'inverter',
      name: 'Inverter 1 — 500 kW',
      params: { P: 0.5, S: 0.55, Pn: 500, rating: '500kW', Un: 0.4 },
    },
    { id: 'INV2', kind: 'inverter', name: 'INV2' },
  ],
  wires: [{ id: 'W1', ends: ['PV1.t_dc', 'INV1.t_dc'] }],
  layout: {
    PV1: { at: [0, -120] },
    INV1: { at: [0, 0], rot: 180 },
    INV2: { at: [120, 0] },
  },
};

const lines = (d: DiagramFile, id: string) =>
  labelLines(compile(d).elements.get(id)!, 'all');

describe('inverter rated power', () => {
  it('is a library param under a key of its own, in MW, shown on the label', () => {
    const p = libraryById.inverter.params ?? [];
    expect(p.map((f) => f.name)).toEqual(['Prated']);
    expect(p[0]).toMatchObject({ type: 'number', unit: 'MW', showOnCanvas: true });
  });

  it('leaves a drawing written before it byte-identical (SVG and DXF)', async () => {
    await expect(buildExportSvg(compile(legacy))).toMatchFileSnapshot(
      './__snapshots__/inverter-legacy.svg',
    );
    await expect(buildExportDxf(compile(legacy))).toMatchFileSnapshot(
      './__snapshots__/inverter-legacy.dxf',
    );
    expect(lines(legacy, 'INV1')).toEqual(['Inverter 1 — 500 kW']);
    expect(lines(legacy, 'INV2')).toEqual(['INV2']);
  });

  it('labels with the kW / MW scaling', () => {
    const at = (Prated: number): DiagramFile => ({
      version: '1',
      elements: [{ id: 'INV1', kind: 'inverter', params: { Prated } }],
      layout: { INV1: { at: [0, 0] } },
    });
    expect(lines(at(0.005), 'INV1')).toEqual(['INV1', '5kW']);
    expect(lines(at(0.5), 'INV1')).toEqual(['INV1', '500kW']);
    expect(lines(at(2.5), 'INV1')).toEqual(['INV1', '2.5MW']);
    expect(buildExportSvg(compile(at(0.5)))).toContain('>500kW<');
  });
});
